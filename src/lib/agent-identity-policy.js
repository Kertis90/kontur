import {WorkError} from './work-error.js';
import {one,parseJson} from './db.js';
export const IDENTITY_PROJECT_PERMISSIONS=['project.browse','agent.view','agent.run','agent.automate','task.create','task.edit','task.assign','comment.create','qa.view','okr.view','chat.use','ai.conference.summarize','conference.recording.view'];
export const IDENTITY_WORKSPACE_PERMISSIONS=['knowledge.view','ai.search'];
const deny=message=>new WorkError(403,message);
export async function readAgentIdentity(user,{required=true}={}){
 if(!user?.is_service)return null;
 const identity=await one('SELECT i.* FROM ai_agent_identities i JOIN users owner ON owner.id=i.owner_id WHERE i.user_id=? AND i.workspace_id=? AND i.enabled=TRUE AND owner.status=\'active\' AND owner.is_service=FALSE',[user.id,user.workspace_id]);
 if(!identity){if(required)throw deny('Учётная запись агента или её владелец отключены');return null;}
 return {...identity,policy:parseJson(identity.policy_json,{})};
}
export async function identityProjectPermissions(user,projectId){const i=await readAgentIdentity(user,{required:false});return new Set((i?.policy.projects||[]).find(p=>Number(p.id)===Number(projectId))?.permissions.filter(p=>IDENTITY_PROJECT_PERMISSIONS.includes(p))||[]);}
export async function identityWorkspacePermissions(user){const i=await readAgentIdentity(user,{required:false});return new Set((i?.policy.workspace_permissions||[]).filter(p=>IDENTITY_WORKSPACE_PERMISSIONS.includes(p)));}
export async function assertIdentityConfiguration(user,projectId,config){
 const i=await readAgentIdentity(user);if(!i)return;
 if(!i.policy.projects.some(p=>Number(p.id)===Number(projectId)))throw deny('Проект не разрешён учётной записи агента');
 for(const id of [config.profile_id,...config.flow.nodes.filter(n=>n.type==='analyze').map(n=>n.profile_id||config.profile_id)])if(!i.policy.profile_ids.includes(id))throw deny('Модель не разрешена учётной записи агента');
 if(config.actions.some(a=>!i.policy.actions.includes(a)))throw deny('Инструмент не разрешён учётной записи агента');
 const s=config.sources,kinds=[...(s.tasks.enabled?['task']:[]),...(s.quality.enabled?['quality']:[]),...(s.article_ids.length||s.knowledge.space_ids.length||s.semantic?.enabled?['article']:[]),...(s.conference_ids.length?['conference']:[]),...(s.recording_ids.length?['recording']:[]),...(s.chat_channel_ids.length?['chat']:[]),...(s.planning?['planning']:[]),...(s.objectives?['objective']:[])];
 if(kinds.some(k=>!i.policy.source_kinds.includes(k)))throw deny('Тип источника не разрешён учётной записи агента');
}
export async function assertIdentityRefs(user,refs){const i=await readAgentIdentity(user);if(i&&refs.some(r=>!i.policy.source_kinds.includes(r.kind)))throw deny('Выборка содержит запрещённый тип источника');}
export async function assertIdentityModelBudget(user,profileId,reserved,connection){
 if(!user.is_service)return;
 const [[i]]=await connection.query("SELECT i.* FROM ai_agent_identities i JOIN users u ON u.id=i.owner_id WHERE i.user_id=? AND i.workspace_id=? AND i.enabled=TRUE AND u.status='active' AND u.is_service=FALSE FOR UPDATE",[user.id,user.workspace_id]);
 if(!i||!parseJson(i.policy_json,{}).profile_ids?.includes(profileId))throw deny('Учётная запись отключена или модель запрещена');
 const [[usage]]=await connection.query("SELECT COALESCE(SUM(charged_tokens),0) AS total FROM ai_usage_ledger WHERE user_id=? AND created_at>=DATE_FORMAT(UTC_DATE(),'%Y-%m-01')",[user.id]);
 if(Number(usage.total)+reserved>Number(i.monthly_tokens))throw new WorkError(429,'Бюджет учётной записи агента исчерпан');
}
