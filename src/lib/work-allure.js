import {z} from 'zod';
import {rows,one,transaction,parseJson} from './db.js';
import {body,reply,positiveId,projectFor,WorkError} from './work-common.js';
import {projectPermissionSet} from './permissions.js';
import {apiBackgroundAllowed} from './api-access.js';
import {createWorkTask} from './work-tasks.js';
import {audit} from './audit.js';
import {emitEvent} from './events.js';
import {normalizeAllure,allureFingerprint,allureReportUrl} from './allure-format.js';
const connectionSchema=z.object({project_id:positiveId,name:z.string().trim().min(2).max(160),report_base_url:z.string().max(1000).default(''),key_strategy:z.enum(['historyId','fullName','testCaseId']).default('historyId'),create_missing:z.boolean().default(false),enabled:z.boolean().default(true),revision:positiveId.optional()}).strict();
export async function allureAccess(user,id,write=false){
 const project=await projectFor(user,id),rights=await projectPermissionSet(user,project);
 if(write?!rights.has('qa.execute'):!['qa.view','qa.execute','qa.manage'].some(key=>rights.has(key)))throw new WorkError(403,'Нет доступа к результатам Allure');
 if(write&&project.status!=='active')throw new WorkError(409,'Проект находится в архиве');return project;
}
async function connectionFor(user,id,write=false){const value=await one('SELECT * FROM allure_connections WHERE id=? AND workspace_id=?',[positiveId.parse(id),user.workspace_id]);if(!value)throw new WorkError(404,'Подключение Allure не найдено');await allureAccess(user,value.project_id,write);return value;}
export async function importAllure(user,connection,input,{preview=false}={}){
 await allureAccess(user,connection.project_id,true);
 if(!connection.enabled)throw new WorkError(409,'Подключение Allure приостановлено');
 const value=normalizeAllure(input,connection.key_strategy);
 if(value.report_url&&!connection.report_base_url)throw new WorkError(422,'Сначала настройте адрес отчётов в подключении Allure');
 value.report_url=allureReportUrl(value.report_url,connection.report_base_url);
 const cases=await rows('SELECT id,automation_key,archived FROM quality_cases WHERE project_id=? AND automation_key IS NOT NULL',[connection.project_id]);
 const missing=value.results.filter(r=>!cases.some(c=>c.automation_key===r.key)).map(r=>r.key),archived=value.results.filter(r=>cases.some(c=>c.automation_key===r.key&&c.archived)).map(r=>r.key);
 const rights=await projectPermissionSet(user,connection.project_id),canCreate=Boolean(connection.create_missing&&rights.has('qa.manage'));
 if(preview)return {summary:value.summary,results:value.results,missing,archived,can_import:!archived.length&&(!missing.length||canCreate),will_create:canCreate?missing.length:0};
 const fingerprint=allureFingerprint(value);
 const result=await transaction(async c=>{
  const [[lockedProject]]=await c.query('SELECT id,status FROM projects WHERE id=? FOR UPDATE',[connection.project_id]);
  if(!lockedProject||lockedProject.status!=='active')throw new WorkError(409,'Проект архивирован во время импорта');
  const [[current]]=await c.query('SELECT * FROM allure_connections WHERE id=? FOR UPDATE',[connection.id]);
  if(!current?.enabled||current.revision!==connection.revision)throw new WorkError(409,'Подключение изменилось, повторите импорт');
  const [[previous]]=await c.query('SELECT * FROM allure_imports WHERE connection_id=? AND external_id=?',[connection.id,value.external_id]);
  if(previous){if(previous.fingerprint!==fingerprint)throw new WorkError(409,'Этот идентификатор запуска уже использован для других результатов');return {id:previous.id,run_id:previous.run_id,summary:parseJson(previous.summary_json),replayed:true};}
  if(archived.length)throw new WorkError(409,'Некоторые тест-кейсы архивированы; проверьте предварительный просмотр');
  if(missing.length&&!canCreate)throw new WorkError(422,'Нет тест-кейсов с нужными ключами. Создайте их или разрешите создание в подключении; импортёру требуется qa.manage');
  const [run]=await c.query("INSERT INTO quality_runs(plan_id,title,status,created_by,completed_at) VALUES(?,?,'completed',?,CURRENT_TIMESTAMP)",[connection.plan_id,value.title,user.id]);
  const mapped=[];
  for(const item of value.results){
   let [[test]]=await c.query('SELECT * FROM quality_cases WHERE project_id=? AND automation_key=? FOR UPDATE',[connection.project_id,item.key]);
   if(test&&test.automation_key!==item.key)throw new WorkError(422,'Ключи автотестов различаются только регистром или диакритикой; используйте historyId');
   if(test?.archived)throw new WorkError(409,'Тест-кейс архивирован во время импорта');
   if(!test){
    if(!canCreate)throw new WorkError(422,'Тест-кейс недоступен');
    const severity=item.labels.find(l=>l.name==='severity')?.value;
    const priority=['blocker','critical'].includes(severity)?'critical':['minor','trivial'].includes(severity)?'low':'medium';
    const steps=(item.steps.length?item.steps.map(s=>({action:s.name||item.name,expected:'Успешное выполнение проверки'})):[{action:item.full_name||item.name,expected:'Успешное выполнение автотеста'}]);
    const [created]=await c.query('INSERT INTO quality_cases(project_id,title,preconditions,steps_json,automation_key,priority,created_by) VALUES(?,?,?,?,?,?,?)',[connection.project_id,item.name,'Кейс создан из результата Allure',JSON.stringify(steps),item.key,priority,user.id]);
    test={id:created.insertId,project_id:connection.project_id,title:item.name,preconditions:'Кейс создан из результата Allure',steps_json:steps,automation_key:item.key,priority,revision:1};
   }
   const notes=[`Allure: ${item.status}; попыток: ${item.attempts}${item.flaky?'; нестабильный тест':''}`,item.message,item.trace].filter(Boolean).join('\n').slice(0,10000);
   await c.query('INSERT IGNORE INTO quality_plan_cases(plan_id,case_id) VALUES(?,?)',[connection.plan_id,test.id]);
   await c.query('INSERT INTO quality_run_items(run_id,case_id,snapshot_json,result,notes,updated_by,updated_at) VALUES(?,?,?,?,?,?,CURRENT_TIMESTAMP)',[run.insertId,test.id,JSON.stringify({...test,steps:parseJson(test.steps_json,[])}),item.result,notes,user.id]);
   await c.query('INSERT INTO quality_result_history(run_id,case_id,result,notes,user_id) VALUES(?,?,?,?,?)',[run.insertId,test.id,item.result,notes,user.id]);
   mapped.push({...item,case_id:test.id});
  }
  const [saved]=await c.query('INSERT INTO allure_imports(connection_id,run_id,external_id,fingerprint,report_url,summary_json,results_json,created_by) VALUES(?,?,?,?,?,?,?,?)',[connection.id,run.insertId,value.external_id,fingerprint,value.report_url,JSON.stringify(value.summary),JSON.stringify(mapped),user.id]);
  await emitEvent({workspaceId:user.workspace_id,eventType:'quality.allure.imported',aggregateType:'quality_run',aggregateId:run.insertId,payload:{project_id:connection.project_id,run_id:run.insertId,allure_import_id:saved.insertId,failed:value.summary.failed+value.summary.broken+value.summary.unknown}},c);
  return {id:saved.insertId,run_id:run.insertId,summary:value.summary,replayed:false};
 });
 if(!result.replayed)await audit(user,'allure.imported','quality_run',result.run_id,{connection_id:connection.id,count:value.results.length});return result;
}
export async function allureApi(request,path,user){
 const method=request.method,params=new URL(request.url).searchParams;
 if(path.length===1&&method==='GET'){
  const project=await allureAccess(user,positiveId.parse(params.get('project_id')));
  const connections=await rows('SELECT * FROM allure_connections WHERE workspace_id=? AND project_id=? ORDER BY id DESC',[user.workspace_id,project.id]);
  const imports=await rows('SELECT i.id,i.connection_id,i.run_id,i.external_id,i.report_url,i.summary_json,i.created_at,u.display_name AS actor,c.name AS connection_name,r.title FROM allure_imports i JOIN allure_connections c ON c.id=i.connection_id JOIN quality_runs r ON r.id=i.run_id JOIN users u ON u.id=i.created_by WHERE c.workspace_id=? AND c.project_id=? ORDER BY i.id DESC LIMIT 100',[user.workspace_id,project.id]);
  return reply({connections:connections.map(c=>({...c,enabled:Boolean(c.enabled),create_missing:Boolean(c.create_missing)})),imports:imports.map(({summary_json,...r})=>({...r,summary:parseJson(summary_json,{})}))});
 }
 if(path[1]==='imports'&&path[2]&&method==='GET'){
  const item=await one('SELECT i.*,c.project_id FROM allure_imports i JOIN allure_connections c ON c.id=i.connection_id WHERE i.id=? AND c.workspace_id=?',[positiveId.parse(path[2]),user.workspace_id]);if(!item)throw new WorkError(404,'Импорт не найден');await allureAccess(user,item.project_id);const {results_json,summary_json,fingerprint,...publicItem}=item;const defects=await rows('SELECT case_id,defect_task_id FROM quality_run_items WHERE run_id=?',[item.run_id]);return reply({...publicItem,results:parseJson(results_json,[]).map(r=>({...r,defect_task_id:defects.find(d=>d.case_id===r.case_id)?.defect_task_id||null})),summary:parseJson(summary_json,{})});
 }
 if(path[1]==='imports'&&path[2]&&path[3]==='defect'&&method==='POST'){
  const item=await one('SELECT i.*,c.project_id FROM allure_imports i JOIN allure_connections c ON c.id=i.connection_id WHERE i.id=? AND c.workspace_id=?',[positiveId.parse(path[2]),user.workspace_id]);
  if(!item)throw new WorkError(404,'Импорт не найден');await allureAccess(user,item.project_id,true);await projectFor(user,item.project_id,'task.create',true);
  if(!await apiBackgroundAllowed(user,user.api_token_id,'tasks:write'))throw new WorkError(403,'Для дефекта нужен scope tasks:write');
  const d=z.object({case_id:positiveId}).strict().parse(await body(request));
  return reply(await transaction(async c=>{
   const [[result]]=await c.query('SELECT * FROM quality_run_items WHERE run_id=? AND case_id=? FOR UPDATE',[item.run_id,d.case_id]);
   if(!result||!['failed','blocked'].includes(result.result))throw new WorkError(422,'Для этого результата дефект не требуется');
   if(result.defect_task_id)return {task_id:result.defect_task_id};
   const snapshot=parseJson(result.snapshot_json,{});
   const task=await createWorkTask(user,item.project_id,{title:`Ошибка автотеста: ${snapshot.title}`.slice(0,300),description:`Allure, прогон #${item.run_id}\n${item.report_url}\n\n${result.notes||''}`.slice(0,10000),priority:snapshot.priority||'medium'},c);
   await c.query('UPDATE quality_run_items SET defect_task_id=?,revision=revision+1,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE run_id=? AND case_id=?',[task.task_id,user.id,item.run_id,d.case_id]);
   await c.query('INSERT INTO quality_result_history(run_id,case_id,result,notes,defect_task_id,user_id) VALUES(?,?,?,?,?,?)',[item.run_id,d.case_id,result.result,'Дефект по результатам Allure',task.task_id,user.id]);return task;
  }),201);
 }
 if(path[1]==='connections'&&['POST','PUT'].includes(method)&&path.length<=3){
  const d=connectionSchema.parse(await body(request));await projectFor(user,d.project_id,'qa.manage',true);d.report_base_url=allureReportUrl(d.report_base_url);
  let id;
  if(path[2]){const current=await connectionFor(user,path[2]);if(current.project_id!==d.project_id)throw new WorkError(422,'Проект подключения не меняется');const changed=await rows('UPDATE allure_connections SET name=?,report_base_url=?,key_strategy=?,create_missing=?,enabled=?,revision=revision+1 WHERE id=? AND revision=?',[d.name,d.report_base_url,d.key_strategy,d.create_missing,d.enabled,current.id,d.revision||0]);if(!changed.affectedRows)throw new WorkError(409,'Подключение изменено другим пользователем');id=current.id;}
  else id=await transaction(async c=>{const [plan]=await c.query('INSERT INTO quality_plans(project_id,title,created_by) VALUES(?,?,?)',[d.project_id,`Allure · ${d.name}`.slice(0,200),user.id]);const [created]=await c.query('INSERT INTO allure_connections(workspace_id,project_id,plan_id,name,report_base_url,key_strategy,create_missing,enabled,created_by) VALUES(?,?,?,?,?,?,?,?,?)',[user.workspace_id,d.project_id,plan.insertId,d.name,d.report_base_url,d.key_strategy,d.create_missing,d.enabled,user.id]);return created.insertId;});
  await audit(user,'allure.connection.saved','allure_connection',id);return reply({id});
 }
 if(path[1]==='connections'&&path[2]&&['import','preview'].includes(path[3])&&method==='POST'){
  const connection=await connectionFor(user,path[2],true);return reply(await importAllure(user,connection,await body(request),{preview:path[3]==='preview'}));
 }
 throw new WorkError(404,'Метод Allure не найден');
}
