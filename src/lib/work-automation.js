import {queueAutomationIntegration,validateAutomationIntegrations,automationConnection} from './automation-integrations.js';
import { one,rows,transaction,parseJson } from './db.js';
import { automationSchema,conditionsMatch,traceFlow } from './automation-flow.js';
import { WorkError,workspaceFor,projectFor,positiveId,reply,body,validUsers } from './work-common.js';
import { createNotification,emitEvent } from './events.js';
import { changeTask,createWorkTask } from './work-tasks.js';
import { fieldAccess,redactFields } from './work-access.js';
import { audit } from './audit.js';

export async function automationApi(request,path,user){
  await workspaceFor(user,'automation.manage');
  const method=request.method;
  if(method==='GET'){
    if(path[2]==='runs')return reply(await rows('SELECT run.id,run.status,run.started_at,run.finished_at,run.error_text,run.result_json,run.step_results_json FROM automation_runs run JOIN automation_rules rule ON rule.id=run.rule_id WHERE rule.workspace_id=? AND rule.id=? ORDER BY run.id DESC LIMIT 100',[user.workspace_id,positiveId.parse(path[1])]));
    return reply((await rows('SELECT * FROM automation_rules WHERE workspace_id=? ORDER BY id DESC',[user.workspace_id])).map(r=>({...r,conditions:parseJson(r.conditions_json,[]),actions:parseJson(r.actions_json,[]),trigger_config:parseJson(r.trigger_config_json,{})})));
  }
  if(method==='POST'&&path[1]==='preview'){
    const input=await body(request),rule=automationSchema.parse(input.rule);
    const task=await one('SELECT * FROM tasks WHERE id=?',[positiveId.parse(input.task_id)]);if(!task)throw new WorkError(404,'Задача не найдена');
    await projectFor(user,task.project_id);
    if(rule.project_id&&Number(rule.project_id)!==Number(task.project_id))throw new WorkError(422,'Выберите задачу проекта правила');
    await validateAutomationIntegrations(user,rule);
    const safe=redactFields(task,await fieldAccess(user,task.project_id)),context={...safe,task_id:task.id,custom_values:parseJson(safe.custom_values_json,{})};
    const steps=conditionsMatch(rule.conditions,context)?traceFlow(rule.actions,context):[];
    for(const step of steps)if(step.action?.type==='integration_send'){const item=await automationConnection(user,step.action.connection_id,task.project_id);step.preview={connection:item.name,provider:item.provider,task_id:task.id,title:task.title};}
    return reply({matched:conditionsMatch(rule.conditions,context),steps,dry_run:true});
  }
  if(['POST','PUT','PATCH'].includes(method)){
    const existing=path[1]?await one('SELECT * FROM automation_rules WHERE id=? AND workspace_id=?',[positiveId.parse(path[1]),user.workspace_id]):null;
    if(path[1]&&!existing)throw new WorkError(404,'Правило не найдено');
    const raw=await body(request);
    const data=automationSchema.parse(existing?{...existing,enabled:Boolean(existing.enabled),conditions:parseJson(existing.conditions_json,[]),actions:parseJson(existing.actions_json,[]),trigger_config:parseJson(existing.trigger_config_json,{}),...raw}:raw);
    if(data.project_id)await projectFor(user,data.project_id);
    await validateAutomationIntegrations(user,data);
    const values=[data.project_id,data.name,data.description,data.enabled,data.trigger_type,JSON.stringify(data.trigger_config),JSON.stringify(data.conditions),JSON.stringify(data.actions),user.id,data.trigger_type==='scheduled'?new Date(Date.now()+data.trigger_config.interval_minutes*60000):null];
    let ruleId=existing?.id;
    if(existing)await rows('UPDATE automation_rules SET project_id=?,name=?,description=?,enabled=?,trigger_type=?,trigger_config_json=?,conditions_json=?,actions_json=?,run_as_user_id=?,next_run_at=? WHERE id=? AND workspace_id=?',[...values,ruleId,user.workspace_id]);
    else ruleId=(await rows('INSERT INTO automation_rules(workspace_id,project_id,name,description,enabled,trigger_type,trigger_config_json,conditions_json,actions_json,run_as_user_id,next_run_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',[user.workspace_id,...values])).insertId;
    await audit(user,'automation.saved','automation_rule',ruleId,{name:data.name},request);return reply({id:ruleId});
  }
  if(method==='DELETE'){await rows('DELETE FROM automation_rules WHERE id=? AND workspace_id=?',[positiveId.parse(path[1]),user.workspace_id]);return reply({ok:true});}
  throw new WorkError(405,'Метод не поддерживается');
}
async function actionInTransaction(action,context,rule,user,c,depth){
  if(action.type==='integration_send')return queueAutomationIntegration(action,context,user,c);
  if(['notify_user','notify_assignee'].includes(action.type)){
    const recipient=action.type==='notify_user'?action.userId:context.assignee_id;
    if(!recipient)return {status:'skipped',reason:'Нет исполнителя'};
    await validUsers(user,[recipient],context.project_id);
    await createNotification(recipient,'automation.notification',action.title||'Напоминание по задаче',action.body||context.title,'task',context.task_id,`/?task=${context.task_id}`,c);
    return {status:'sent'};
  }
  if(action.type==='set_field')return changeTask(user,context.task_id,{[action.field]:action.value},c,{depth:depth+1});
  if(action.type==='create_subtask'){
    const created=await createWorkTask(user,context.project_id,{title:action.title,description:action.description||'',priority:action.priority||'medium',assignee_id:action.assigneeId||null},c,{depth:depth+1});
    await c.query('UPDATE tasks SET parent_task_id=? WHERE id=?',[context.task_id,created.task_id]);return created;
  }
  throw new WorkError(422,'Неизвестное действие автоматизации');
}
export async function runAutomationsForEvent(event){
  const payload=parseJson(event.payload_json,{}),depth=Number(payload.automation_depth||0);if(depth>=5)return {skipped:'Лимит цепочки автоматизаций'};
  const task=event.aggregate_type==='task'?await one('SELECT t.*,p.workspace_id,s.is_done,s.code AS stage_code FROM tasks t JOIN projects p ON p.id=t.project_id JOIN workflow_stages s ON s.id=t.stage_id WHERE t.id=?',[event.aggregate_id]):null;
  if(!task||Number(task.workspace_id)!==Number(event.workspace_id))return [];
  const rules=await rows("SELECT * FROM automation_rules WHERE workspace_id=? AND enabled=TRUE AND trigger_type=? AND (project_id IS NULL OR project_id=?)",[event.workspace_id,event.event_type,task.project_id]);
  const results=[];
  for(const rule of rules){
    if(payload.rule_id&&Number(payload.rule_id)!==Number(rule.id))continue;
    const actor=await one("SELECT * FROM users WHERE id=? AND workspace_id=? AND status='active'",[rule.run_as_user_id,rule.workspace_id]);
    const run=await rows("INSERT INTO automation_runs(rule_id,event_id,status,input_json,started_at) VALUES(?,?,'running',?,CURRENT_TIMESTAMP)",[rule.id,event.event_uuid,JSON.stringify({task_id:task.id,event_type:event.event_type})]);
    try{
      if(!actor)throw new WorkError(403,'Исполнитель правила отключён');
      await workspaceFor(actor,'automation.manage');await projectFor(actor,task.project_id,'project.browse',true);
      const safe=redactFields(task,await fieldAccess(actor,task.project_id));
      const context={...payload,...safe,task_id:task.id,custom_values:parseJson(safe.custom_values_json,{}),event_type:event.event_type};
      if(!conditionsMatch(parseJson(rule.conditions_json,[]),context)){await rows("UPDATE automation_runs SET status='skipped',finished_at=CURRENT_TIMESTAMP WHERE id=?",[run.insertId]);continue;}
      // Freeze the chosen branch once for this event; retries cannot choose a new branch after mutations.
      const result=await transaction(async c=>{
        await c.query('INSERT IGNORE INTO automation_executions(rule_id,event_id,step_path) VALUES(?,?,?)',[rule.id,event.event_uuid,'flow']);
        const [[execution]]=await c.query('SELECT * FROM automation_executions WHERE rule_id=? AND event_id=? AND step_path=? FOR UPDATE',[rule.id,event.event_uuid,'flow']);
        if(execution.status==='completed')return parseJson(execution.result_json,[]);
        const trace=traceFlow(parseJson(rule.actions_json,[]),context);const steps=[];
        for(const step of trace){if(!step.action){steps.push(step);continue;}steps.push({path:step.path,type:step.action.type,result:await actionInTransaction(step.action,context,rule,actor,c,depth)});}
        await c.query("UPDATE automation_executions SET status='completed',result_json=? WHERE rule_id=? AND event_id=? AND step_path='flow'",[JSON.stringify(steps),rule.id,event.event_uuid]);return steps;
      });
      await rows("UPDATE automation_runs SET status='succeeded',result_json=?,step_results_json=?,finished_at=CURRENT_TIMESTAMP WHERE id=?",[JSON.stringify(result),JSON.stringify(result),run.insertId]);
      await rows('UPDATE automation_rules SET last_run_at=CURRENT_TIMESTAMP,run_count=run_count+1 WHERE id=?',[rule.id]);results.push({ruleId:rule.id,steps:result});
    }catch(error){await rows("UPDATE automation_runs SET status='failed',error_text=?,finished_at=CURRENT_TIMESTAMP WHERE id=?",[error instanceof WorkError?error.message:'Ошибка выполнения действия',run.insertId]);await rows('UPDATE automation_rules SET error_count=error_count+1 WHERE id=?',[rule.id]);}
  }
  return results;
}
export async function scheduleAutomations(){
  return transaction(async c=>{
    const [rules]=await c.query("SELECT * FROM automation_rules WHERE enabled=TRUE AND trigger_type='scheduled' AND next_run_at<=CURRENT_TIMESTAMP LIMIT 50 FOR UPDATE SKIP LOCKED");
    for(const rule of rules){
      const interval=Math.max(5,Number(parseJson(rule.trigger_config_json,{}).interval_minutes||1440));
      const [tasks]=await c.query("SELECT t.id,t.project_id FROM tasks t JOIN projects p ON p.id=t.project_id WHERE p.workspace_id=? AND p.deleted_at IS NULL AND p.status='active' AND (? IS NULL OR p.id=?)",[rule.workspace_id,rule.project_id,rule.project_id]);
      for(const task of tasks)await emitEvent({workspaceId:rule.workspace_id,eventType:'scheduled',aggregateType:'task',aggregateId:task.id,payload:{rule_id:rule.id,task_id:task.id,project_id:task.project_id}},c);
      await c.query('UPDATE automation_rules SET next_run_at=DATE_ADD(CURRENT_TIMESTAMP,INTERVAL ? MINUTE) WHERE id=?',[interval,rule.id]);
    }
    return {scheduled:rules.length};
  });
}
