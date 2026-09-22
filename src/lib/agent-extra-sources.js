import {assertChatRoomMembership} from './chat-rooms.js';
import {readAgentIdentity} from './agent-identity-policy.js';
import {createHash} from 'node:crypto';
import {one,rows,parseJson} from './db.js';
import {WorkError,projectFor,validUsers} from './work-common.js';
import {projectPermissionSet} from './permissions.js';
import {knowledgeSpaceAccess,knowledgeAccessAtLeast} from './knowledge-access.js';
import {recordingConferenceAccess,assertRecording} from './recordings.js';
import {fieldAccess} from './work-access.js';
import {AGENT_ACTION_CATALOG} from './agent-catalog.js';
import {apiBackgroundAllowed} from './api-access.js';
export const sourceHash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export async function extraScope(user,scope){if(!await apiBackgroundAllowed(user,user.api_token_id,scope))throw new WorkError(403,'Нет разрешения API: '+scope);}
export async function agentChatAccess(user,id,projectId,write=false){
 const identity=await readAgentIdentity(user);if(identity&&!identity.policy.chat_ids?.includes(Number(id)))throw new WorkError(403,'Чат запрещён учётной записи агента');
 const chat=await one('SELECT * FROM chat_channels WHERE id=? AND workspace_id=?',[id,user.workspace_id]);
 if(!chat)throw new WorkError(403,'Чат недоступен');
 await assertChatRoomMembership(user,chat,{write});
 if(chat.project_id){if(Number(chat.project_id)!==Number(projectId))throw new WorkError(403,'Чат другого проекта');await projectFor(user,chat.project_id,'chat.use',write);}
 else if(!await one('SELECT user_id FROM chat_channel_members WHERE channel_id=? AND user_id=?',[id,user.id]))throw new WorkError(403,'Вы не участник выбранного чата');
 return chat;
}
export async function agentKnowledgeAccess(user,id,write=false){const access=await knowledgeSpaceAccess(user,id);if(!knowledgeAccessAtLeast(access.level,write?'edit':'view'))throw new WorkError(403,'Нет доступа к пространству базы знаний');return access;}
export async function agentCustomFields(user,projectId){
 const policies=await fieldAccess(user,projectId),all=await rows('SELECT code,label AS name,field_type FROM task_field_definitions WHERE workspace_id=? AND active=TRUE ORDER BY position,id LIMIT 200',[user.workspace_id]);
 return all.filter(f=>!policies.some(p=>p.field_code===f.code&&!p.can_read));
}
export async function agentCustomAccess(user,projectId,codes){
 if(!codes?.length)return;
 const policies=await fieldAccess(user,projectId),definitions=await rows('SELECT code FROM task_field_definitions WHERE workspace_id=?',[user.workspace_id]);
 for(const code of codes)if(!definitions.some(d=>d.code===code)||policies.some(p=>p.field_code===code&&!p.can_read))throw new WorkError(403,'Недоступен выбранный атрибут задачи');
}
export async function agentObjectiveAccess(user,projectId){const rights=await projectPermissionSet(user,projectId);if(!['okr.view','okr.manage','okr.update'].some(p=>rights.has(p)))throw new WorkError(403,'Нет доступа к целям проекта');}
export async function validateExtraAgentAccess(user,project,config){
 const s=config.sources,p=config.policy||{};
 await agentCustomAccess(user,project.id,s.tasks.custom_fields);
 if(s.objectives)await agentObjectiveAccess(user,project.id);
 for(const id of [...(s.knowledge?.space_ids||[]),...(s.semantic?.enabled?s.semantic.space_ids:[])])await agentKnowledgeAccess(user,id);
 if(s.semantic?.enabled){const {workspaceFor}=await import('./work-common.js');await workspaceFor(user,'ai.search');}
 for(const id of s.chat_channel_ids||[])await agentChatAccess(user,id,project.id);
 for(const id of s.recording_ids||[]){const record=await one('SELECT conference_id FROM conference_recordings WHERE id=? AND workspace_id=?',[id,user.workspace_id]);if(!record)throw new WorkError(403,'Запись недоступна');const meeting=await recordingConferenceAccess(user,record.conference_id,'ai.conference.summarize');await assertRecording(user,meeting.id,id);if(Number(meeting.project_id)!==Number(project.id))throw new WorkError(403,'Запись другого проекта');}
 for(const node of config.flow.nodes)if(node.type==='approval'){await validUsers(user,node.reviewer_ids,project.id);for(const id of node.reviewer_ids){const reviewer=await one("SELECT * FROM users WHERE id=? AND workspace_id=? AND status='active' AND is_service=FALSE",[id,user.workspace_id]);if(!reviewer||!(await projectPermissionSet(reviewer,project)).has('agent.approve'))throw new WorkError(422,'Согласующему требуется право подтверждения агента');}}
 const rights=await projectPermissionSet(user,project);
 for(const type of config.actions){const action=AGENT_ACTION_CATALOG.find(a=>a.key===type);if(action.permission&&!rights.has(action.permission))throw new WorkError(403,'Нет разрешения: '+action.permission);await extraScope(user,action.scope);}
 if(config.actions.includes('assign_task')){if(!rights.has('task.edit'))throw new WorkError(403,'Нет разрешения: task.edit');await validUsers(user,p.allowed_assignee_ids,project.id);}
 if(config.actions.includes('move_task'))for(const id of p.allowed_stage_ids)if(!await one('SELECT id FROM workflow_stages WHERE id=? AND workflow_id=?',[id,project.workflow_id]))throw new WorkError(422,'Разрешённый этап относится к другому процессу');
 if(config.actions.includes('create_article'))for(const id of p.article_space_ids)await agentKnowledgeAccess(user,id,true);
 if(config.actions.includes('chat_message'))for(const id of p.chat_channel_ids)await agentChatAccess(user,id,project.id,true);
}
export async function enrichAgentTask(user,item,opts){
 const ref={kind:'task',id:item.id,project_id:item.project_id,version:item.version_number};
 const data={...item};delete data.project_id;
 if(opts.custom_fields?.length){data.custom_values=Object.fromEntries(opts.custom_fields.filter(k=>Object.hasOwn(parseJson(item.custom_values_json,{}),k)).map(k=>[k,parseJson(item.custom_values_json,{})[k]]));ref.field_codes=opts.custom_fields;}delete data.custom_values_json;
 if(opts.include_comments){const comments=await rows('SELECT id,author_id,LEFT(body,3000) AS body,updated_at FROM comments WHERE task_id=? AND deleted_at IS NULL AND is_internal=FALSE ORDER BY id DESC LIMIT 10',[item.id]);data.comments=comments.reverse();ref.comments=comments.map(c=>({id:c.id,hash:sourceHash(c)}));}
 if(opts.include_checklist){data.checklist=await rows('SELECT id,title,completed FROM task_checklist_items WHERE task_id=? ORDER BY position,id LIMIT 30',[item.id]);ref.checklist_hash=sourceHash(data.checklist);}
 return {data,ref};
}
export async function checkExtraTaskRef(user,projectId,ref,{versions=false,customChecked=false}={}){
 if(!customChecked)await agentCustomAccess(user,projectId,ref.field_codes);
 if(ref.comments?.length){const comments=await rows(`SELECT id,author_id,LEFT(body,3000) AS body,updated_at FROM comments WHERE task_id=? AND deleted_at IS NULL AND is_internal=FALSE AND id IN (${ref.comments.map(()=>'?')})`,[ref.id,...ref.comments.map(c=>c.id)]);if(ref.comments.some(c=>!comments.some(now=>Number(now.id)===Number(c.id)&&sourceHash(now)===c.hash)))throw new WorkError(409,'Комментарий источника изменён или удалён');}
 if(versions&&ref.checklist_hash){const current=await rows('SELECT id,title,completed FROM task_checklist_items WHERE task_id=? ORDER BY position,id LIMIT 30',[ref.id]);if(sourceHash(current)!==ref.checklist_hash)throw new WorkError(409,'Чек-лист изменился');}
}
export async function collectExtraAgentSources(user,projectId,config,add,meta){
 const s=config.sources;
 if(s.planning){const sprints=await rows('SELECT id,name,LEFT(goal,2000) AS goal,status,start_date,end_date FROM sprints WHERE project_id=? ORDER BY id DESC LIMIT 20',[projectId]);const releases=await rows('SELECT id,name,LEFT(description,2000) AS description,status,release_date FROM releases WHERE project_id=? ORDER BY id DESC LIMIT 20',[projectId]);add({kind:'planning',id:projectId,sprints,releases},{kind:'planning',id:projectId,project_id:projectId});}
 if(s.objectives){const objectives=await rows('SELECT id,title,LEFT(description,3000) AS description,owner_id,due_date,revision FROM work_objectives WHERE project_id=? AND archived=FALSE ORDER BY due_date,id LIMIT 20',[projectId]);for(const objective of objectives){const results=await rows('SELECT id,title,mode,unit,start_value,target_value,current_value,confidence,revision FROM objective_key_results WHERE objective_id=? ORDER BY id LIMIT 20',[objective.id]);add({kind:'objective',...objective,results},{kind:'objective',id:objective.id,project_id:projectId,version:objective.revision,results:results.map(r=>({id:r.id,version:r.revision}))});}}
 for(const id of s.chat_channel_ids||[]){const chat=await agentChatAccess(user,id,projectId),messages=await rows('SELECT id,sender_id,LEFT(body,3000) AS body,edited_at,created_at FROM chat_messages WHERE channel_id=? AND deleted_at IS NULL AND body IS NOT NULL ORDER BY id DESC LIMIT 50',[id]);add({kind:'chat',id,name:chat.name,messages:messages.reverse()},{kind:'chat',id,project_id:projectId,messages:messages.map(m=>({id:m.id,hash:sourceHash(m)}))});}
 for(const id of s.recording_ids||[]){const row=await one('SELECT conference_id FROM conference_recordings WHERE id=? AND workspace_id=?',[id,user.workspace_id]);if(!row)throw new WorkError(403,'Запись недоступна');const record=await assertRecording(user,row.conference_id,id);const meeting=await recordingConferenceAccess(user,row.conference_id,'ai.conference.summarize');if(Number(meeting.project_id)!==Number(projectId)||record.transcript_status!=='completed')throw new WorkError(409,'Расшифровка записи недоступна');const chunks=await rows('SELECT chunk_index,start_seconds,LEFT(text,12000) AS text FROM conference_recording_transcripts WHERE recording_id=? ORDER BY chunk_index LIMIT 20',[id]);let available=16000;const selected=[];for(const c of chunks){if(available<=0){meta.omitted++;break;}selected.push({...c,text:c.text.slice(0,available)});if(c.text.length>available)meta.omitted++;available-=c.text.length;}add({kind:'recording',id,conference_id:meeting.id,title:meeting.title,chunks:selected},{kind:'recording',id,conference_id:meeting.id,project_id:projectId,version:record.transcript_revision});}
}
export async function checkExtraAgentRef(user,projectId,ref,{versions=false}={}){
 if(ref.kind==='planning'){await extraScope(user,'projects:read');if(Number(ref.id)!==Number(projectId))throw new WorkError(403,'План другого проекта');return;}
 if(ref.kind==='objective'){await extraScope(user,'objectives:read');await agentObjectiveAccess(user,projectId);const item=await one('SELECT project_id,revision,archived FROM work_objectives WHERE id=?',[ref.id]);if(!item||Number(item.project_id)!==Number(projectId)||item.archived)throw new WorkError(403,'Цель недоступна');if(versions){if(item.revision!==ref.version)throw new WorkError(409,'Цель изменилась');if(ref.results){const current=await rows('SELECT id,revision FROM objective_key_results WHERE objective_id=? ORDER BY id LIMIT 20',[ref.id]);if(current.length!==ref.results.length||ref.results.some(r=>!current.some(c=>Number(c.id)===Number(r.id)&&c.revision===r.version)))throw new WorkError(409,'Ключевые результаты цели изменились');}}return;}
 if(ref.kind==='chat'){await extraScope(user,'chat:read');await agentChatAccess(user,ref.id,projectId);if(ref.messages.length){const messages=await rows(`SELECT id,sender_id,LEFT(body,3000) AS body,edited_at,created_at FROM chat_messages WHERE channel_id=? AND deleted_at IS NULL AND id IN (${ref.messages.map(()=>'?')})`,[ref.id,...ref.messages.map(m=>m.id)]);if(ref.messages.some(m=>!messages.some(c=>Number(c.id)===Number(m.id)&&sourceHash(c)===m.hash)))throw new WorkError(409,'Исходные сообщения чата изменены');}return;}
 if(ref.kind==='recording'){await extraScope(user,'conference:read');const record=await assertRecording(user,ref.conference_id,ref.id),meeting=await recordingConferenceAccess(user,ref.conference_id,'ai.conference.summarize');if(Number(meeting.project_id)!==Number(projectId)||record.transcript_status!=='completed'||record.transcript_revision!==ref.version)throw new WorkError(409,'Расшифровка изменилась или недоступна');return;}
 throw new WorkError(403,'Неизвестный источник агента');
}
export function redactAgentEmails(value){if(typeof value==='string')return value.replace(/[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+/g,'[email скрыт]');if(Array.isArray(value))return value.map(redactAgentEmails);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,redactAgentEmails(v)]));return value;}
