import {z} from 'zod';
import {createHash} from 'node:crypto';
import {transaction,parseJson} from './db.js';
import {body,reply,positiveId,dateOnly,projectFor,WorkError} from './work-common.js';
import {planAccess} from './work-plans.js';
import {changeTask} from './work-tasks.js';
import {apiBackgroundAllowed} from './api-access.js';
const changeSchema=z.object({kind:z.enum(['task','planned','initiative']),id:positiveId,revision:positiveId,start_date:dateOnly,due_date:dateOnly}).strict().refine(d=>d.start_date<=d.due_date,'Срок должен быть не раньше начала');
// Сохраняет только подтверждённые пользователем строки сценария одной транзакцией.
export async function applyRoadmapDates(request,user){
 const data=z.object({request_id:z.string().uuid(),changes:z.array(changeSchema).min(1).max(500).refine(items=>new Set(items.map(i=>`${i.kind}:${i.id}`)).size===items.length,'Карточки не должны повторяться')}).strict().parse(await body(request));
 const fingerprint=createHash('sha256').update(JSON.stringify(data.changes)).digest('hex');
 return transaction(async c=>{
  await c.query('SELECT id FROM workspaces WHERE id=? FOR UPDATE',[user.workspace_id]);
  const [[old]]=await c.query('SELECT * FROM work_roadmap_changes WHERE id=?',[data.request_id]);if(old&&(Number(old.workspace_id)!==Number(user.workspace_id)||Number(old.user_id)!==Number(user.id)||old.fingerprint!==fingerprint))throw new WorkError(409,'Этот запрос уже использован');
  const records=[];
  for(const change of data.changes){let record,plan=null;
   if(change.kind==='task'){if(!await apiBackgroundAllowed(user,user.api_token_id,'tasks:write'))throw new WorkError(403,'Изменение рабочих задач требует tasks:write');[[record]]=await c.query('SELECT * FROM tasks WHERE id=?',[change.id]);if(!record)throw new WorkError(404,'Карточка недоступна');await projectFor(user,record.project_id);await projectFor(user,record.project_id,'task.edit',true);}
   else{if(change.kind==='planned'){[[record]]=await c.query('SELECT * FROM work_plan_items WHERE id=?',[change.id]);if(!record)throw new WorkError(404,'Элемент плана недоступен');[[plan]]=await c.query('SELECT * FROM work_plans WHERE id=?',[record.plan_id]);if(record.state!=='planning')throw new WorkError(409,'Запланированный элемент уже изменил состояние');}else{[[plan]]=await c.query('SELECT * FROM work_plans WHERE id=?',[change.id]);record=plan;}await planAccess(user,plan,true);}
   records.push({change,record,plan});
  }
  if(old)return reply({...parseJson(old.result_json),replayed:true});
  // Порядок блокировок совпадает с передачей плана в работу: проекты, планы, затем карточки.
  const projectIds=[...new Set(records.map(r=>r.plan?.project_id||r.record.project_id).filter(Boolean))].sort((a,b)=>a-b),planIds=[...new Set(records.map(r=>r.plan?.id).filter(Boolean))].sort((a,b)=>a-b);
  for(const id of projectIds)await c.query('SELECT id FROM projects WHERE id=? FOR UPDATE',[id]);for(const id of planIds)await c.query('SELECT id FROM work_plans WHERE id=? FOR UPDATE',[id]);
  for(const {change,record,plan}of records){const table=change.kind==='task'?'tasks':change.kind==='planned'?'work_plan_items':'work_plans',[[current]]=await c.query(`SELECT * FROM ${table} WHERE id=? FOR UPDATE`,[record.id]);if(!current||Number(current.version_number||current.revision)!==change.revision)throw new WorkError(409,'Одна из карточек изменилась. Пересчитайте сценарий');
   if(change.kind==='task'){await projectFor(user,current.project_id);await changeTask(user,current.id,{start_date:change.start_date,due_date:change.due_date},c,{version:change.revision});}
   else{const [[currentPlan]]=await c.query('SELECT * FROM work_plans WHERE id=?',[plan.id]);await planAccess(user,currentPlan,true);if(change.kind==='planned'&&current.state!=='planning')throw new WorkError(409,'Задача уже передана в работу');await c.query(`UPDATE ${table} SET start_date=?,due_date=?,revision=revision+1 WHERE id=?`,[change.start_date,change.due_date,current.id]);}
  }
  const result={updated:records.length};await c.query('INSERT INTO work_roadmap_changes(id,workspace_id,user_id,fingerprint,result_json) VALUES(?,?,?,?,?)',[data.request_id,user.workspace_id,user.id,fingerprint,JSON.stringify(result)]);
  await c.query("INSERT INTO audit_log(workspace_id,actor_id,action,entity_type,entity_id,details_json) VALUES(?,?,'roadmap.dates.applied','roadmap',?,?)",[user.workspace_id,user.id,data.request_id,JSON.stringify(data.changes)]);return reply(result);
 });
}
