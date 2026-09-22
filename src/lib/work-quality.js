import {apiBackgroundAllowed} from './api-access.js';
import crypto from 'node:crypto';
import {z} from 'zod';
import {rows,one,transaction,parseJson} from './db.js';
import {projectFor,positiveId,body,reply,WorkError,visibleProjects} from './work-common.js';
import {projectPermissionSet} from './permissions.js';
import {createWorkTask} from './work-tasks.js';
import {audit} from './audit.js';
export const qualityCaseSchema=z.object({project_id:positiveId,title:z.string().trim().min(2).max(300),preconditions:z.string().max(10000).default(''),steps:z.array(z.object({action:z.string().trim().min(1).max(2000),expected:z.string().trim().min(1).max(2000)})).min(1).max(100),automation_key:z.string().trim().min(1).max(200).nullable().default(null),priority:z.enum(['critical','high','medium','low']).default('medium'),task_ids:z.array(positiveId).max(100).default([]),archived:z.boolean().default(false),revision:positiveId.optional()}).strict();
export const qualityResultsSchema=z.object({request_id:z.string().uuid(),results:z.array(z.object({case_id:positiveId,revision:positiveId,result:z.enum(['passed','failed','blocked','skipped']),notes:z.string().max(10000).default(''),defect_task_id:positiveId.nullable().default(null)}).strict()).min(1).max(500)}).strict().superRefine((d,ctx)=>{if(new Set(d.results.map(r=>r.case_id)).size!==d.results.length)ctx.addIssue({code:'custom',message:'Кейс повторён в пакете результатов'});});
async function access(user,id,permission='qa.view'){
 const project=await projectFor(user,id),permissions=await projectPermissionSet(user,project);
 if(permission==='qa.view'?[...permissions].every(k=>!['qa.view','qa.manage','qa.execute'].includes(k)):!permissions.has(permission))throw new WorkError(403,'Нет доступа к тестированию');
 if(permission!=='qa.view'&&project.status!=='active')throw new WorkError(409,'Проект в архиве');return project;
}
async function tasksInProject(projectId,ids){if(!ids.length)return;const found=await rows(`SELECT id FROM tasks WHERE project_id=? AND id IN (${ids.map(()=>'?').join(',')})`,[projectId,...ids]);if(found.length!==new Set(ids).size)throw new WorkError(422,'Связанная задача не принадлежит проекту');}
const mapCase=row=>({...row,archived:Boolean(row.archived),steps:parseJson(row.steps_json,[])});
export async function qualityApi(request,path,user){
 const method=request.method,params=new URL(request.url).searchParams;
 if(path.length===1&&method==='GET'){
  const project=await access(user,positiveId.parse(params.get('project_id')));
  const [cases,plans,runs]=await Promise.all([rows('SELECT * FROM quality_cases WHERE project_id=? ORDER BY archived,id DESC LIMIT 1000',[project.id]),rows('SELECT p.*,COUNT(pc.case_id) AS case_count FROM quality_plans p LEFT JOIN quality_plan_cases pc ON pc.plan_id=p.id WHERE p.project_id=? GROUP BY p.id ORDER BY p.id DESC LIMIT 200',[project.id]),rows('SELECT r.*,p.title AS plan_title,COUNT(i.case_id) AS total,SUM(i.result=\'passed\') AS passed,SUM(i.result=\'failed\') AS failed FROM quality_runs r JOIN quality_plans p ON p.id=r.plan_id LEFT JOIN quality_run_items i ON i.run_id=r.id WHERE p.project_id=? GROUP BY r.id,p.title ORDER BY r.id DESC LIMIT 200',[project.id])]);
  return reply({cases:cases.map(mapCase),plans,runs});
 }
 if(path[1]==='cases'){
  const existing=path[2]?await one('SELECT * FROM quality_cases WHERE id=?',[positiveId.parse(path[2])]):null;
  if(path[2]&&!existing)throw new WorkError(404,'Тест-кейс не найден');
  if(method==='GET'&&existing){await access(user,existing.project_id);return reply({...mapCase(existing),task_ids:(await rows('SELECT task_id FROM quality_case_tasks WHERE case_id=?',[existing.id])).map(r=>r.task_id)});}
  if(!['POST','PUT'].includes(method))throw new WorkError(405,'Метод не поддерживается');
  const d=qualityCaseSchema.parse(await body(request));await access(user,d.project_id,'qa.manage');if(existing&&existing.project_id!==d.project_id)throw new WorkError(422,'Проект кейса не меняется');await tasksInProject(d.project_id,d.task_ids);
  const id=await transaction(async c=>{
   let id=existing?.id;
   if(id){const [changed]=await c.query('UPDATE quality_cases SET title=?,preconditions=?,steps_json=?,automation_key=?,priority=?,archived=?,revision=revision+1 WHERE id=? AND revision=?',[d.title,d.preconditions,JSON.stringify(d.steps),d.automation_key,d.priority,d.archived,id,d.revision||0]);if(!changed.affectedRows)throw new WorkError(409,'Тест-кейс изменён другим пользователем');}
   else{const [created]=await c.query('INSERT INTO quality_cases(project_id,title,preconditions,steps_json,automation_key,priority,created_by) VALUES(?,?,?,?,?,?,?)',[d.project_id,d.title,d.preconditions,JSON.stringify(d.steps),d.automation_key,d.priority,user.id]);id=created.insertId;}
   await c.query('DELETE FROM quality_case_tasks WHERE case_id=?',[id]);for(const taskId of new Set(d.task_ids))await c.query('INSERT INTO quality_case_tasks(case_id,task_id) VALUES(?,?)',[id,taskId]);return id;
  });await audit(user,'quality.case.saved','quality_case',id);return reply({id});
 }
 if(path[1]==='plans'&&path[2]&&method==='GET'){
  const plan=await one('SELECT * FROM quality_plans WHERE id=?',[positiveId.parse(path[2])]);if(!plan)throw new WorkError(404,'План не найден');await access(user,plan.project_id);return reply({...plan,case_ids:(await rows('SELECT case_id FROM quality_plan_cases WHERE plan_id=?',[plan.id])).map(r=>r.case_id)});
 }
 if(path[1]==='plans'&&['POST','PUT'].includes(method)){
  const d=z.object({project_id:positiveId,title:z.string().trim().min(2).max(200),release_id:positiveId.nullable().default(null),case_ids:z.array(positiveId).min(1).max(500),revision:positiveId.optional()}).parse(await body(request));await access(user,d.project_id,'qa.manage');
  if(d.release_id&&!await one('SELECT id FROM releases WHERE id=? AND project_id=?',[d.release_id,d.project_id]))throw new WorkError(422,'Релиз не принадлежит проекту');
  const cases=await rows(`SELECT id FROM quality_cases WHERE project_id=? AND archived=FALSE AND id IN (${d.case_ids.map(()=>'?').join(',')})`,[d.project_id,...d.case_ids]);if(cases.length!==new Set(d.case_ids).size)throw new WorkError(422,'Кейс недоступен или архивирован');
  const id=await transaction(async c=>{let id=path[2]?positiveId.parse(path[2]):null;if(id){const [changed]=await c.query('UPDATE quality_plans SET title=?,release_id=?,revision=revision+1 WHERE id=? AND project_id=? AND revision=?',[d.title,d.release_id,id,d.project_id,d.revision||0]);if(!changed.affectedRows)throw new WorkError(409,'План изменён или недоступен');}else{const [created]=await c.query('INSERT INTO quality_plans(project_id,title,release_id,created_by) VALUES(?,?,?,?)',[d.project_id,d.title,d.release_id,user.id]);id=created.insertId;}await c.query('DELETE FROM quality_plan_cases WHERE plan_id=?',[id]);for(const caseId of new Set(d.case_ids))await c.query('INSERT INTO quality_plan_cases(plan_id,case_id) VALUES(?,?)',[id,caseId]);return id;});return reply({id});
 }
 if(path[1]==='runs'&&method==='POST'&&!path[2]){
  const d=z.object({plan_id:positiveId,title:z.string().trim().min(2).max(200)}).parse(await body(request)),plan=await one('SELECT * FROM quality_plans WHERE id=?',[d.plan_id]);if(!plan)throw new WorkError(404,'План не найден');await access(user,plan.project_id,'qa.execute');
  const id=await transaction(async c=>{const [[currentPlan]]=await c.query('SELECT * FROM quality_plans WHERE id=? FOR UPDATE',[plan.id]);const [cases]=await c.query('SELECT c.* FROM quality_cases c JOIN quality_plan_cases pc ON pc.case_id=c.id WHERE pc.plan_id=? AND c.archived=FALSE ORDER BY c.id',[plan.id]);if(!cases.length)throw new WorkError(422,'В плане нет активных кейсов');const [created]=await c.query('INSERT INTO quality_runs(plan_id,title,release_id,created_by) VALUES(?,?,?,?)',[plan.id,d.title,currentPlan.release_id,user.id]);for(const item of cases)await c.query('INSERT INTO quality_run_items(run_id,case_id,snapshot_json) VALUES(?,?,?)',[created.insertId,item.id,JSON.stringify(mapCase(item))]);return created.insertId;});await audit(user,'quality.run.created','quality_run',id);return reply({id},201);
 }
 if(path[1]==='runs'&&path[2]){
  const run=await one('SELECT r.*,p.project_id FROM quality_runs r JOIN quality_plans p ON p.id=r.plan_id WHERE r.id=?',[positiveId.parse(path[2])]);if(!run)throw new WorkError(404,'Прогон не найден');await access(user,run.project_id,method==='GET'?'qa.view':'qa.execute');
  if(method==='GET')return reply({...run,items:(await rows('SELECT * FROM quality_run_items WHERE run_id=? ORDER BY case_id',[run.id])).map(item=>({...item,snapshot:parseJson(item.snapshot_json,{})})),history:await rows('SELECT h.*,u.display_name AS actor FROM quality_result_history h LEFT JOIN users u ON u.id=h.user_id WHERE h.run_id=? ORDER BY h.id DESC LIMIT 500',[run.id])});
  if(method==='POST'&&path[3]==='complete')return transaction(async c=>{const [[locked]]=await c.query('SELECT status FROM quality_runs WHERE id=? FOR UPDATE',[run.id]);if(locked.status==='completed')return reply({ok:true});const [[counts]]=await c.query("SELECT COUNT(*) AS remaining FROM quality_run_items WHERE run_id=? AND result='untested'",[run.id]);if(counts.remaining)throw new WorkError(409,'Сначала отметьте все кейсы, включая пропущенные');await c.query("UPDATE quality_runs SET status='completed',completed_at=CURRENT_TIMESTAMP WHERE id=?",[run.id]);return reply({ok:true});});
  if(method==='POST'&&path[3]==='results'){
   const d=qualityResultsSchema.parse(await body(request));
   const result=await recordQualityResults(user,run,d);await audit(user,'quality.results.recorded','quality_run',run.id,{request_id:d.request_id,count:d.results.length});return reply(result);
  }
  if(method==='POST'&&path[3]==='defect'){
   if(user.api_token_id&&!await apiBackgroundAllowed(user,user.api_token_id,'tasks:write'))throw new WorkError(403,'Для создания дефекта нужен scope tasks:write');
   const d=z.object({case_id:positiveId,revision:positiveId,description:z.string().max(10000)}).parse(await body(request));await projectFor(user,run.project_id,'task.create',true);
   return transaction(async c=>{const [[locked]]=await c.query('SELECT status FROM quality_runs WHERE id=? FOR UPDATE',[run.id]);if(locked.status!=='open')throw new WorkError(409,'Прогон завершён');const [[item]]=await c.query('SELECT * FROM quality_run_items WHERE run_id=? AND case_id=? FOR UPDATE',[run.id,d.case_id]);if(!item)throw new WorkError(404,'Кейс отсутствует в прогоне');if(item.defect_task_id)return reply({task_id:item.defect_task_id});if(item.revision!==d.revision)throw new WorkError(409,'Результат изменён');const snapshot=parseJson(item.snapshot_json,{}),task=await createWorkTask(user,run.project_id,{title:`Ошибка: ${snapshot.title}`.slice(0,300),description:`Прогон: ${run.title}\nКейс: ${snapshot.title}\n\n${d.description}`,priority:snapshot.priority||'medium'},c);await c.query("UPDATE quality_run_items SET defect_task_id=?,result='failed',revision=revision+1,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE run_id=? AND case_id=?",[task.task_id,user.id,run.id,d.case_id]);await c.query("INSERT INTO quality_result_history(run_id,case_id,result,notes,defect_task_id,user_id) VALUES(?,?,'failed',?,?,?)",[run.id,d.case_id,d.description,task.task_id,user.id]);return reply(task,201);});
  }
 }
 throw new WorkError(404,'Метод тестирования не найден');
}
export async function recordQualityResults(user,run,d){
 const fingerprint=crypto.createHash('sha256').update(JSON.stringify(d.results)).digest('hex');
 return transaction(async c=>{
  const [[locked]]=await c.query('SELECT status FROM quality_runs WHERE id=? FOR UPDATE',[run.id]);
  const [[prior]]=await c.query('SELECT fingerprint,user_id FROM quality_result_batches WHERE run_id=? AND request_id=?',[run.id,d.request_id]);
  if(prior){if(prior.fingerprint!==fingerprint||prior.user_id!==user.id)throw new WorkError(409,'Ключ запроса уже использован для других результатов');return {replayed:true,count:d.results.length};}
  if(locked.status!=='open')throw new WorkError(409,'Прогон завершён');
  await tasksInProject(run.project_id,d.results.map(r=>r.defect_task_id).filter(Boolean));
  for(const result of d.results){const [changed]=await c.query('UPDATE quality_run_items SET result=?,notes=?,defect_task_id=?,revision=revision+1,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE run_id=? AND case_id=? AND revision=?',[result.result,result.notes,result.defect_task_id,user.id,run.id,result.case_id,result.revision]);if(!changed.affectedRows)throw new WorkError(409,'Кейс отсутствует в прогоне или результат изменён');await c.query('INSERT INTO quality_result_history(run_id,case_id,result,notes,defect_task_id,user_id) VALUES(?,?,?,?,?,?)',[run.id,result.case_id,result.result,result.notes,result.defect_task_id,user.id]);}
  await c.query('INSERT INTO quality_result_batches(run_id,request_id,fingerprint,user_id) VALUES(?,?,?,?)',[run.id,d.request_id,fingerprint,user.id]);return {count:d.results.length,replayed:false};
 });
}
