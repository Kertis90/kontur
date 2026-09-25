import {z} from 'zod';
import {one,rows,transaction} from './db.js';
import {body,reply,positiveId,WorkError} from './work-common.js';
import {hasWorkspacePermission} from './permissions.js';
import {companyAdmin,listTribes,tribeAccess,TRIBE_RIGHTS} from './tribe-policy.js';
import {audit} from './audit.js';

const revision=positiveId;
const spaceFields={name:z.string().trim().min(2).max(160),description:z.string().max(2000).default(''),color:z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#e30611')};

// Проверяет актуальные полномочия после блокировки трайба, исключая потерянные обновления.
async function lockedTribe(connection,user,tribeId,expected,right){
 const [[current]]=await connection.query('SELECT id,revision FROM tribes WHERE id=? AND workspace_id=? FOR UPDATE',[tribeId,user.workspace_id]);
 const access=current?await tribeAccess(user,tribeId,connection):null;
 if(!access||!access[right])throw new WorkError(403,'Нет права изменять этот трайб');
 if(Number(current.revision)!==expected)throw new WorkError(409,'Трайб уже изменён. Обновите страницу и повторите действие');
 return access;
}

// Проверяет действующего сотрудника компании; служебные агенты не входят в состав трайба.
async function employee(connection,user,userId){
 const [[found]]=await connection.query("SELECT id,display_name FROM users WHERE id=? AND workspace_id=? AND status='active' AND is_service=FALSE",[userId,user.workspace_id]);
 if(!found)throw new WorkError(422,'Сотрудник недоступен в этой компании');
 return found;
}

// Увеличивает версию пространства после изменения состава или настроек.
async function changed(connection,tribeId){await connection.query('UPDATE tribes SET revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=?',[tribeId]);}

// Возвращает доступные трайбы и выполняет изменения только в разрешённой области компании.
export async function tribesApi(request,path,user){
 const method=request.method;
 if(user.is_service)throw new WorkError(403,'Управление трайбами доступно только сотрудникам');
 if(path.length===1&&method==='GET')return reply({tribes:await listTribes(user),can_create:await hasWorkspacePermission(user,'tribe.create')});
 if(path.length===1&&method==='POST'){
  if(!await hasWorkspacePermission(user,'tribe.create'))throw new WorkError(403,'Создание трайба доступно трайб-лидеру или администратору');
  const data=z.object({...spaceFields,leader_id:positiveId.optional()}).strict().parse(await body(request));
  const leaderId=data.leader_id||Number(user.id);
  if(leaderId!==Number(user.id)&&!companyAdmin(user))throw new WorkError(403,'Назначить другого лидера при создании может администратор компании');
  const id=await transaction(async connection=>{
   await connection.query('SELECT id FROM workspaces WHERE id=? FOR UPDATE',[user.workspace_id]);await employee(connection,user,leaderId);
   const [created]=await connection.query('INSERT INTO tribes(workspace_id,leader_id,name,description,color,created_by) VALUES(?,?,?,?,?,?)',[user.workspace_id,leaderId,data.name,data.description,data.color,user.id]);
   await connection.query('INSERT INTO tribe_members(tribe_id,user_id) VALUES(?,?)',[created.insertId,leaderId]);return created.insertId;
  });
  await audit(user,'tribe.created','tribe',id,{leader_id:leaderId},request);return reply({id},201);
 }
 const tribeId=positiveId.parse(path[1]),access=await tribeAccess(user,tribeId);
 if(!access)throw new WorkError(404,'Трайб недоступен');
 if(path.length===2&&method==='GET'){
  const members=await rows('SELECT m.*,u.display_name,u.status,u.avatar_color FROM tribe_members m JOIN users u ON u.id=m.user_id WHERE m.tribe_id=? AND u.workspace_id=? ORDER BY u.display_name',[tribeId,user.workspace_id]);
  const people=access.can_manage_members||access.can_assign_leader?await rows("SELECT id,display_name,avatar_color FROM users WHERE workspace_id=? AND status='active' AND is_service=FALSE ORDER BY display_name",[user.workspace_id]):[];
  return reply({tribe:access,members,people});
 }
 if(path.length===2&&method==='PATCH'){
  const data=z.object({...spaceFields,revision}).strict().parse(await body(request));
  await transaction(async connection=>{await lockedTribe(connection,user,tribeId,data.revision,'can_manage_space');await connection.query('UPDATE tribes SET name=?,description=?,color=? WHERE id=?',[data.name,data.description,data.color,tribeId]);await changed(connection,tribeId);});
  await audit(user,'tribe.updated','tribe',tribeId,{fields:['name','description','color']},request);return reply({ok:true});
 }
 if(path[2]==='members'&&path.length===3&&method==='PUT'){
  const data=z.object({user_id:positiveId,revision,...Object.fromEntries(TRIBE_RIGHTS.map(key=>[key,z.boolean().default(false)]))}).strict().parse(await body(request));
  await transaction(async connection=>{
   const fresh=await lockedTribe(connection,user,tribeId,data.revision,'can_manage_members');await employee(connection,user,data.user_id);
   if(data.user_id===Number(fresh.leader_id))throw new WorkError(409,'Права лидера изменяются только передачей руководства трайбом');
   if(!fresh.can_assign_leader&&data.user_id===Number(user.id))throw new WorkError(403,'Нельзя изменять собственные делегированные права');
   const [[previous]]=await connection.query('SELECT * FROM tribe_members WHERE tribe_id=? AND user_id=?',[tribeId,data.user_id]);
   for(const key of TRIBE_RIGHTS)if(!fresh[key]&&(data[key]||Boolean(previous?.[key])!==data[key]))throw new WorkError(403,'Нельзя назначать или отзывать права, которыми вы не управляете');
   await connection.query('INSERT INTO tribe_members(tribe_id,user_id,can_manage_space,can_manage_members,can_create_projects,can_manage_projects) VALUES(?,?,?,?,?,?) ON DUPLICATE KEY UPDATE can_manage_space=VALUES(can_manage_space),can_manage_members=VALUES(can_manage_members),can_create_projects=VALUES(can_create_projects),can_manage_projects=VALUES(can_manage_projects)',[tribeId,data.user_id,...TRIBE_RIGHTS.map(key=>data[key])]);await changed(connection,tribeId);
  });
  await audit(user,'tribe.member.saved','tribe',tribeId,data,request);return reply({ok:true});
 }
 if(path[2]==='members'&&path.length===4&&method==='DELETE'){
  const userId=positiveId.parse(path[3]),data=z.object({revision}).strict().parse(await body(request));
  await transaction(async connection=>{
   const fresh=await lockedTribe(connection,user,tribeId,data.revision,'can_manage_members');
   if(userId===Number(fresh.leader_id))throw new WorkError(409,'Сначала назначьте другого трайб-лидера');
   const [[member]]=await connection.query('SELECT * FROM tribe_members WHERE tribe_id=? AND user_id=?',[tribeId,userId]);
   if(!fresh.can_assign_leader&&(userId===Number(user.id)||TRIBE_RIGHTS.some(key=>member?.[key]&&!fresh[key])))throw new WorkError(403,'Нет права убрать этого сотрудника');
   const [[owned]]=await connection.query('SELECT id FROM projects WHERE tribe_id=? AND owner_id=? AND deleted_at IS NULL LIMIT 1',[tribeId,userId]);
   if(owned)throw new WorkError(409,'Сначала передайте проекты сотрудника другому владельцу');
   await connection.query('DELETE FROM tribe_members WHERE tribe_id=? AND user_id=?',[tribeId,userId]);await changed(connection,tribeId);
  });
  await audit(user,'tribe.member.removed','tribe',tribeId,{user_id:userId},request);return reply({ok:true});
 }
 if(path[2]==='leader'&&path.length===3&&method==='POST'){
  const data=z.object({user_id:positiveId,revision}).strict().parse(await body(request));
  await transaction(async connection=>{await lockedTribe(connection,user,tribeId,data.revision,'can_assign_leader');await employee(connection,user,data.user_id);await connection.query('INSERT IGNORE INTO tribe_members(tribe_id,user_id) VALUES(?,?)',[tribeId,data.user_id]);await connection.query('UPDATE tribes SET leader_id=? WHERE id=?',[data.user_id,tribeId]);await changed(connection,tribeId);});
  await audit(user,'tribe.leader.changed','tribe',tribeId,{leader_id:data.user_id},request);return reply({ok:true});
 }
 if(path[2]==='projects'&&path.length===3&&method==='POST'){
  if(!companyAdmin(user))throw new WorkError(403,'Распределять существующие проекты по трайбам может администратор компании');
  const data=z.object({project_id:positiveId,revision,access_revision:positiveId}).strict().parse(await body(request));
  await transaction(async connection=>{
   await lockedTribe(connection,user,tribeId,data.revision,'can_manage_projects');
   const [[project]]=await connection.query('SELECT * FROM projects WHERE id=? AND workspace_id=? AND deleted_at IS NULL FOR UPDATE',[data.project_id,user.workspace_id]);
   if(!project)throw new WorkError(404,'Проект недоступен');
   if(Number(project.access_revision)!==data.access_revision)throw new WorkError(409,'Доступ проекта уже изменён');
   if(project.owner_id)await connection.query('INSERT IGNORE INTO tribe_members(tribe_id,user_id) VALUES(?,?)',[tribeId,project.owner_id]);
   await connection.query("UPDATE projects SET tribe_id=?,access_mode='members',access_revision=access_revision+1 WHERE id=?",[tribeId,project.id]);await changed(connection,tribeId);
  });
  await audit(user,'tribe.project.assigned','project',data.project_id,{tribe_id:tribeId},request);return reply({ok:true});
 }
 throw new WorkError(404,'Действие с трайбом не найдено');
}
