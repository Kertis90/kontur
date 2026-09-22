import crypto from 'node:crypto';
import {z} from 'zod';
import {one,rows,transaction,parseJson} from './db.js';
import {encryptSecret,decryptSecret} from './crypto.js';
import {WorkError,positiveId,workspaceFor,projectFor,body,reply,validUsers} from './work-common.js';
import {integrationUrl} from './integration-http.js';
import {syncLocal,syncRemote,pushExternal,pullExternal} from './external-sync-drivers.js';
import {snapshotHash,syncDecision,safeExternalKey,syncError} from './external-sync-model.js';
import {audit} from './audit.js';
const unpack=row=>({...row,config:parseJson(row.config_json,{})});
async function idleConnection(c,id){const [[row]]=await c.query('SELECT id,lease_until>CURRENT_TIMESTAMP AS syncing FROM external_connections WHERE id=? FOR UPDATE',[id]);if(!row||row.syncing)throw new WorkError(409,'Подключение удалено или выполняется синхронизация');}
async function access(user,kind,projectId){if(kind==='caldav')await workspaceFor(user,'calendar.connect');else{await workspaceFor(user,'integration.manage');await projectFor(user,projectId,'project.admin',true);}}
const schema=z.object({kind:z.enum(['caldav','gitlab']),name:z.string().trim().min(2).max(160),project_id:positiveId.nullable().default(null),enabled:z.boolean(),revision:z.number().int().nonnegative().default(0),credentials:z.object({url:z.string().url().max(2000),username:z.string().max(200).optional(),password:z.string().max(1000).optional(),token:z.string().max(1000).optional()}).strict().optional(),config:z.object({remote_project_id:positiveId.optional(),open_stage_id:positiveId.optional(),closed_stage_id:positiveId.optional(),users:z.record(z.string().regex(/^\d+$/),positiveId).default({})}).strict().default({})}).strict();
async function connectionFor(user,id){const row=await one('SELECT * FROM external_connections WHERE id=? AND workspace_id=? AND user_id=?',[positiveId.parse(id),user.workspace_id,user.id]);if(!row)throw new WorkError(404,'Подключение не найдено');await access(user,row.kind,row.project_id);return unpack(row);}
async function validateConfig(user,d,existing){
 await access(user,d.kind,d.project_id);
 const credentials=d.credentials||JSON.parse(decryptSecret(existing?.credentials_encrypted)||'{}');
 let url;try{url=integrationUrl(credentials.url);}catch{throw new WorkError(422,'Укажите HTTPS URL без логина и пароля в адресе');}if(url.search||url.hash)throw new WorkError(422,'URL не должен содержать параметры');
 if(d.kind==='caldav'){if(d.project_id||!credentials.username||credentials.username.includes(':')||!credentials.password)throw new WorkError(422,'Укажите имя пользователя и пароль приложения CalDAV');return {url:url.href,username:credentials.username,password:credentials.password};}
 if(!credentials.token||!d.config.remote_project_id||!d.config.open_stage_id||!d.config.closed_stage_id||d.config.open_stage_id===d.config.closed_stage_id)throw new WorkError(422,'Заполните токен, ID проекта GitLab и сопоставление этапов');
 const project=await projectFor(user,d.project_id,'project.admin',true),stages=await rows('SELECT id,is_done FROM workflow_stages WHERE workflow_id=?',[project.workflow_id]);
 if(!stages.some(s=>s.id===d.config.open_stage_id&&!s.is_done)||!stages.some(s=>s.id===d.config.closed_stage_id&&s.is_done))throw new WorkError(422,'Выберите рабочий и завершённый этап проекта');
 if(Object.keys(d.config.users).length>200||new Set(Object.values(d.config.users)).size!==Object.values(d.config.users).length)throw new WorkError(422,'Сопоставление пользователей должно быть однозначным, до 200 записей');await validUsers(user,Object.values(d.config.users),d.project_id);
 return {url:url.href,token:credentials.token};
}
export async function externalSyncApi(request,path,user){
 const method=request.method;
 if(path.length===1&&method==='GET'){
  const found=await rows('SELECT id,kind,name,project_id,enabled,revision,config_json,synced_at,error_code FROM external_connections WHERE workspace_id=? AND user_id=? ORDER BY id DESC',[user.workspace_id,user.id]),visible=[];
  for(const row of found){try{await access(user,row.kind,row.project_id);visible.push({...unpack(row),enabled:Boolean(row.enabled)});}catch(e){if(e.status!==403)throw e;}}return reply(visible);
 }
 if(path.length===1&&method==='POST'){
  const d=schema.parse(await body(request)),credentials=await validateConfig(user,d);
  const id=await transaction(async c=>{await c.query('SELECT id FROM users WHERE id=? FOR UPDATE',[user.id]);const [[count]]=await c.query('SELECT COUNT(*) AS total FROM external_connections WHERE user_id=?',[user.id]);if(count.total>=20)throw new WorkError(409,'Максимум 20 подключений на пользователя');const [result]=await c.query('INSERT INTO external_connections(workspace_id,user_id,kind,project_id,name,enabled,credentials_encrypted,config_json) VALUES(?,?,?,?,?,?,?,?)',[user.workspace_id,user.id,d.kind,d.project_id,d.name,d.enabled,encryptSecret(JSON.stringify(credentials)),JSON.stringify(d.config)]);return result.insertId;});await audit(user,'sync.created','external_connection',id);return reply({id},201);
 }
 const connection=await connectionFor(user,path[1]);
 if(path.length===2&&method==='PUT'){
  const d=schema.parse(await body(request));if(d.kind!==connection.kind||d.project_id!==connection.project_id)throw new WorkError(422,'Создайте другое подключение для смены проекта или сервиса');const credentials=await validateConfig(user,d,connection);
  const result=await rows('UPDATE external_connections SET name=?,enabled=?,credentials_encrypted=?,config_json=?,revision=revision+1,error_code=NULL,next_sync_at=CURRENT_TIMESTAMP WHERE id=? AND revision=? AND (lease_until IS NULL OR lease_until<CURRENT_TIMESTAMP)',[d.name,d.enabled,encryptSecret(JSON.stringify(credentials)),JSON.stringify(d.config),connection.id,d.revision]);if(!result.affectedRows)throw new WorkError(409,'Подключение изменено или синхронизация выполняется');await audit(user,'sync.updated','external_connection',connection.id,{revision:d.revision+1});return reply({ok:true});
 }
 if(path.length===2&&method==='DELETE'){
  const d=z.object({revision:positiveId}).parse(await body(request));const result=await rows('DELETE FROM external_connections WHERE id=? AND revision=? AND (lease_until IS NULL OR lease_until<CURRENT_TIMESTAMP)',[connection.id,d.revision]);if(!result.affectedRows)throw new WorkError(409,'Подключение изменено или синхронизация выполняется');await audit(user,'sync.deleted','external_connection',connection.id);return reply({ok:true});
 }
 if(path[2]==='run'&&path.length===3&&method==='POST'){
  const d=z.object({revision:positiveId}).parse(await body(request));const changed=await rows('UPDATE external_connections SET next_sync_at=CURRENT_TIMESTAMP WHERE id=? AND revision=? AND enabled=TRUE AND (lease_until IS NULL OR lease_until<CURRENT_TIMESTAMP)',[connection.id,d.revision]);if(!changed.affectedRows)throw new WorkError(409,'Подключение выключено, изменено или уже синхронизируется');return reply({queued:true},202);
 }
 if(path[2]==='log'&&method==='GET')return reply(await rows('SELECT action,error_code,created_at,binding_id FROM external_sync_log WHERE connection_id=? ORDER BY id DESC LIMIT 100',[connection.id]));
 if(path[2]==='bindings'){
  if(path.length===3&&method==='GET'){
   const found=await rows('SELECT id,entity_id,external_key,status,error_code,revision,synced_at,conflict_encrypted FROM external_bindings WHERE connection_id=? ORDER BY id DESC LIMIT 500',[connection.id]),visible=[];
   for(const row of found){try{const local=await syncLocal(connection,row,user);visible.push({...row,conflict_encrypted:undefined,conflict:row.conflict_encrypted?JSON.parse(decryptSecret(row.conflict_encrypted)):null,conflict_hash:row.conflict_encrypted?snapshotHash(JSON.parse(decryptSecret(row.conflict_encrypted))):null,title:local.snapshot.title});}catch(e){if(![403,404].includes(e.status)&&!e.syncCode)throw e;}}return reply(visible);
  }
  if(path.length===3&&method==='POST'){
   const d=z.object({entity_id:positiveId,external_key:z.string().max(100).optional()}).parse(await body(request));
   const binding={...d,external_key:connection.kind==='caldav'?`kontur-${user.workspace_id}-${crypto.randomUUID()}`:safeExternalKey('gitlab',d.external_key)};await syncLocal(connection,binding,user);
   const result=await transaction(async c=>{await idleConnection(c,connection.id);const [[count]]=await c.query('SELECT COUNT(*) AS total FROM external_bindings WHERE connection_id=?',[connection.id]);if(count.total>=500)throw new WorkError(409,'Максимум 500 связей на подключение');const [result]=await c.query('INSERT INTO external_bindings(connection_id,entity_id,external_key) VALUES(?,?,?)',[connection.id,binding.entity_id,binding.external_key]);return result;});return reply({id:result.insertId},201);
  }
  const binding=await one('SELECT * FROM external_bindings WHERE id=? AND connection_id=?',[positiveId.parse(path[3]),connection.id]);if(!binding)throw new WorkError(404,'Связь не найдена');await syncLocal(connection,binding,user);
  if(method==='DELETE'&&path.length===4){await transaction(async c=>{await idleConnection(c,connection.id);await c.query('DELETE FROM external_bindings WHERE id=?',[binding.id]);});return reply({ok:true});}
  if(method==='POST'&&path[4]==='resolve'){
   const d=z.object({revision:positiveId,choice:z.enum(['local','remote']),conflict_hash:z.string().length(64)}).parse(await body(request));
   const conflict=JSON.parse(decryptSecret(binding.conflict_encrypted)||'null');if(!conflict||snapshotHash(conflict)!==d.conflict_hash)throw new WorkError(409,'Конфликт изменился');
   await transaction(async c=>{await idleConnection(c,connection.id);const [result]=await c.query("UPDATE external_bindings SET resolution=?,resolution_hash=?,revision=revision+1 WHERE id=? AND revision=? AND status='conflict'",[d.choice,d.conflict_hash,binding.id,d.revision]);if(!result.affectedRows)throw new WorkError(409,'Связь изменена');await c.query('UPDATE external_connections SET next_sync_at=CURRENT_TIMESTAMP WHERE id=?',[connection.id]);});await audit(user,'sync.conflict.resolved','external_binding',binding.id,{choice:d.choice});return reply({queued:true},202);
  }
 }
 throw new WorkError(404,'Метод синхронизации не найден');
}
export async function syncOneBinding(connection,binding,user,credentials){
 const local=await syncLocal(connection,binding,user),remote=await syncRemote(connection,binding,credentials,user),baseline=binding.baseline_encrypted?JSON.parse(decryptSecret(binding.baseline_encrypted)):null;
 let decision=syncDecision(baseline,local.snapshot,remote.snapshot);const conflict={local:local.snapshot,remote:remote.snapshot};
 if(binding.resolution&&binding.resolution_hash===snapshotHash(conflict))decision=binding.resolution==='local'?'push':'pull';
 if(decision==='conflict'){
  await rows("UPDATE external_bindings SET status='conflict',conflict_encrypted=?,resolution=NULL,resolution_hash=NULL,error_code=NULL,revision=revision+1,checked_at=CURRENT_TIMESTAMP WHERE id=? AND revision=?",[encryptSecret(JSON.stringify(conflict)),binding.id,binding.revision]);return 'conflict';
 }
 if(decision==='push')await pushExternal(connection,binding,credentials,user,local,remote);
 if(decision==='pull')await pullExternal(connection,binding,user,local,remote);
 const afterLocal=await syncLocal(connection,binding,user),afterRemote=await syncRemote(connection,binding,credentials,user);
 // Never acknowledge an overwrite race as a successful sync.
 if(snapshotHash(afterLocal.snapshot)!==snapshotHash(afterRemote.snapshot))throw syncError('CHANGED_DURING_SYNC');
 await rows("UPDATE external_bindings SET status='synced',baseline_encrypted=?,conflict_encrypted=NULL,error_code=NULL,resolution=NULL,resolution_hash=NULL,synced_at=CURRENT_TIMESTAMP,checked_at=CURRENT_TIMESTAMP,revision=revision+1 WHERE id=? AND revision=?",[encryptSecret(JSON.stringify({local:afterLocal.snapshot,remote:afterRemote.snapshot})),binding.id,binding.revision]);return decision;
}
export async function pollExternalSync(){
 const pending=await rows('SELECT id FROM external_connections WHERE enabled=TRUE AND next_sync_at<=CURRENT_TIMESTAMP AND (lease_until IS NULL OR lease_until<CURRENT_TIMESTAMP) ORDER BY next_sync_at LIMIT 1');
 for(const {id} of pending){const lease=crypto.randomUUID(),claim=await rows('UPDATE external_connections SET lease_token=?,lease_until=DATE_ADD(CURRENT_TIMESTAMP,INTERVAL 5 MINUTE),next_sync_at=DATE_ADD(CURRENT_TIMESTAMP,INTERVAL 5 MINUTE) WHERE id=? AND enabled=TRUE AND (lease_until IS NULL OR lease_until<CURRENT_TIMESTAMP)',[lease,id]);if(!claim.affectedRows)continue;
  try{
   const connection=unpack(await one('SELECT * FROM external_connections WHERE id=?',[id])),user=await one("SELECT * FROM users WHERE id=? AND workspace_id=? AND status='active'",[connection.user_id,connection.workspace_id]);if(!user)throw syncError('ACCESS_REVOKED');await access(user,connection.kind,connection.project_id);
   const credentials=JSON.parse(decryptSecret(connection.credentials_encrypted)),bindings=await rows('SELECT * FROM external_bindings WHERE connection_id=? ORDER BY checked_at,id LIMIT 10',[id]);
   for(const binding of bindings){
    const renewed=await rows('UPDATE external_connections SET lease_until=DATE_ADD(CURRENT_TIMESTAMP,INTERVAL 2 MINUTE) WHERE id=? AND lease_token=? AND enabled=TRUE AND revision=?',[id,lease,connection.revision]);if(!renewed.affectedRows)break;
    try{const actor=await one("SELECT * FROM users WHERE id=? AND workspace_id=? AND status='active'",[connection.user_id,connection.workspace_id]);if(!actor)throw syncError('ACCESS_REVOKED');await access(actor,connection.kind,connection.project_id);const action=await syncOneBinding(connection,binding,actor,credentials);await rows('INSERT INTO external_sync_log(connection_id,binding_id,action) VALUES(?,?,?)',[id,binding.id,action]);}
    catch(error){const code=error.syncCode||([403,404].includes(error.status)?'ACCESS_REVOKED':['ADDRESS_BLOCKED','TIMEOUT'].includes(error.code)?error.code:'SYNC_FAILED');await rows("UPDATE external_bindings SET status='failed',error_code=?,checked_at=CURRENT_TIMESTAMP WHERE id=?",[code,binding.id]);await rows("INSERT INTO external_sync_log(connection_id,binding_id,action,error_code) VALUES(?,?,'failed',?)",[id,binding.id,code]);}
   }
   await rows('UPDATE external_connections SET synced_at=CURRENT_TIMESTAMP,error_code=NULL,next_sync_at=DATE_ADD(CURRENT_TIMESTAMP,INTERVAL ? SECOND) WHERE id=? AND lease_token=?',[bindings.length===10?30:300,id,lease]);
  }catch{await rows("UPDATE external_connections SET error_code='SYNC_FAILED' WHERE id=? AND lease_token=?",[id,lease]);}
  finally{await rows('UPDATE external_connections SET lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=?',[id,lease]);}
 }
}
