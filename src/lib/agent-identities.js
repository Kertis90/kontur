import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {one,rows,transaction,parseJson} from './db.js';
import {WorkError,body,reply,workspaceFor,projectFor,positiveId} from './work-common.js';
import {projectPermissionSet,workspacePermissionSet} from './permissions.js';
import {getAiSettings,chooseAiProfile} from './ai-settings.js';
import {knowledgeSpaceAccess,knowledgeAccessAtLeast} from './knowledge-access.js';
import {agentChatAccess} from './agent-extra-sources.js';
import {recordingConferenceAccess} from './recordings.js';
import {AGENT_ACTION_CATALOG,AGENT_SOURCE_LABELS} from './agent-catalog.js';
import {IDENTITY_PROJECT_PERMISSIONS,IDENTITY_WORKSPACE_PERMISSIONS,readAgentIdentity} from './agent-identity-policy.js';
import {audit} from './audit.js';
const unique=list=>new Set(list).size===list.length;
export const identityPolicySchema=z.object({
 projects:z.array(z.object({id:positiveId,permissions:z.array(z.enum(IDENTITY_PROJECT_PERMISSIONS)).min(1).max(IDENTITY_PROJECT_PERMISSIONS.length)}).strict()).min(1).max(20).refine(v=>unique(v.map(x=>x.id)),'Проекты повторяются'),
 workspace_permissions:z.array(z.enum(IDENTITY_WORKSPACE_PERMISSIONS)).max(2).default([]),
 profile_ids:z.array(z.string().uuid()).min(1).max(20),actions:z.array(z.enum(AGENT_ACTION_CATALOG.map(a=>a.key))).max(8).default([]),
 source_kinds:z.array(z.enum(Object.keys(AGENT_SOURCE_LABELS))).min(1).max(8),
 spaces:z.array(z.object({id:positiveId,level:z.enum(['view','edit'])}).strict()).max(30).default([]),
 chat_ids:z.array(positiveId).max(30).default([]),conference_ids:z.array(positiveId).max(30).default([])
}).strict();
export const identitySchema=z.object({name:z.string().trim().min(2).max(150),owner_id:positiveId,enabled:z.boolean().default(true),monthly_tokens:z.number().int().min(1000).max(1000000000).default(1000000),revision:positiveId.optional(),policy:identityPolicySchema}).strict();
export async function identityActor(user,id,projectId){
 const row=await one('SELECT u.* FROM ai_agent_identities i JOIN users u ON u.id=i.user_id WHERE i.id=? AND i.workspace_id=? AND u.status=\'active\' AND u.is_service=TRUE',[id,user.workspace_id]);
 if(!row)throw new WorkError(403,'Учётная запись недоступна');
 const identity=await readAgentIdentity(row);if(!identity.policy.projects.some(p=>Number(p.id)===Number(projectId)))throw new WorkError(403,'Учётной записи запрещён этот проект');
 return {...row,api_token_id:null};
}
export async function agentIdentityApi(request,path,user){
 await workspaceFor(user,'agent.identity.manage');
 if(request.method==='GET'){
  const list=await rows('SELECT i.*,u.display_name AS owner_name,(SELECT COALESCE(SUM(l.charged_tokens),0) FROM ai_usage_ledger l WHERE l.user_id=i.user_id AND l.created_at>=DATE_FORMAT(UTC_DATE(),\'%Y-%m-01\')) AS charged_tokens FROM ai_agent_identities i JOIN users u ON u.id=i.owner_id WHERE i.workspace_id=? ORDER BY i.id DESC LIMIT 200',[user.workspace_id]);
  return reply({identities:list.map(({policy_json,...i})=>({...i,enabled:Boolean(i.enabled),policy:parseJson(policy_json)})),project_permissions:IDENTITY_PROJECT_PERMISSIONS,workspace_permissions:IDENTITY_WORKSPACE_PERMISSIONS});
 }
 if(request.method==='PATCH'&&path[2]){
  const id=positiveId.parse(path[2]),d=z.object({enabled:z.literal(false),revision:positiveId}).strict().parse(await body(request));
  await transaction(async c=>{await c.query('SELECT id FROM workspaces WHERE id=? FOR UPDATE',[user.workspace_id]);const [[old]]=await c.query('SELECT * FROM ai_agent_identities WHERE id=? AND workspace_id=? FOR UPDATE',[id,user.workspace_id]);if(!old)throw new WorkError(404,'Учётная запись не найдена');if(old.revision!==d.revision)throw new WorkError(409,'Учётная запись изменена');await c.query('UPDATE ai_agent_identities SET enabled=FALSE,revision=revision+1 WHERE id=?',[id]);await c.query("UPDATE ai_agent_runs SET status='cancelled',error_text='Учётная запись агента отключена',completed_at=CURRENT_TIMESTAMP WHERE actor_id=? AND status IN ('queued','running','review')",[old.user_id]);});await audit(user,'agent.identity.disabled','ai_agent_identity',id);return reply({ok:true});
 }
 if(!['POST','PUT'].includes(request.method))throw new WorkError(404,'Метод учётных записей не найден');
 const id=path[2]?positiveId.parse(path[2]):null,d=identitySchema.parse(await body(request));
 if((request.method==='PUT')!==Boolean(id))throw new WorkError(422,'Укажите корректный метод и ID');
 const owner=await one("SELECT id FROM users WHERE id=? AND workspace_id=? AND status='active' AND is_service=FALSE",[d.owner_id,user.workspace_id]);if(!owner)throw new WorkError(422,'Владелец должен быть активным сотрудником');
 const workspace=await workspacePermissionSet(user);if(d.policy.workspace_permissions.some(p=>!workspace.has(p)))throw new WorkError(403,'Нельзя передать право, которого у вас нет');
 for(const grant of d.policy.projects){await projectFor(user,grant.id,'project.access.manage',true);const permissions=await projectPermissionSet(user,grant.id);if(!grant.permissions.includes('project.browse')||grant.permissions.some(p=>!permissions.has(p)))throw new WorkError(403,'Проверьте права проектов: нельзя выдать отсутствующее у вас разрешение');}
 const settings=await getAiSettings(user.workspace_id);for(const profile of d.policy.profile_ids)chooseAiProfile(settings,'project',profile);
 for(const grant of d.policy.spaces){const access=await knowledgeSpaceAccess(user,grant.id);if(!knowledgeAccessAtLeast(access.level,'admin'))throw new WorkError(403,'Для выдачи доступа требуется управление пространством знаний');}
 for(const chatId of d.policy.chat_ids){const chat=await one('SELECT project_id FROM chat_channels WHERE id=? AND workspace_id=?',[chatId,user.workspace_id]);if(!chat)throw new WorkError(403,'Чат недоступен');if(chat.project_id&&!d.policy.projects.some(p=>p.id===Number(chat.project_id)))throw new WorkError(422,'Проект чата отсутствует в разрешениях');await agentChatAccess(user,chatId,chat.project_id||d.policy.projects[0].id,true);if(!chat.project_id&&!await one("SELECT user_id FROM chat_channel_members WHERE channel_id=? AND user_id=? AND member_role='owner'",[chatId,user.id]))throw new WorkError(403,'Добавление учётной записи в закрытый чат требует роли владельца чата');}
 for(const conferenceId of d.policy.conference_ids){const c=await recordingConferenceAccess(user,conferenceId,'conference.manage');if(!d.policy.projects.some(p=>p.id===Number(c.project_id)))throw new WorkError(422,'Проект встречи отсутствует в разрешениях');}
 const saved=await transaction(async c=>{
  await c.query('SELECT id FROM workspaces WHERE id=? FOR UPDATE',[user.workspace_id]);let identityId=id,userId,revision=1;
  if(id){const [[old]]=await c.query('SELECT * FROM ai_agent_identities WHERE id=? AND workspace_id=? FOR UPDATE',[id,user.workspace_id]);if(!old)throw new WorkError(404,'Учётная запись не найдена');if(old.revision!==d.revision)throw new WorkError(409,'Учётная запись изменена');userId=old.user_id;revision=old.revision+1;await c.query('UPDATE ai_agent_identities SET name=?,owner_id=?,enabled=?,policy_json=?,monthly_tokens=?,revision=? WHERE id=?',[d.name,d.owner_id,d.enabled,JSON.stringify(d.policy),d.monthly_tokens,revision,id]);await c.query('UPDATE users SET display_name=? WHERE id=?',[`ИИ · ${d.name}`,userId]);await c.query("UPDATE ai_agent_runs SET status='cancelled',error_text='Политика учётной записи изменена',completed_at=CURRENT_TIMESTAMP WHERE actor_id=? AND status IN ('queued','running','review')",[userId]);}
  else{const [[count]]=await c.query('SELECT COUNT(*) AS total FROM ai_agent_identities WHERE workspace_id=?',[user.workspace_id]);if(Number(count.total)>=100)throw new WorkError(422,'Не более 100 учётных записей агентов');const [u]=await c.query("INSERT INTO users(workspace_id,email,display_name,password_hash,global_role,is_service) VALUES(?,?,?,NULL,'viewer',TRUE)",[user.workspace_id,`agent-${randomUUID()}@agents.invalid`,`ИИ · ${d.name}`]);userId=u.insertId;const [i]=await c.query('INSERT INTO ai_agent_identities(workspace_id,user_id,owner_id,name,enabled,policy_json,monthly_tokens,created_by) VALUES(?,?,?,?,?,?,?,?)',[user.workspace_id,userId,d.owner_id,d.name,d.enabled,JSON.stringify(d.policy),d.monthly_tokens,user.id]);identityId=i.insertId;}
  for(const channel of d.policy.chat_ids)await c.query("INSERT IGNORE INTO chat_channel_members(channel_id,user_id,member_role) VALUES(?,?,'member')",[channel,userId]);
  for(const conference of d.policy.conference_ids)await c.query("INSERT IGNORE INTO conference_participants(conference_id,user_id,participant_role) VALUES(?,?,'participant')",[conference,userId]);
  return {id:identityId,user_id:userId,revision};
 });await audit(user,'agent.identity.saved','ai_agent_identity',saved.id);return reply(saved,id?200:201);
}
