import {z} from 'zod';
import {createHash} from 'node:crypto';
import {one,rows,transaction} from './db.js';
import {body,reply,positiveId,projectFor,workspaceFor,validUsers,WorkError} from './work-common.js';
import {projectPermissionSet} from './permissions.js';
import {apiBackgroundAllowed} from './api-access.js';
import {createWorkTask} from './work-tasks.js';
import {planCreateSchema,planUpdateSchema,planItemCreateSchema,planItemUpdateSchema,checkPlanDates,checkPlanRevision} from './plan-schema.js';

// Проверяет доступ к проектному плану либо членство в проекте-черновике.
export async function planAccess(user,plan,write=false){
 if(!plan||Number(plan.workspace_id)!==Number(user.workspace_id))throw new WorkError(404,'План не найден');
 if(plan.project_id){await projectFor(user,plan.project_id);await projectFor(user,plan.project_id,'planning.view');if(write)await projectFor(user,plan.project_id,'planning.manage',true);}
 else if(!['owner','admin'].includes(user.global_role)||user.is_service){
  const member=await one('SELECT can_edit FROM work_plan_members WHERE plan_id=? AND user_id=?',[plan.id,user.id]);
  if(!member||(write&&!member.can_edit)||user.is_service)throw new WorkError(403,'Нет доступа к этому плану');
 }
 if(write&&plan.archived)throw new WorkError(409,'План в архиве');return plan;
}
// Проверяет цель и её текущую доступность без раскрытия данных чужого проекта.
async function goalFor(user,id){
 if(!id)return null;
 if(!await apiBackgroundAllowed(user,user.api_token_id,'objectives:read'))throw new WorkError(403,'Для целей требуется разрешение API на чтение целей');
 const goal=await one('SELECT o.*,p.workspace_id FROM work_objectives o JOIN projects p ON p.id=o.project_id WHERE o.id=? AND p.deleted_at IS NULL',[id]);
 if(!goal||Number(goal.workspace_id)!==Number(user.workspace_id))throw new WorkError(422,'Цель недоступна');
 const project=await projectFor(user,goal.project_id),rights=await projectPermissionSet(user,project);
 if(!['okr.view','okr.manage','okr.update'].some(key=>rights.has(key)))throw new WorkError(403,'Нет доступа к цели');return goal;
}
// Убирает ссылку и название цели из ответа после отзыва доступа.
async function withGoal(user,item){
 if(!item.objective_id)return {...item,objective_title:null};
 try {const goal=await goalFor(user,item.objective_id);return {...item,objective_title:goal.title};}
 catch(error){if(![403,404,422].includes(error.status))throw error;return {...item,objective_id:null,objective_title:'Цель недоступна'};}
}
// Записывает событие аудита в той же транзакции, что и изменение плана.
async function planAudit(connection,user,action,id,details={}){await connection.query('INSERT INTO audit_log(workspace_id,actor_id,action,entity_type,entity_id,details_json) VALUES(?,?,?,?,?,?)',[user.workspace_id,user.id,action,'plan',String(id),JSON.stringify(details)]);}
// Возвращает отпечаток исходного запроса для защиты от повторов с другим содержимым.
function fingerprint(data){return createHash('sha256').update(JSON.stringify(data)).digest('hex');}
// Проверяет исполнителя, даты, цель и родительский эпик внутри текущего плана.
async function validateItem(user,plan,data,connection,itemId=null){
 checkPlanDates(data);await validUsers(user,[data.assignee_id],plan.project_id);await goalFor(user,data.objective_id);
 if(data.parent_id){const [[parent]]=await connection.query('SELECT * FROM work_plan_items WHERE id=? AND plan_id=?',[data.parent_id,plan.id]);if(!parent||parent.kind!=='epic'||parent.state==='cancelled'||Number(parent.id)===Number(itemId))throw new WorkError(422,'Выберите доступный эпик этого плана');}
 if(itemId&&(data.kind!=='epic'||data.state==='cancelled')){const [[child]]=await connection.query("SELECT id FROM work_plan_items WHERE parent_id=? AND state<>'cancelled' LIMIT 1",[itemId]);if(child)throw new WorkError(409,'Сначала перенесите или отмените задачи эпика');}
}
// Возвращает план для рабочей области пользователя с актуальной проверкой прав.
async function findPlan(user,id,write=false){return planAccess(user,await one('SELECT * FROM work_plans WHERE id=? AND workspace_id=?',[positiveId.parse(id),user.workspace_id]),write);}
// Обрабатывает хранение планов, состав участников и безопасное начало работы.
export async function plansApi(request,path,user){
 const method=request.method,params=new URL(request.url).searchParams;
 if(path.length===1&&method==='GET'){
  const projectId=params.has('project_id')?positiveId.parse(params.get('project_id')):null;
  if(projectId){await projectFor(user,projectId);await projectFor(user,projectId,'planning.view');}
  const candidates=await rows('SELECT p.*,(SELECT COUNT(*) FROM work_plan_items i WHERE i.plan_id=p.id AND i.state=\'planning\') AS planned_count FROM work_plans p WHERE p.workspace_id=? AND (? IS NULL OR p.project_id=?) ORDER BY p.archived,p.updated_at DESC LIMIT 501',[user.workspace_id,projectId,projectId]);
  const plans=[];for(const plan of candidates.slice(0,500)){try{await planAccess(user,plan);let canEdit=true;try{await planAccess(user,plan,true);}catch(e){if(![403,409].includes(e.status))throw e;canEdit=false;}const {creation_hash,request_id,...safe}=plan;plans.push(await withGoal(user,{...safe,can_edit:canEdit}));}catch(e){if(![403,404].includes(e.status))throw e;}}
  return reply({plans,has_more:candidates.length>500});
 }
 if(path[1]==='goals'&&method==='GET'){
  const candidates=await rows('SELECT o.id FROM work_objectives o JOIN projects p ON p.id=o.project_id WHERE p.workspace_id=? AND p.deleted_at IS NULL AND o.archived=FALSE ORDER BY o.id DESC LIMIT 500',[user.workspace_id]),goals=[];
  for(const item of candidates){try{const goal=await goalFor(user,item.id);goals.push({id:goal.id,title:goal.title,project_id:goal.project_id});}catch(e){if(![403,404,422].includes(e.status))throw e;}}return reply(goals);
 }
 if(path[1]==='board'&&method==='GET'){
  const projectId=positiveId.parse(params.get('project_id'));await projectFor(user,projectId);await projectFor(user,projectId,'planning.view');
  const items=await rows("SELECT i.*,p.title AS plan_title FROM work_plan_items i JOIN work_plans p ON p.id=i.plan_id WHERE p.workspace_id=? AND p.project_id=? AND p.archived=FALSE AND i.state='planning' ORDER BY i.kind,i.created_at LIMIT 501",[user.workspace_id,projectId]);
  return reply({items:await Promise.all(items.slice(0,500).map(async({creation_hash,request_id,...item})=>withGoal(user,item))),has_more:items.length>500});
 }
 if(path.length===1&&method==='POST'){
  const data=planCreateSchema.parse(await body(request));checkPlanDates(data);await goalFor(user,data.objective_id);
  if(data.project_id){await projectFor(user,data.project_id);await projectFor(user,data.project_id,'planning.manage',true);await projectFor(user,data.project_id,'planning.view');}else await workspaceFor(user,'planning.create');
  const result=await transaction(async connection=>{
   await connection.query('SELECT id FROM workspaces WHERE id=? FOR UPDATE',[user.workspace_id]);
   const [[old]]=await connection.query('SELECT * FROM work_plans WHERE workspace_id=? AND created_by=? AND request_id=?',[user.workspace_id,user.id,data.request_id]);
   if(old){await planAccess(user,old);if(old.creation_hash!==fingerprint(data))throw new WorkError(409,'Этот запрос уже использован с другими данными');return {id:old.id,replayed:true};}
   const [created]=await connection.query('INSERT INTO work_plans(workspace_id,project_id,title,description,start_date,due_date,objective_id,created_by,request_id,creation_hash) VALUES(?,?,?,?,?,?,?,?,?,?)',[user.workspace_id,data.project_id,data.title,data.description,data.start_date,data.due_date,data.objective_id,user.id,data.request_id,fingerprint(data)]);
   await connection.query('INSERT INTO work_plan_members(plan_id,user_id,can_edit) VALUES(?,?,TRUE)',[created.insertId,user.id]);await planAudit(connection,user,'plan.created',created.insertId);return {id:created.insertId};
  });return reply(result,201);
 }
 const restoring=path.length===3&&path[2]==='restore'&&method==='POST';
 const plan=await findPlan(user,path[1],method!=='GET'&&!restoring);
 if(restoring){
  const data=z.object({revision:positiveId}).strict().parse(await body(request));
  await transaction(async connection=>{const [[current]]=await connection.query('SELECT * FROM work_plans WHERE id=? FOR UPDATE',[plan.id]);await planAccess(user,{...current,archived:false},true);checkPlanRevision(current,data.revision);await connection.query('UPDATE work_plans SET archived=FALSE,revision=revision+1 WHERE id=?',[plan.id]);await planAudit(connection,user,'plan.restored',plan.id);});return reply({ok:true});
 }
 if(path.length===2&&method==='GET'){
  const [items,members]=await Promise.all([rows('SELECT * FROM work_plan_items WHERE plan_id=? ORDER BY kind,id LIMIT 2001',[plan.id]),rows('SELECT m.*,u.display_name FROM work_plan_members m JOIN users u ON u.id=m.user_id WHERE m.plan_id=?',[plan.id])]);
  let canEdit=true;try{await planAccess(user,plan,true);}catch(e){if(![403,409].includes(e.status))throw e;canEdit=false;}
  let canRestore=false;if(plan.archived){try{await planAccess(user,{...plan,archived:false},true);canRestore=true;}catch(e){if(![403,409].includes(e.status))throw e;}}
  const {creation_hash,request_id,...safe}=plan;
  return reply({...await withGoal(user,safe),can_edit:canEdit,can_restore:canRestore,can_share:canEdit&&!plan.project_id&&(Number(plan.created_by)===Number(user.id)||['owner','admin'].includes(user.global_role)),members:plan.project_id?[]:members,items:await Promise.all(items.slice(0,2000).map(async({creation_hash,request_id,...item})=>withGoal(user,item))),has_more:items.length>2000});
 }
 if(path.length===2&&method==='PUT'){
  const data=planUpdateSchema.parse(await body(request));checkPlanDates(data);await goalFor(user,data.objective_id);
  await transaction(async connection=>{const [[current]]=await connection.query('SELECT * FROM work_plans WHERE id=? FOR UPDATE',[plan.id]);await planAccess(user,current,true);checkPlanRevision(current,data.revision);await connection.query('UPDATE work_plans SET title=?,description=?,start_date=?,due_date=?,objective_id=?,archived=?,revision=revision+1 WHERE id=?',[data.title,data.description,data.start_date,data.due_date,data.objective_id,data.archived,plan.id]);await planAudit(connection,user,'plan.updated',plan.id);});return reply({ok:true});
 }
 if(path[2]==='members'&&method==='PUT'){
  if(plan.project_id||(!['owner','admin'].includes(user.global_role)&&Number(plan.created_by)!==Number(user.id)))throw new WorkError(403,'Участниками черновика управляет автор или администратор');
  const data=z.object({revision:positiveId,members:z.array(z.object({user_id:positiveId,can_edit:z.boolean()}).strict()).max(50)}).strict().parse(await body(request));await validUsers(user,data.members.map(m=>m.user_id));
  if(new Set(data.members.map(m=>m.user_id)).size!==data.members.length)throw new WorkError(422,'Участники не должны повторяться');
  await transaction(async connection=>{const [[current]]=await connection.query('SELECT * FROM work_plans WHERE id=? FOR UPDATE',[plan.id]);await planAccess(user,current,true);if(current.project_id)throw new WorkError(409,'План уже связан с проектом');checkPlanRevision(current,data.revision);await connection.query('DELETE FROM work_plan_members WHERE plan_id=?',[plan.id]);for(const member of [{user_id:plan.created_by,can_edit:true},...data.members.filter(m=>Number(m.user_id)!==Number(plan.created_by))])await connection.query('INSERT INTO work_plan_members(plan_id,user_id,can_edit) VALUES(?,?,?)',[plan.id,member.user_id,member.can_edit]);await connection.query('UPDATE work_plans SET revision=revision+1 WHERE id=?',[plan.id]);await planAudit(connection,user,'plan.members.changed',plan.id);});return reply({ok:true});
 }
 if(path[2]==='items'&&((path.length===3&&method==='POST')||(path.length===4&&method==='PUT'))){
  const creating=method==='POST',data=(creating?planItemCreateSchema:planItemUpdateSchema).parse(await body(request));
  const result=await transaction(async connection=>{
   const [[currentPlan]]=await connection.query('SELECT * FROM work_plans WHERE id=? FOR UPDATE',[plan.id]);await planAccess(user,currentPlan,true);
   let item=null;if(!creating){[[item]]=await connection.query('SELECT * FROM work_plan_items WHERE id=? AND plan_id=? FOR UPDATE',[positiveId.parse(path[3]),plan.id]);if(!item)throw new WorkError(404,'Запланированная задача не найдена');checkPlanRevision(item,data.revision);if(item.state==='active')throw new WorkError(409,'Изменяйте начатую задачу в её рабочей карточке');}
   else {const [[old]]=await connection.query('SELECT id,creation_hash FROM work_plan_items WHERE plan_id=? AND created_by=? AND request_id=?',[plan.id,user.id,data.request_id]);if(old){if(old.creation_hash!==fingerprint(data))throw new WorkError(409,'Запрос уже использован с другими данными');return {id:old.id,replayed:true};}}
   await validateItem(user,currentPlan,data,connection,item?.id);
   const values=[data.kind,data.parent_id,data.title,data.description,data.priority,data.assignee_id,data.start_date,data.due_date,data.estimate_minutes,data.story_points,data.objective_id,data.state];
   if(creating){const [[count]]=await connection.query('SELECT COUNT(*) AS total FROM work_plan_items WHERE plan_id=?',[plan.id]);if(count.total>=2000)throw new WorkError(409,'В плане уже 2000 элементов; создайте отдельную инициативу');const [created]=await connection.query('INSERT INTO work_plan_items(kind,parent_id,title,description,priority,assignee_id,start_date,due_date,estimate_minutes,story_points,objective_id,state,plan_id,created_by,request_id,creation_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[...values,plan.id,user.id,data.request_id,fingerprint(data)]);item={id:created.insertId};}
   else await connection.query('UPDATE work_plan_items SET kind=?,parent_id=?,title=?,description=?,priority=?,assignee_id=?,start_date=?,due_date=?,estimate_minutes=?,story_points=?,objective_id=?,state=?,revision=revision+1 WHERE id=?',[...values,item.id]);
   await planAudit(connection,user,creating?'plan.item.created':'plan.item.updated',plan.id,{item_id:item.id});return {id:item.id};
  });return reply(result,creating?201:200);
 }
 if(path[2]==='items'&&path[4]==='start'&&method==='POST'){
  const data=z.object({revision:positiveId}).strict().parse(await body(request));
  if(!plan.project_id)throw new WorkError(409,'Сначала создайте рабочий проект или выберите существующий');
  if(!await apiBackgroundAllowed(user,user.api_token_id,'tasks:write'))throw new WorkError(403,'Начало работы требует разрешения API на создание задач');
  const result=await transaction(async connection=>{
   await connection.query('SELECT id FROM projects WHERE id=? FOR UPDATE',[plan.project_id]);
   const [[currentPlan]]=await connection.query('SELECT * FROM work_plans WHERE id=? FOR UPDATE',[plan.id]);await planAccess(user,currentPlan,true);
   const [[item]]=await connection.query('SELECT * FROM work_plan_items WHERE id=? AND plan_id=? FOR UPDATE',[positiveId.parse(path[3]),plan.id]);if(!item)throw new WorkError(404,'Запланированная задача не найдена');
   await projectFor(user,plan.project_id,'task.create',true);
   if(item.state==='active'){if(!item.task_id)throw new WorkError(409,'Рабочая задача удалена');return {task_id:item.task_id,replayed:true};}
   checkPlanRevision(item,data.revision);if(item.state!=='planning')throw new WorkError(409,'Верните задачу в планирование');
   await goalFor(user,item.objective_id||currentPlan.objective_id);
   let parent=null;if(item.parent_id){[[parent]]=await connection.query('SELECT * FROM work_plan_items WHERE id=? AND plan_id=?',[item.parent_id,plan.id]);if(parent?.state!=='active'||!parent.task_id)throw new WorkError(409,'Сначала начните работу над родительским эпиком');}
   const type=await one('SELECT id FROM issue_types WHERE workspace_id=? AND code=? AND active=TRUE',[user.workspace_id,item.kind]);
   if(!type)throw new WorkError(422,'Добавьте нужный тип задачи в настройки проекта');
   const created=await createWorkTask(user,plan.project_id,{title:item.title,description:item.description,priority:item.priority,assignee_id:item.assignee_id,start_date:item.start_date,due_date:item.due_date,estimate_minutes:item.estimate_minutes,story_points:item.story_points==null?null:Number(item.story_points),issue_type_id:type.id},connection);
   if(parent)await connection.query('UPDATE tasks SET epic_task_id=? WHERE id=?',[parent.task_id,created.task_id]);
   await connection.query("UPDATE work_plan_items SET state='active',task_id=?,revision=revision+1 WHERE id=?",[created.task_id,item.id]);await planAudit(connection,user,'plan.item.started',plan.id,{item_id:item.id,task_id:created.task_id});return created;
  });return reply(result);
 }
 if(path[2]==='start-project'&&method==='POST'){
  const data=z.object({revision:positiveId,project_id:positiveId.optional(),key_code:z.string().trim().regex(/^[A-Z][A-Z0-9]{1,11}$/).optional(),workflow_id:positiveId.optional()}).strict().parse(await body(request));
  if(!await apiBackgroundAllowed(user,user.api_token_id,'projects:write'))throw new WorkError(403,'Требуется разрешение API на изменение проектов');
  if(data.project_id){await projectFor(user,data.project_id,'planning.manage',true);await projectFor(user,data.project_id,'planning.view');}else{await workspaceFor(user,'project.create');if(!data.key_code||!data.workflow_id)throw new WorkError(422,'Укажите ключ и рабочий процесс проекта');if(!await one('SELECT id FROM workflows WHERE id=? AND workspace_id=?',[data.workflow_id,user.workspace_id]))throw new WorkError(422,'Рабочий процесс недоступен');}
  const result=await transaction(async connection=>{
   await connection.query('SELECT id FROM workspaces WHERE id=? FOR UPDATE',[user.workspace_id]);const [[current]]=await connection.query('SELECT * FROM work_plans WHERE id=? FOR UPDATE',[plan.id]);await planAccess(user,current,true);
   if(current.project_id){if(data.project_id&&Number(data.project_id)!==Number(current.project_id))throw new WorkError(409,'План уже связан с другим проектом');return {project_id:current.project_id,replayed:true};}
   checkPlanRevision(current,data.revision);let projectId=data.project_id;
   if(!projectId){const [[same]]=await connection.query('SELECT id FROM projects WHERE workspace_id=? AND key_code=?',[user.workspace_id,data.key_code]);if(same)throw new WorkError(409,'Ключ проекта уже занят');
    const [created]=await connection.query('INSERT INTO projects(workspace_id,workflow_id,key_code,name,description,color,start_date,target_date,created_by) VALUES(?,?,?,?,?,?,?,?,?)',[user.workspace_id,data.workflow_id,data.key_code,current.title,current.description,'#e30611',current.start_date,current.due_date,user.id]);projectId=created.insertId;
    await connection.query("INSERT INTO project_members(project_id,user_id,project_role) VALUES(?,?,'manager')",[projectId,user.id]);
   }
   await connection.query('UPDATE work_plans SET project_id=?,revision=revision+1 WHERE id=?',[projectId,plan.id]);await planAudit(connection,user,'plan.project.started',plan.id,{project_id:projectId});return {project_id:projectId};
  });return reply(result);
 }
 throw new WorkError(404,'Метод планирования не найден');
}
