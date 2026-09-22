import {z} from 'zod';
import {one,rows,transaction} from './db.js';
import {body,reply,positiveId,WorkError,workspaceFor,projectFor,validUsers} from './work-common.js';
import {workspacePermissionSet} from './permissions.js';
import {audit} from './audit.js';

export const roomSchema=z.object({
 name:z.string().trim().min(1).max(180),description:z.string().trim().max(2000).default(''),
 join_policy:z.enum(['workspace','project','invite']).default('workspace'),
 project_id:positiveId.nullable().default(null),invite_ids:z.array(positiveId).max(500).default([]),
 archived:z.boolean().default(false),revision:positiveId.optional(),
}).strict().superRefine((v,c)=>{
 if(v.join_policy==='project'&&!v.project_id)c.addIssue({code:'custom',message:'Выберите проект',path:['project_id']});
 if(v.join_policy==='workspace'&&v.project_id)c.addIssue({code:'custom',message:'Общая комната не привязана к проекту',path:['project_id']});
 if(new Set(v.invite_ids).size!==v.invite_ids.length)c.addIssue({code:'custom',message:'Приглашения не должны повторяться',path:['invite_ids']});
});

// Room membership is explicit even for project administrators. The owner is not
// automatically a member: newly created rooms genuinely start with zero people.
export async function assertChatRoomMembership(user,channel,{write=false}={}){
 const room=await one('SELECT * FROM chat_rooms WHERE channel_id=?',[channel.id]);
 if(!room)return null;
 if(!await one('SELECT user_id FROM chat_channel_members WHERE channel_id=? AND user_id=?',[channel.id,user.id]))throw new WorkError(403,'Сначала войдите в комнату');
 if(channel.project_id)await projectFor(user,channel.project_id,'chat.use',write);
 else if(!user.is_service)await workspaceFor(user,'chat.room.join');
 if(write&&room.archived)throw new WorkError(409,'Комната в архиве: доступна только история');
 return room;
}

async function access(user,room,{manage=false}={}){
 const rights=await workspacePermissionSet(user);
 const manager=Number(room.created_by)===Number(user.id)||rights.has('chat.room.manage');
 if(room.project_id)await projectFor(user,room.project_id,'chat.use');
 else if(!rights.has('chat.room.join')&&!manager)throw new WorkError(403,'Нет доступа к комнатам');
 if(manage&&!manager)throw new WorkError(403,'Настройка комнаты доступна владельцу или администратору комнат');
 if(room.join_policy==='invite'&&!manager&&!room.member_id&&!room.invited_id)throw new WorkError(404,'Комната не найдена');
 return manager;
}

const roomQuery=`SELECT c.id,c.workspace_id,c.project_id,c.name,c.created_by,c.created_at,c.updated_at,
 r.join_policy,r.description,r.archived,r.revision,p.name AS project_name,
 m.user_id AS member_id,i.user_id AS invited_id,
 (SELECT COUNT(*) FROM chat_channel_members cm JOIN users u ON u.id=cm.user_id AND u.status='active' WHERE cm.channel_id=c.id) AS member_count
 FROM chat_rooms r JOIN chat_channels c ON c.id=r.channel_id
 LEFT JOIN projects p ON p.id=c.project_id
 LEFT JOIN chat_channel_members m ON m.channel_id=c.id AND m.user_id=?
 LEFT JOIN chat_room_invites i ON i.channel_id=c.id AND i.user_id=?`;

async function findRoom(user,id){
 const room=await one(`${roomQuery} WHERE c.workspace_id=? AND c.id=?`,[user.id,user.id,user.workspace_id,id]);
 if(!room)throw new WorkError(404,'Комната не найдена');
 return room;
}

async function validateRoom(user,d){
 if(d.project_id)await projectFor(user,d.project_id,'chat.use',true);
 await validUsers(user,d.invite_ids,d.project_id);
 if(!d.project_id)await workspaceFor(user,'chat.room.join');
}

