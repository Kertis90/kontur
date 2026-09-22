import {one,rows} from './db.js';
import {WorkError,projectFor} from './work-common.js';
import {knowledgeSpaceAccess,knowledgeAccessAtLeast} from './knowledge-access.js';
import {assertRecording} from './recordings.js';
import {semanticHash} from './semantic-vectors.js';
export const SEMANTIC_KINDS=['task','knowledge','recording'];
export const SEMANTIC_SCOPES={task:'tasks:read',knowledge:'knowledge:read',recording:'conference:read'};
export async function nextSemanticSource(workspaceId,kind,after){
 const sql={task:'SELECT t.id FROM tasks t JOIN projects p ON p.id=t.project_id WHERE p.workspace_id=? AND t.id>? AND p.deleted_at IS NULL ORDER BY t.id LIMIT 1',knowledge:"SELECT a.id FROM knowledge_articles a JOIN knowledge_spaces s ON s.id=a.space_id WHERE s.workspace_id=? AND a.id>? AND a.status<>'archived' ORDER BY a.id LIMIT 1",recording:"SELECT id FROM conference_recordings WHERE workspace_id=? AND id>? AND deleted_at IS NULL AND transcript_status='completed' AND (retained_until IS NULL OR retained_until>CURRENT_TIMESTAMP) ORDER BY id LIMIT 1"};return one(sql[kind],[workspaceId,after]);
}
export async function semanticSource(user,kind,id){
 let source;
 if(kind==='task'){
  const t=await one('SELECT t.id,t.project_id,t.title,t.description,t.task_number,p.key_code FROM tasks t JOIN projects p ON p.id=t.project_id WHERE t.id=? AND p.workspace_id=? AND p.deleted_at IS NULL',[id,user.workspace_id]);
  if(!t)throw new WorkError(404,'Задача недоступна');await projectFor(user,t.project_id);source={title:`${t.key_code}-${t.task_number} · ${t.title}`,text:`${t.title}\n${t.description||''}`,url:`/?task=${t.id}`};
 }else if(kind==='knowledge'){
  const a=await one("SELECT a.* FROM knowledge_articles a JOIN knowledge_spaces s ON s.id=a.space_id WHERE a.id=? AND s.workspace_id=? AND a.status<>'archived'",[id,user.workspace_id]);
  if(!a)throw new WorkError(404,'Статья недоступна');const access=await knowledgeSpaceAccess(user,a.space_id);if(!knowledgeAccessAtLeast(access.level,a.status==='published'?'view':'edit'))throw new WorkError(403,'Статья недоступна');
  source={title:a.title,text:`${a.title}\n${a.body||''}`,url:`/?view=knowledge&article=${a.id}`};
 }else if(kind==='recording'){
  const r=await one('SELECT r.id,r.conference_id,c.title FROM conference_recordings r JOIN conferences c ON c.id=r.conference_id WHERE r.id=? AND r.workspace_id=?',[id,user.workspace_id]);
  if(!r)throw new WorkError(404,'Запись недоступна');const record=await assertRecording(user,r.conference_id,r.id);if(record.transcript_status!=='completed')throw new WorkError(409,'Расшифровка обновляется');
  const chunks=await rows('SELECT text FROM conference_recording_transcripts WHERE recording_id=? ORDER BY chunk_index LIMIT 5000',[id]);source={title:r.title,text:`${r.title}\n${chunks.map(c=>c.text).join('\n')}`,url:`/?view=work&tab=meetings&conference=${r.conference_id}&recording=${r.id}`};
 }else throw new WorkError(422,'Неизвестный источник');
 source.text=source.text.slice(0,128000);return {...source,hash:semanticHash(source.text)};
}
