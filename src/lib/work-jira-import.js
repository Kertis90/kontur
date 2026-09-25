import {randomUUID,createHash} from 'node:crypto';
import {z} from 'zod';
import {one,rows,transaction,parseJson} from './db.js';
import {body,reply,WorkError,workspaceFor,projectFor,positiveId} from './work-common.js';
import {apiBackgroundAllowed} from './api-access.js';
import {importPlan} from './work-import.js';
import {createWorkTask,assertDependencyCycle} from './work-tasks.js';
import {encryptSecret,decryptSecret} from './crypto.js';
import {storage,bucket,safeFileName,deleteObject} from './storage.js';
import {jiraExtras,jiraLink} from './jira-import-model.js';
import {semanticHash} from './semantic-vectors.js';
import {audit} from './audit.js';
import {fieldAccess} from './work-access.js';
import {jiraTransferApi} from './jira-transfer-api.js';
async function actorFor(user,projectId,write=true){
 const actor=await one("SELECT * FROM users WHERE id=? AND workspace_id=? AND status='active'",[user.id,user.workspace_id]);
 if(!actor||!await apiBackgroundAllowed(actor,user.api_token_id,write?'imports:write':'imports:read'))throw new WorkError(403,'Доступ к импорту отозван');await workspaceFor(actor,'import.manage');await projectFor(actor,projectId,write?'task.create':'project.browse',write);return {...actor,api_token_id:user.api_token_id};
}
const decode=row=>JSON.parse(decryptSecret(row.payload_encrypted));
async function ownJob(user,id){const j=await one('SELECT * FROM jira_import_jobs WHERE id=? AND workspace_id=? AND user_id=?',[positiveId.parse(id),user.workspace_id,user.id]);if(!j)throw new WorkError(404,'Импорт не найден');return j;}
// Обслуживает импорт из файла и управляемый переезд с подключённого сервера Jira.
// Проверяет пакет импорта и сохраняет задачи, историю и описание файлов с единым составом полей.
export async function jiraImportApi(request,path,user){
 if(path[1]==='sources')return jiraTransferApi(request,path,user);
 if(path[1]==='task'&&request.method==='GET'){
  const task=await one('SELECT t.id,t.project_id FROM tasks t JOIN projects p ON p.id=t.project_id WHERE t.id=? AND p.workspace_id=?',[positiveId.parse(path[2]),user.workspace_id]);if(!task)throw new WorkError(404,'Задача не найдена');await projectFor(user,task.project_id);
  const after=Number(new URL(request.url).searchParams.get('after')||0);if(!Number.isSafeInteger(after)||after<0)throw new WorkError(422,'Неверный курсор');const restricted=(await fieldAccess(user,task.project_id)).some(f=>!f.can_read);
  const history=await rows(`SELECT id,source_key,kind,source_author,source_date,body_text FROM jira_task_history WHERE task_id=? AND id>? ${restricted?"AND kind='comment'":''} ORDER BY id LIMIT 100`,[task.id,after]);return reply({history,changes_restricted:restricted,next:history.length===100?history.at(-1).id:null});
 }
 await workspaceFor(user,'import.manage');
 if(request.method==='GET'&&!path[1]){const jobs=await rows('SELECT id,project_id,status,phase,total,revision,created_at FROM jira_import_jobs WHERE workspace_id=? AND user_id=? ORDER BY id DESC LIMIT 100',[user.workspace_id,user.id]),visible=[];for(const j of jobs){try{await projectFor(user,j.project_id);visible.push(j);}catch(e){if(![403,404].includes(e.status))throw e;}}return reply(visible);}
 if(request.method==='POST'&&!path[1]){
  const d=z.object({project_id:positiveId,text:z.string().min(1).max(2500000),stages:z.record(positiveId).default({}),include_attachments:z.boolean().default(true)}).parse(await body(request));user=await actorFor(user,d.project_id);
  let parsed;try{parsed=JSON.parse(d.text);}catch{throw new WorkError(422,'Некорректный JSON Jira');}const issues=parsed?.issues||parsed;if(!Array.isArray(issues)||issues.some(i=>!i||typeof i!=='object'||typeof i.key!=='string'||!i.key.trim()||i.key.length>255))throw new WorkError(422,'Ожидаются задачи с непустыми ключами Jira до 255 символов');
  const plan=await importPlan(user,{...d,source:'jira_json',mapping:{}});
  if(!plan.total||plan.total>500)throw new WorkError(422,'Один пакет: от 1 до 500 задач');
  if(issues.some(i=>!i.key)||new Set(issues.map(i=>i.key)).size!==issues.length)throw new WorkError(422,'Всем задачам нужны уникальные ключи Jira');
  const extras=issues.map(jiraExtras);for(let i=0;i<plan.records.length;i++)plan.records[i].warnings.push(...extras[i].warnings);
  if(plan.records.some(r=>r.errors.length))return reply({...plan,id:null});
  if(d.include_attachments&&extras.some(x=>x.attachments.length))await projectFor(user,d.project_id,'attachment.manage',true);
  const fingerprint=semanticHash(JSON.stringify({project_id:d.project_id,records:plan.records,extras,include_attachments:d.include_attachments}));
  const id=await transaction(async c=>{await c.query('SELECT id FROM users WHERE id=? FOR UPDATE',[user.id]);const [[pending]]=await c.query("SELECT COUNT(*) AS total FROM jira_import_jobs WHERE user_id=? AND status NOT IN ('completed','cancelled')",[user.id]);if(pending.total>=10)throw new WorkError(409,'Завершите или отмените один из 10 незавершённых импортов');const [result]=await c.query('INSERT INTO jira_import_jobs(workspace_id,project_id,user_id,api_token_id,total,preview_hash,include_attachments) VALUES(?,?,?,?,?,?,?)',[user.workspace_id,d.project_id,user.id,user.api_token_id||null,plan.total,fingerprint,d.include_attachments]);
   for(let i=0;i<plan.records.length;i++){const r=plan.records[i],extra=extras[i];if(!d.include_attachments&&extra.attachments.length)r.warnings.push('Перенос файлов отключён для этого пакета');if(r.duplicate)r.warnings.push('Задача уже импортирована; история и файлы существующей задачи не изменяются');await c.query('INSERT INTO jira_import_records(job_id,row_index,external_key,payload_encrypted,warnings_json) VALUES(?,?,?,?,?)',[result.insertId,r.row,r.external_key,encryptSecret(JSON.stringify({task:r.task,...extra})),JSON.stringify(r.warnings)]);
    if(d.include_attachments&&!r.duplicate)for(const file of extra.attachments)await c.query('INSERT INTO jira_import_files(job_id,row_index,external_id,file_name,expected_size,mime_type) VALUES(?,?,?,?,?,?)',[result.insertId,r.row,file.external_id,safeFileName(file.file_name),file.expected_size,file.mime_type]);}
   return result.insertId;});await audit(user,'jira.preview.created','jira_import',id);return reply({...plan,id,revision:1,preview_hash:fingerprint},201);
 }
 const job=await ownJob(user,path[1]);user=await actorFor(user,job.project_id,request.method!=='GET');
 if(request.method==='GET'&&!path[2])return reply({...job,api_token_id:undefined,lease_token:undefined,records:(await rows('SELECT row_index,external_key,task_id,status,warnings_json,links_complete FROM jira_import_records WHERE job_id=? ORDER BY row_index',[job.id])).map(r=>({...r,warnings:parseJson(r.warnings_json,[]),warnings_json:undefined})),files:await rows('SELECT id,row_index,external_id,file_name,expected_size,checksum_sha256,attached FROM jira_import_files WHERE job_id=? ORDER BY id',[job.id])});
 if(request.method==='PUT'&&path[2]==='files'){
  await projectFor(user,job.project_id,'attachment.manage',true);if(job.status!=='preview')throw new WorkError(409,'Файлы загружаются до запуска импорта');const file=await one('SELECT * FROM jira_import_files WHERE id=? AND job_id=?',[positiveId.parse(path[3]),job.id]);if(!file)throw new WorkError(404,'Вложение не найдено');
  const limit=Number(process.env.MAX_ATTACHMENT_BYTES||26214400);if(file.expected_size>limit||Number(request.headers.get('content-length')||0)>limit)throw new WorkError(413,'Файл превышает лимит вложений');
  const chunks=[];let size=0;for await(const chunk of request.body||[]){size+=chunk.length;if(size>limit||size>file.expected_size)throw new WorkError(413,'Размер файла не соответствует экспорту');chunks.push(chunk);}if(size!==Number(file.expected_size))throw new WorkError(422,'Размер файла отличается от экспорта');const bytes=Buffer.concat(chunks),sha=createHash('sha256').update(bytes).digest('hex');
  if(file.object_key){if(file.checksum_sha256!==sha)throw new WorkError(409,'Для этого вложения уже загружен другой файл');return reply({ok:true,replayed:true});}
  const key=`workspaces/${user.workspace_id}/projects/${job.project_id}/imports/${job.id}/${randomUUID()}`;await storage().putObject(bucket(),key,bytes,bytes.length,{'Content-Type':file.mime_type});
  try{await transaction(async c=>{const [[live]]=await c.query('SELECT status FROM jira_import_jobs WHERE id=? FOR UPDATE',[job.id]);if(live.status!=='preview')throw new WorkError(409,'Импорт уже запущен');const [updated]=await c.query('UPDATE jira_import_files SET object_key=?,checksum_sha256=? WHERE id=? AND object_key IS NULL',[key,sha,file.id]);if(!updated.affectedRows)throw new WorkError(409,'Вложение уже загружено');});}catch(e){await deleteObject(key).catch(()=>{});throw e;}return reply({ok:true,checksum_sha256:sha});
 }
 if(request.method==='POST'&&!path[2]){
  const d=z.object({revision:z.number().int().positive(),action:z.enum(['start','resume','cancel']),preview_hash:z.string().length(64).optional()}).parse(await body(request));
  await transaction(async c=>{const [[live]]=await c.query('SELECT * FROM jira_import_jobs WHERE id=? FOR UPDATE',[job.id]);if(live.revision!==d.revision)throw new WorkError(409,'Состояние импорта изменилось');
   if(d.action==='start'){if(live.status!=='preview'||d.preview_hash!==live.preview_hash)throw new WorkError(409,'Повторите предварительный просмотр');const [[missing]]=await c.query('SELECT COUNT(*) AS total FROM jira_import_files WHERE job_id=? AND object_key IS NULL',[job.id]);if(missing.total)throw new WorkError(409,'Загрузите все выбранные вложения');}
   if(d.action==='resume'&&!['failed','cancelled'].includes(live.status))throw new WorkError(409,'Импорт не остановлен');
   if(d.action==='resume'){const [[missing]]=await c.query('SELECT COUNT(*) AS total FROM jira_import_files WHERE job_id=? AND object_key IS NULL',[job.id]);if(missing.total)throw new WorkError(409,'Не все файлы загружены; создайте новый предварительный просмотр');}
   if(live.status==='completed')throw new WorkError(409,'Импорт завершён');
   await c.query('UPDATE jira_import_jobs SET status=?,revision=revision+1,error_code=NULL,lease_token=NULL,lease_until=NULL WHERE id=?',[d.action==='cancel'?'cancelled':'queued',job.id]);});await audit(user,`jira.${d.action}`,'jira_import',job.id);return reply({ok:true});
 }
 throw new WorkError(404,'Метод импорта Jira не найден');
}
export async function pollJiraImports(){
 const token=randomUUID(),job=await transaction(async c=>{const [[j]]=await c.query("SELECT * FROM jira_import_jobs WHERE status IN ('queued','running') AND (lease_until IS NULL OR lease_until<CURRENT_TIMESTAMP) ORDER BY updated_at,id LIMIT 1 FOR UPDATE SKIP LOCKED");if(!j)return null;await c.query("UPDATE jira_import_jobs SET status='running',lease_token=?,lease_until=DATE_ADD(CURRENT_TIMESTAMP,INTERVAL 2 MINUTE) WHERE id=?",[token,j.id]);return j;});if(!job)return;
 try{
  const user=await actorFor({id:job.user_id,workspace_id:job.workspace_id,api_token_id:job.api_token_id},job.project_id);
  const record=await one('SELECT * FROM jira_import_records WHERE job_id=? AND row_index>? ORDER BY row_index LIMIT 1',[job.id,job.cursor_row]);
  if(!record){await rows("UPDATE jira_import_jobs SET status=?,phase='links',cursor_row=0,revision=revision+1,lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=?",[job.phase==='tasks'?'queued':'completed',job.id,token]);return;}
  const payload=decode(record);
  if(job.phase==='tasks'&&job.include_attachments&&payload.attachments.length)await projectFor(user,job.project_id,'attachment.manage',true);
  if(job.phase==='links'&&payload.links.length)await projectFor(user,job.project_id,'task.edit',true);
  await transaction(async c=>{
   await c.query('SELECT id FROM projects WHERE id=? FOR UPDATE',[job.project_id]);const [[live]]=await c.query('SELECT lease_token,status FROM jira_import_jobs WHERE id=? FOR UPDATE',[job.id]);if(live.lease_token!==token||live.status!=='running')return;
   let warnings=parseJson(record.warnings_json,[]);
   if(job.phase==='tasks'){
    const [[existing]]=await c.query('SELECT task_id FROM work_import_items WHERE project_id=? AND external_key=?',[job.project_id,record.external_key]);
    if(existing)await c.query("UPDATE jira_import_records SET status='skipped',task_id=? WHERE job_id=? AND row_index=?",[existing.task_id,job.id,record.row_index]);
    else{
     const task=await createWorkTask(user,job.project_id,payload.task,c);await c.query('INSERT INTO work_import_items(project_id,external_key,task_id) VALUES(?,?,?)',[job.project_id,record.external_key,task.task_id]);
     for(const entry of payload.history)await c.query('INSERT INTO jira_task_history(task_id,source_key,entry_key,kind,source_author,source_date,body_text) VALUES(?,?,?,?,?,?,?)',[task.task_id,record.external_key,entry.entry_key,entry.kind,entry.author,entry.date,entry.body]);
     const [files]=await c.query('SELECT * FROM jira_import_files WHERE job_id=? AND row_index=?',[job.id,record.row_index]);for(const file of files){if(!file.object_key)throw new WorkError(409,'Файл не загружен');await c.query('INSERT INTO task_attachments(task_id,uploaded_by,file_name,object_key,mime_type,size_bytes,checksum_sha256) VALUES(?,?,?,?,?,?,?)',[task.task_id,user.id,file.file_name,file.object_key,file.mime_type,file.expected_size,file.checksum_sha256]);await c.query('UPDATE jira_import_files SET attached=TRUE WHERE id=?',[file.id]);}
     await c.query("UPDATE jira_import_records SET status='created',task_id=? WHERE job_id=? AND row_index=?",[task.task_id,job.id,record.row_index]);
    }
   }else if(record.status==='created'&&record.task_id){
    for(const link of payload.links){const [[target]]=await c.query('SELECT i.task_id FROM work_import_items i JOIN tasks t ON t.id=i.task_id WHERE i.project_id=? AND i.external_key=? AND t.project_id=?',[job.project_id,link.key,job.project_id]);if(!target){warnings.push(`Связь с ${link.key}: задача не импортирована`);continue;}const edge=jiraLink(record.task_id,target.task_id,link);if(!edge){warnings.push(`Связь ${link.type} с ${link.key}: тип не сопоставлен`);continue;}if(edge.task_id===edge.depends_on_task_id){warnings.push(`Связь с собой ${link.key} пропущена`);continue;}
     const [[existing]]=await c.query('SELECT dependency_type FROM task_dependencies WHERE task_id=? AND depends_on_task_id=?',[edge.task_id,edge.depends_on_task_id]);if(existing){if(existing.dependency_type!==edge.dependency_type)warnings.push(`Связь с ${link.key}: сохранён существующий тип`);continue;}
     if(edge.dependency_type==='blocks'){try{await assertDependencyCycle(c,edge.task_id,edge.depends_on_task_id);}catch(e){if(e.status!==409)throw e;warnings.push(`Связь с ${link.key}: цикл, связь пропущена`);continue;}}
     await c.query('INSERT INTO task_dependencies(task_id,depends_on_task_id,dependency_type) VALUES(?,?,?)',[edge.task_id,edge.depends_on_task_id,edge.dependency_type]);
    }
   }
   if(job.phase==='links')await c.query('UPDATE jira_import_records SET links_complete=TRUE,warnings_json=? WHERE job_id=? AND row_index=?',[JSON.stringify([...new Set(warnings)]),job.id,record.row_index]);
   await c.query('UPDATE jira_import_jobs SET cursor_row=?,revision=revision+1,lease_token=NULL,lease_until=NULL WHERE id=?',[record.row_index,job.id]);
  });
 }catch(e){await rows("UPDATE jira_import_jobs SET status='failed',error_code=?,revision=revision+1,lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=?",[e.status===403?'ACCESS_REVOKED':e.status===409?'CONFLICT_OR_APPROVAL_GATE':e.status===422?'INVALID_TASK_DATA':'IMPORT_FAILED',job.id,token]);}
}