export async function chatRoomsApi(request,path,user){
 if(user.is_service)throw new WorkError(403,'Управление комнатами недоступно служебной учётной записи');
 const method=request.method;
 if(method==='GET'&&path.length===2){
  const result=[];
  for(const room of await rows(`${roomQuery} WHERE c.workspace_id=? ORDER BY c.name,c.id LIMIT 1000`,[user.id,user.id,user.workspace_id])){
   try{const can_manage=await access(user,room);if(room.archived&&!room.member_id&&!can_manage)continue;result.push({...room,joined:Boolean(room.member_id),can_manage});}catch(e){if(![403,404].includes(e.status))throw e;}
  }
  return reply(result);
 }
 if(method==='POST'&&path.length===2){
  await workspaceFor(user,'chat.room.create');const d=roomSchema.parse(await body(request));await validateRoom(user,d);
  const id=await transaction(async c=>{
   const [created]=await c.query("INSERT INTO chat_channels(workspace_id,project_id,channel_type,name,created_by) VALUES(?,?,'group',?,?)",[user.workspace_id,d.project_id,d.name,user.id]);
   await c.query('INSERT INTO chat_rooms(channel_id,join_policy,description,archived) VALUES(?,?,?,?)',[created.insertId,d.join_policy,d.description,d.archived]);
   for(const invite of d.invite_ids)await c.query('INSERT INTO chat_room_invites(channel_id,user_id,invited_by) VALUES(?,?,?)',[created.insertId,invite,user.id]);
   return created.insertId;
  });await audit(user,'chat.room.created','chat_channel',id,{join_policy:d.join_policy,project_id:d.project_id});return reply({id,member_count:0,revision:1},201);
 }
 const id=positiveId.parse(path[2]),room=await findRoom(user,id),can_manage=await access(user,room);
 if(method==='GET'&&path.length===3){
  return reply({...room,joined:Boolean(room.member_id),can_manage,invite_ids:can_manage?(await rows('SELECT user_id FROM chat_room_invites WHERE channel_id=?',[id])).map(v=>v.user_id):[]});
 }
 if(method==='POST'&&['join','leave'].includes(path[3])&&path.length===4){
  if(path[3]==='join'){
   // Serialize join with policy changes and invitation revocation.
   await transaction(async c=>{
    const [[locked]]=await c.query('SELECT revision,archived FROM chat_rooms WHERE channel_id=? FOR UPDATE',[id]);
    if(!locked||locked.revision!==room.revision)throw new WorkError(409,'Настройки комнаты изменились. Обновите список');
    if(locked.archived)throw new WorkError(409,'Нельзя войти в архивную комнату');
    if(room.project_id)await projectFor(user,room.project_id,'chat.use',true);else await workspaceFor(user,'chat.room.join');
    await c.query("INSERT IGNORE INTO chat_channel_members(channel_id,user_id,member_role,last_read_message_id,last_read_at) SELECT ?,?,?,COALESCE(MAX(id),0),CURRENT_TIMESTAMP FROM chat_messages WHERE channel_id=?",[id,user.id,Number(room.created_by)===Number(user.id)?'owner':'member',id]);
   });
  }else await rows('DELETE FROM chat_channel_members WHERE channel_id=? AND user_id=?',[id,user.id]);
  return reply({id,joined:path[3]==='join'});
 }
 if(method==='PUT'&&path.length===3){
  await access(user,room,{manage:true});const d=roomSchema.parse(await body(request));if(!d.revision)throw new WorkError(422,'Укажите revision');await validateRoom(user,d);
  if(Number(d.project_id||0)!==Number(room.project_id||0))throw new WorkError(422,'Проект комнаты нельзя менять: создайте отдельную комнату для другой аудитории');
  await transaction(async c=>{
   const [[locked]]=await c.query('SELECT revision FROM chat_rooms WHERE channel_id=? FOR UPDATE',[id]);
   if(locked.revision!==d.revision)throw new WorkError(409,'Комнату уже изменили. Откройте настройки заново');
   await c.query('UPDATE chat_rooms SET join_policy=?,description=?,archived=?,revision=revision+1 WHERE channel_id=?',[d.join_policy,d.description,d.archived,id]);
   await c.query('UPDATE chat_channels SET name=?,updated_at=CURRENT_TIMESTAMP WHERE id=?',[d.name,id]);
   await c.query('DELETE FROM chat_room_invites WHERE channel_id=?',[id]);
   for(const invite of d.invite_ids)await c.query('INSERT INTO chat_room_invites(channel_id,user_id,invited_by) VALUES(?,?,?)',[id,invite,user.id]);
   // Closing a room revokes non-invited membership. Merely leaving an open
   // room never deletes history or future join eligibility.
   if(d.join_policy==='invite')await c.query(`DELETE FROM chat_channel_members WHERE channel_id=? AND user_id<>? AND user_id NOT IN (${[0,...d.invite_ids].map(()=>'?').join(',')})`,[id,room.created_by,0,...d.invite_ids]);
  });await audit(user,'chat.room.updated','chat_channel',id,{revision:d.revision+1,archived:d.archived});return reply({id,revision:d.revision+1});
 }
 throw new WorkError(404,'Метод комнаты не найден');
}
