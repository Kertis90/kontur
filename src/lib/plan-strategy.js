import {z} from 'zod';
import {one,rows,transaction} from './db.js';
import {body,reply,positiveId,projectFor,validUsers,WorkError} from './work-common.js';
import {planAccess} from './work-plans.js';
import {apiBackgroundAllowed} from './api-access.js';
import {createNotification} from './events.js';
import {planContentHash,checkPlanDependencies,planReviewState} from './plan-content.js';
const scoreSchema=z.object({revision:z.number().int().min(0),outcome:z.string().max(6000),impact:z.number().int().min(0).max(10),effort:z.number().min(0).max(1000000),rationale:z.string().max(6000)}).strict();
// Считывает единый состав под блокировкой плана: его изменения используют тот же порядок блокировок.
export async function planSnapshot(c,plan){const [items]=await c.query('SELECT i.*,t.version_number AS task_version FROM work_plan_items i LEFT JOIN tasks t ON t.id=i.task_id WHERE i.plan_id=? ORDER BY i.id',[plan.id]),[[strategy]]=await c.query('SELECT * FROM work_plan_strategy WHERE plan_id=?',[plan.id]),[dependencies]=await c.query('SELECT * FROM work_plan_dependencies WHERE plan_id=? ORDER BY id',[plan.id]);return {items,strategy:strategy||{revision:0,outcome:'',impact:0,effort:0,rationale:''},dependencies,content_hash:planContentHash(plan,items,strategy,dependencies)};}
// Записывает решение или связь в журнал вместе с самим изменением.
async function log(c,user,plan,action,details={}){await c.query('INSERT INTO audit_log(workspace_id,actor_id,action,entity_type,entity_id,details_json) VALUES(?,?,?,?,?,?)',[user.workspace_id,user.id,action,'plan',String(plan.id),JSON.stringify(details)]);}
// Проверяет актуальное членство и право планирования назначенного согласующего.
async function reviewerFor(user,plan,id){const person=await one("SELECT * FROM users WHERE workspace_id=? AND id=? AND status='active' AND is_service=FALSE",[user.workspace_id,id]);if(!person)throw new WorkError(422,'Согласующий недоступен');await planAccess(person,plan);return person;}
// Проверяет версию оценки; её счётчик меняется и при редактировании зависимостей.
function checkScoreVersion(strategy,revision){if(Number(strategy.revision)!==Number(revision))throw new WorkError(409,'Оценка или связи изменились. Обновите план');}
// Создаёт либо обновляет оценку, не изменяя поля обычного редактора плана.
async function saveScore(c,plan,data){await c.query('INSERT INTO work_plan_strategy(plan_id,outcome,impact,effort,rationale) VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE outcome=VALUES(outcome),impact=VALUES(impact),effort=VALUES(effort),rationale=VALUES(rationale),revision=revision+1',[plan.id,data.outcome,data.impact,data.effort,data.rationale]);}
// Отдаёт обоснование, зависимости и согласования; любые записи проверяются под блокировкой плана.
export async function planStrategyApi(request,path,user){
 const id=positiveId.parse(path[1]),method=request.method;
 return transaction(async c=>{
  const [[plan]]=await c.query('SELECT * FROM work_plans WHERE id=? AND workspace_id=? FOR UPDATE',[id,user.workspace_id]);await planAccess(user,plan,method!=='GET'&&path[4]!=='decision');
  const snapshot=await planSnapshot(c,plan);
  if(method==='GET'&&path[2]==='strategy'){
   const dependencies=[];for(const d of snapshot.dependencies){if(d.depends_on_task_id){try{if(!await apiBackgroundAllowed(user,user.api_token_id,'tasks:read'))continue;const task=await one('SELECT project_id,title FROM tasks WHERE id=?',[d.depends_on_task_id]);if(!task)continue;await projectFor(user,task.project_id);dependencies.push({...d,task_title:task.title});}catch(e){if(![403,404].includes(e.status))throw e;}}else dependencies.push(d);}
   const [reviews]=await c.query('SELECT * FROM work_plan_reviews WHERE plan_id=? ORDER BY id DESC LIMIT 30',[id]);
   for(const review of reviews){const [people]=await c.query('SELECT r.*,u.display_name FROM work_plan_reviewers r JOIN users u ON u.id=r.user_id WHERE r.review_id=?',[review.id]);for(const person of people){try{await reviewerFor(user,plan,person.user_id);}catch(e){if(![403,404,422].includes(e.status))throw e;person.unavailable=true;}}review.people=people;review.status=planReviewState(review,snapshot.content_hash,people);delete review.request_id;}
   return reply({strategy:snapshot.strategy,dependencies,reviews,content_hash:snapshot.content_hash});
  }
  if(method==='PUT'&&path[2]==='strategy'){
   const data=scoreSchema.parse(await body(request));checkScoreVersion(snapshot.strategy,data.revision);await saveScore(c,plan,data);await log(c,user,plan,'plan.priority.updated');return reply({ok:true});
  }
  if(['POST','DELETE'].includes(method)&&path[2]==='dependencies'){
   const data=z.object({revision:z.number().int().min(0),item_id:positiveId,depends_on_item_id:positiveId.nullable().default(null),depends_on_task_id:positiveId.nullable().default(null)}).strict().refine(d=>Boolean(d.depends_on_item_id)!==Boolean(d.depends_on_task_id)).parse(await body(request));checkScoreVersion(snapshot.strategy,data.revision);
   const item=snapshot.items.find(i=>Number(i.id)===data.item_id);if(!item||item.state==='active')throw new WorkError(409,'Связи начатой задачи изменяются в рабочем портфеле');
   if(data.depends_on_task_id){if(!await apiBackgroundAllowed(user,user.api_token_id,'tasks:read'))throw new WorkError(403,'Нужно разрешение API на чтение задач');const task=await one('SELECT project_id FROM tasks WHERE id=?',[data.depends_on_task_id]);if(!task)throw new WorkError(404,'Задача недоступна');await projectFor(user,task.project_id);}
   if(method==='POST'){checkPlanDependencies(snapshot.items,[...snapshot.dependencies,data]);await c.query('INSERT INTO work_plan_dependencies(plan_id,item_id,depends_on_item_id,depends_on_task_id) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE plan_id=VALUES(plan_id)',[id,data.item_id,data.depends_on_item_id,data.depends_on_task_id]);}
   else await c.query('DELETE FROM work_plan_dependencies WHERE plan_id=? AND item_id=? AND depends_on_item_id<=>? AND depends_on_task_id<=>?',[id,data.item_id,data.depends_on_item_id,data.depends_on_task_id]);
   await saveScore(c,plan,snapshot.strategy);await log(c,user,plan,'plan.dependency.changed',{item_id:data.item_id});return reply({ok:true});
  }
  if(method==='POST'&&path[2]==='reviews'&&path.length===3){
   const data=z.object({content_hash:z.string().regex(/^[a-f0-9]{64}$/),request_id:z.string().uuid(),reviewer_ids:z.array(positiveId).min(1).max(20),reason:z.string().trim().min(2).max(4000)}).strict().parse(await body(request));
   if(new Set(data.reviewer_ids).size!==data.reviewer_ids.length||data.reviewer_ids.includes(Number(user.id)))throw new WorkError(422,'Выберите других участников без повторов');
   const [[old]]=await c.query('SELECT * FROM work_plan_reviews WHERE plan_id=? AND requested_by=? AND request_id=?',[id,user.id,data.request_id]);
   if(old){const [people]=await c.query('SELECT user_id FROM work_plan_reviewers WHERE review_id=?',[old.id]);if(old.content_hash!==data.content_hash||old.reason!==data.reason||JSON.stringify(people.map(p=>Number(p.user_id)).sort((a,b)=>a-b))!==JSON.stringify([...data.reviewer_ids].sort((a,b)=>a-b)))throw new WorkError(409,'Запрос уже использован с другим составом');return reply({id:old.id,replayed:true});}
   if(data.content_hash!==snapshot.content_hash)throw new WorkError(409,'Состав плана изменился. Проверьте его перед согласованием');
   await validUsers(user,data.reviewer_ids,plan.project_id);for(const person of data.reviewer_ids)await reviewerFor(user,plan,person);
   const [result]=await c.query('INSERT INTO work_plan_reviews(plan_id,content_hash,requested_by,request_id,reason) VALUES(?,?,?,?,?)',[id,data.content_hash,user.id,data.request_id,data.reason]);
   for(const person of data.reviewer_ids){await c.query('INSERT INTO work_plan_reviewers(review_id,user_id) VALUES(?,?)',[result.insertId,person]);await createNotification(person,'plan.review','План ожидает согласования',plan.title,'plan',id,`/?view=work&tab=plans&plan=${id}`,c);}
   await log(c,user,plan,'plan.review.requested',{review_id:result.insertId});return reply({id:result.insertId},201);
  }
  if(method==='POST'&&path[2]==='reviews'&&path[4]==='decision'){
   const data=z.object({decision:z.enum(['approved','rejected']),comment:z.string().trim().min(2).max(4000)}).strict().parse(await body(request));
   if(plan.archived)throw new WorkError(409,'План в архиве');
   const [[review]]=await c.query('SELECT * FROM work_plan_reviews WHERE id=? AND plan_id=?',[positiveId.parse(path[3]),id]);if(!review)throw new WorkError(404,'Согласование не найдено');
   const [people]=await c.query('SELECT * FROM work_plan_reviewers WHERE review_id=?',[review.id]);
   for(const person of people)await reviewerFor(user,plan,person.user_id);
   if(review.content_hash!==snapshot.content_hash)throw new WorkError(409,'Состав изменён. Требуется новое согласование');
   const mine=people.find(p=>Number(p.user_id)===Number(user.id));if(!mine)throw new WorkError(403,'Вы не назначены согласующим');
   if(mine.decision!=='pending'){if(mine.decision===data.decision&&mine.comment===data.comment)return reply({ok:true,replayed:true});throw new WorkError(409,'Решение уже принято');}
   await c.query('UPDATE work_plan_reviewers SET decision=?,comment=?,decided_at=CURRENT_TIMESTAMP WHERE review_id=? AND user_id=?',[data.decision,data.comment,review.id,user.id]);
   await log(c,user,plan,'plan.review.decided',{review_id:review.id,decision:data.decision});return reply({ok:true});
  }
  throw new WorkError(404,'Метод согласования плана не найден');
 });
}
