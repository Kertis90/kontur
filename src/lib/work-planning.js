import { z } from 'zod';
import { one,rows,transaction,parseJson } from './db.js';
import { projectFor,workspaceFor,visibleProjects,validUsers,positiveId,dateOnly,WorkError,body,reply } from './work-common.js';
import { dateRange,capacityDays,portfolioSchedule } from './planning-math.js';
import { createNotification,emitEvent } from './events.js';
import { audit } from './audit.js';
import { assertDependencyCycle } from './work-tasks.js';

export function approvalOutcome(mode,steps){
  if(steps.some(s=>s.decision==='rejected'))return 'rejected';
  return steps.length&&steps.every(s=>s.decision==='approved')?'approved':'pending';
}
export function canDecideApproval(request,steps,step,userId){
  return request.status==='pending'&&step.decision==='pending'&&[step.reviewer_id,step.substitute_id].map(Number).includes(Number(userId))&&(request.mode==='parallel'||!steps.some(s=>s.position<step.position&&s.decision!=='approved'));
}
export async function approvalReminders(){
  await transaction(async c=>{
    const [requests]=await c.query("SELECT * FROM approval_requests WHERE status='pending' AND due_at<=DATE_ADD(CURRENT_TIMESTAMP,INTERVAL 1 DAY) AND reminded_at IS NULL LIMIT 100 FOR UPDATE SKIP LOCKED");
    for(const request of requests){
      const [steps]=await c.query("SELECT * FROM approval_steps WHERE request_id=? AND decision='pending' ORDER BY position",[request.id]);
      for(const step of request.mode==='sequential'?steps.slice(0,1):steps)for(const person of [step.reviewer_id,step.substitute_id].filter(Boolean))await createNotification(person,'approval.deadline','Приближается срок согласования',request.title,'approval',request.id,'/?view=work&tab=approvals',c);
      await c.query('UPDATE approval_requests SET reminded_at=CURRENT_TIMESTAMP WHERE id=?',[request.id]);
    }
  });
}
export async function planningApi(request,path,user){
  const method=request.method,url=new URL(request.url);
  if(path[0]==='approvals'){
    if(method==='GET'){
      const projects=await visibleProjects(user);if(!projects.length)return reply([]);
      const values=await rows(`SELECT a.*,p.name AS project_name,u.display_name AS requester_name FROM approval_requests a JOIN projects p ON p.id=a.project_id JOIN users u ON u.id=a.requested_by WHERE a.project_id IN (${projects.map(()=>'?')}) ORDER BY a.id DESC LIMIT 500`,projects.map(p=>p.id));
      for(const item of values)item.steps=await rows('SELECT s.*,u.display_name AS reviewer_name,v.display_name AS substitute_name FROM approval_steps s JOIN users u ON u.id=s.reviewer_id LEFT JOIN users v ON v.id=s.substitute_id WHERE request_id=? ORDER BY position',[item.id]);
      return reply(values);
    }
    if(method==='POST'&&!path[1]){
      const d=z.object({project_id:positiveId,task_id:positiveId.nullable().default(null),title:z.string().trim().min(2).max(300),mode:z.enum(['sequential','parallel']),due_at:z.string().datetime().nullable().default(null),reason:z.string().max(5000).default(''),steps:z.array(z.object({reviewer_id:positiveId,substitute_id:positiveId.nullable().default(null)})).min(1).max(30)}).parse(await body(request));
      await projectFor(user,d.project_id,'approval.request',true);
      await validUsers(user,d.steps.flatMap(s=>[s.reviewer_id,s.substitute_id]),d.project_id);
      if(d.steps.some(s=>s.reviewer_id===user.id||s.substitute_id===user.id))throw new WorkError(422,'Инициатор не может согласовывать свой запрос');
      if(new Set(d.steps.map(s=>s.reviewer_id)).size!==d.steps.length)throw new WorkError(422,'Согласующие не должны повторяться');
      if(d.task_id&&!await one('SELECT id FROM tasks WHERE id=? AND project_id=?',[d.task_id,d.project_id]))throw new WorkError(422,'Задача относится к другому проекту');
      const result=await transaction(async c=>{
        const [[task]]=d.task_id?await c.query('SELECT version_number FROM tasks WHERE id=? AND project_id=? FOR UPDATE',[d.task_id,d.project_id]):[[null]];
        if(d.task_id&&!task)throw new WorkError(404,'Задача больше недоступна');
        const [created]=await c.query('INSERT INTO approval_requests(workspace_id,project_id,task_id,task_version_number,title,mode,requested_by,due_at,reason) VALUES(?,?,?,?,?,?,?,?,?)',[user.workspace_id,d.project_id,d.task_id,task?.version_number||null,d.title,d.mode,user.id,d.due_at?new Date(d.due_at):null,d.reason]);
        for(const [i,s]of d.steps.entries()){
          await c.query('INSERT INTO approval_steps(request_id,position,reviewer_id,substitute_id) VALUES(?,?,?,?)',[created.insertId,i,s.reviewer_id,s.substitute_id]);
          if(d.mode==='parallel'||i===0)for(const person of [s.reviewer_id,s.substitute_id].filter(Boolean))await createNotification(person,'approval.requested','Требуется согласование',d.title,'approval',created.insertId,'/?view=work&tab=approvals',c);
        }
        return {id:created.insertId};
      });return reply(result,201);
    }
    if(method==='POST'&&path[2]==='decision'){
      const d=z.object({step_id:positiveId,decision:z.enum(['approved','rejected']),comment:z.string().trim().min(1).max(5000)}).parse(await body(request));
      const result=await transaction(async c=>{
        const [[item]]=await c.query('SELECT * FROM approval_requests WHERE id=? FOR UPDATE',[positiveId.parse(path[1])]);
        if(!item||Number(item.workspace_id)!==Number(user.workspace_id))throw new WorkError(404,'Согласование не найдено');
        await projectFor(user,item.project_id,'approval.decide',true);
        const [steps]=await c.query('SELECT * FROM approval_steps WHERE request_id=? ORDER BY position',[item.id]);
        const step=steps.find(s=>Number(s.id)===d.step_id);
        if(!step||!canDecideApproval(item,steps,step,user.id))throw new WorkError(409,'Этот этап согласования сейчас недоступен');
        await c.query('UPDATE approval_steps SET decision=?,decided_by=?,comment=?,decided_at=CURRENT_TIMESTAMP WHERE id=?',[d.decision,user.id,d.comment,step.id]);
        step.decision=d.decision;const status=approvalOutcome(item.mode,steps);
        await c.query("UPDATE approval_requests SET status=?,completed_at=IF(?='pending',NULL,CURRENT_TIMESTAMP) WHERE id=?",[status,status,item.id]);
        if(status==='pending'&&item.mode==='sequential'){
          const next=steps.find(s=>s.decision==='pending');
          for(const person of [next.reviewer_id,next.substitute_id].filter(Boolean))await createNotification(person,'approval.requested','Ваша очередь согласования',item.title,'approval',item.id,'/?view=work&tab=approvals',c);
        }else if(status!=='pending')await createNotification(item.requested_by,'approval.completed',status==='approved'?'Согласование завершено':'Согласование отклонено',item.title,'approval',item.id,'/?view=work&tab=approvals',c);
        await emitEvent({workspaceId:user.workspace_id,eventType:`approval.${status}`,aggregateType:'task',aggregateId:item.task_id||0,payload:{approval_id:item.id,project_id:item.project_id,task_id:item.task_id}},c);
        return {status};
      });await audit(user,'approval.decided','approval',path[1],{decision:d.decision,step_id:d.step_id},request);return reply(result);
    }
    if(method==='POST'&&path[2]==='cancel'){
      const item=await one('SELECT * FROM approval_requests WHERE id=? AND workspace_id=?',[positiveId.parse(path[1]),user.workspace_id]);
      if(!item)throw new WorkError(404,'Согласование не найдено');
      await projectFor(user,item.project_id,item.requested_by===user.id?'approval.request':'approval.manage',true);
      const changed=await rows("UPDATE approval_requests SET status='cancelled',completed_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'",[item.id]);
      if(!changed.affectedRows)throw new WorkError(409,'Согласование уже завершено');return reply({ok:true});
    }
  }
  if(path[0]==='approval-gates'){
    const project=await projectFor(user,path[1],method==='GET'?'project.browse':'approval.manage');
    if(method==='GET')return reply((await rows('SELECT * FROM approval_gates WHERE project_id=?',[project.id])).map(r=>({...r,required_fields:parseJson(r.required_fields_json,[])})));
    if(method==='PUT'){
      const d=z.array(z.object({stage_id:positiveId,required_fields:z.array(z.string().regex(/^(title|description|assignee_id|due_date|estimate_minutes|custom\.[a-zA-Z0-9_-]+)$/)).max(100)})).max(100).parse(await body(request));
      for(const item of d)if(!await one('SELECT id FROM workflow_stages WHERE id=? AND workflow_id=?',[item.stage_id,project.workflow_id]))throw new WorkError(422,'Этап не относится к процессу проекта');
      await transaction(async c=>{await c.query('SELECT id FROM projects WHERE id=? FOR UPDATE',[project.id]);await c.query('DELETE FROM approval_gates WHERE project_id=?',[project.id]);for(const item of d)await c.query('INSERT INTO approval_gates(project_id,stage_id,required_fields_json) VALUES(?,?,?)',[project.id,item.stage_id,JSON.stringify(item.required_fields)]);});return reply({ok:true});
    }
  }
  if(path[0]==='capacity'){
    await workspaceFor(user,method==='GET'?'capacity.view':'capacity.manage');
    if(method==='GET'){
      const start=dateOnly.parse(url.searchParams.get('start')),end=dateOnly.parse(url.searchParams.get('end'));
      let dates;try{dates=dateRange(start,end);}catch(e){throw new WorkError(422,e.message);}
      const [users,calendars,absences,allocations]=await Promise.all([
        rows("SELECT id,display_name,avatar_color FROM users WHERE workspace_id=? AND status='active'",[user.workspace_id]),
        rows('SELECT * FROM resource_calendars WHERE workspace_id=?',[user.workspace_id]),
        rows('SELECT * FROM resource_absences WHERE workspace_id=? AND start_date<=? AND end_date>=?',[user.workspace_id,end,start]),
        rows("SELECT a.*,p.name AS project_name FROM resource_allocations a JOIN projects p ON p.id=a.project_id WHERE p.workspace_id=? AND p.deleted_at IS NULL AND p.status='active' AND a.start_date<=? AND a.end_date>=?",[user.workspace_id,end,start])]);
      const projects=await visibleProjects(user);const allowed=new Set(projects.map(p=>Number(p.id)));
      // Total workload includes private projects without disclosing their identity.
      return reply({dates,people:users.map(person=>({...person,calendar:calendars.find(c=>c.user_id===person.id),days:capacityDays(person.id,dates,parseJson(calendars.find(c=>c.user_id===person.id)?.hours_json,null),absences,allocations)})),absences,allocations:allocations.map(a=>allowed.has(Number(a.project_id))?a:{id:null,user_id:a.user_id,start_date:a.start_date,end_date:a.end_date,hours_per_day:a.hours_per_day,project_name:'Другой проект',project_id:null})});
    }
    if(method==='PUT'&&path[1]==='calendar'){
      const d=z.object({user_id:positiveId,hours:z.array(z.number().min(0).max(24)).length(7),timezone:z.string().max(100)}).parse(await body(request));await validUsers(user,[d.user_id]);
      try{new Intl.DateTimeFormat('ru',{timeZone:d.timezone});}catch{throw new WorkError(422,'Неизвестный часовой пояс');}
      await rows('INSERT INTO resource_calendars(user_id,workspace_id,hours_json,timezone) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE hours_json=VALUES(hours_json),timezone=VALUES(timezone)',[d.user_id,user.workspace_id,JSON.stringify(d.hours),d.timezone]);return reply({ok:true});
    }
    if(method==='POST'&&path[1]==='absence'){
      const d=z.object({user_id:positiveId.nullable(),start_date:dateOnly,end_date:dateOnly,unavailable_percent:z.number().int().min(1).max(100),label:z.string().trim().min(1).max(180)}).parse(await body(request));
      if(d.start_date>d.end_date)throw new WorkError(422,'Неверный период');await validUsers(user,[d.user_id]);
      const created=await rows('INSERT INTO resource_absences(workspace_id,user_id,start_date,end_date,unavailable_percent,label) VALUES(?,?,?,?,?,?)',[user.workspace_id,d.user_id,d.start_date,d.end_date,d.unavailable_percent,d.label]);return reply({id:created.insertId},201);
    }
    if(method==='POST'&&path[1]==='allocation'){
      const d=z.object({user_id:positiveId,project_id:positiveId,start_date:dateOnly,end_date:dateOnly,hours_per_day:z.number().positive().max(24)}).parse(await body(request));
      if(d.start_date>d.end_date)throw new WorkError(422,'Неверный период');await projectFor(user,d.project_id,'project.edit',true);await validUsers(user,[d.user_id],d.project_id);
      const created=await rows('INSERT INTO resource_allocations(project_id,user_id,start_date,end_date,hours_per_day) VALUES(?,?,?,?,?)',[d.project_id,d.user_id,d.start_date,d.end_date,d.hours_per_day]);return reply({id:created.insertId},201);
    }
    if(method==='DELETE'&&['absence','allocation'].includes(path[1])){
      const id=positiveId.parse(path[2]);
      if(path[1]==='absence')await rows('DELETE FROM resource_absences WHERE id=? AND workspace_id=?',[id,user.workspace_id]);
      else{const record=await one('SELECT * FROM resource_allocations WHERE id=?',[id]);if(!record)throw new WorkError(404,'Распределение не найдено');await projectFor(user,record.project_id,'project.edit');await rows('DELETE FROM resource_allocations WHERE id=?',[id]);}
      return reply({ok:true});
    }
  }
  if(path[0]==='portfolio'){
    if(['POST','DELETE'].includes(method)&&path[1]==='dependencies'){
      const d=z.object({task_id:positiveId,depends_on_task_id:positiveId,version_number:positiveId}).parse(await body(request));
      await transaction(async c=>{
        await c.query('SELECT id FROM workspaces WHERE id=? FOR UPDATE',[user.workspace_id]);
        const [[task]]=await c.query('SELECT * FROM tasks WHERE id=? FOR UPDATE',[d.task_id]);
        const parent=await one('SELECT project_id FROM tasks WHERE id=?',[d.depends_on_task_id]);
        if(!task||!parent)throw new WorkError(404,'Задача не найдена');
        await projectFor(user,task.project_id,'task.edit',true);await projectFor(user,parent.project_id);
        if(task.version_number!==d.version_number)throw new WorkError(409,'Задача изменилась. Обновите список перед изменением связи');
        if(method==='POST'){await assertDependencyCycle(c,d.task_id,d.depends_on_task_id);await c.query("INSERT INTO task_dependencies(task_id,depends_on_task_id,dependency_type) VALUES(?,?,'blocks') ON DUPLICATE KEY UPDATE dependency_type='blocks'",[d.task_id,d.depends_on_task_id]);}
        else await c.query('DELETE FROM task_dependencies WHERE task_id=? AND depends_on_task_id=?',[d.task_id,d.depends_on_task_id]);
        await c.query('UPDATE tasks SET version_number=version_number+1 WHERE id=?',[d.task_id]);
        await c.query("INSERT INTO task_revisions(task_id,changed_by,version_number,change_type,changes_json) VALUES(?,?,?,'dependency',?)",[d.task_id,user.id,task.version_number+1,JSON.stringify({operation:method,depends_on_task_id:d.depends_on_task_id})]);
        await emitEvent({workspaceId:user.workspace_id,eventType:'task.updated',aggregateType:'task',aggregateId:task.id,payload:{task_id:task.id,project_id:task.project_id,changed_fields:['dependencies']}},c);
      });return reply({ok:true});
    }
    const projects=await visibleProjects(user,'report.view'),ids=projects.map(p=>p.id);
    const tasks=ids.length?await rows(`SELECT t.id,t.project_id,t.title,t.start_date,t.due_date,t.progress,t.version_number,CONCAT(p.key_code,'-',t.task_number) AS task_key FROM tasks t JOIN projects p ON p.id=t.project_id WHERE t.project_id IN (${ids.map(()=>'?')})`,ids):[];
    const dependencies=ids.length?await rows(`SELECT d.* FROM task_dependencies d JOIN tasks t ON t.id=d.task_id WHERE t.project_id IN (${ids.map(()=>'?')}) AND d.dependency_type='blocks'`,ids):[];
    if(method==='POST'&&path[1]==='baseline'){
      await workspaceFor(user,'portfolio.manage');const d=z.object({name:z.string().trim().min(2).max(180)}).parse(await body(request));
      const created=await rows('INSERT INTO portfolio_baselines(workspace_id,name,created_by,snapshot_json) VALUES(?,?,?,?)',[user.workspace_id,d.name,user.id,JSON.stringify(tasks)]);return reply({id:created.insertId},201);
    }
    if(method==='GET'||(method==='POST'&&path[1]==='scenario')){
      const d=method==='POST'?z.object({shifts:z.record(z.coerce.number().int().min(-365).max(365))}).parse(await body(request)):{shifts:{}};
      const baselineRows=await rows('SELECT * FROM portfolio_baselines WHERE workspace_id=? ORDER BY id DESC LIMIT 20',[user.workspace_id]);
      return reply({projects,tasks,dependencies:dependencies.filter(e=>tasks.some(t=>Number(t.id)===Number(e.depends_on_task_id))),schedule:portfolioSchedule(tasks,dependencies,d.shifts),baselines:baselineRows.map(b=>({...b,snapshot_json:undefined,snapshot:parseJson(b.snapshot_json,[]).filter(t=>ids.includes(t.project_id))}))});
    }
  }
  throw new WorkError(404,'Маршрут планирования не найден');
}
