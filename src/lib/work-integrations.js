import {integrationHealthSummary} from './integration-health.js';
import crypto from 'node:crypto';
import {z} from 'zod';
import {rows,one,transaction,parseJson} from './db.js';
import {encryptSecret,decryptSecret} from './crypto.js';
import {audit} from './audit.js';
import {workspacePermissionSet} from './permissions.js';
import {WorkError,body,reply,positiveId,projectFor,visibleProjects,workspaceFor} from './work-common.js';
import {INTEGRATION_EVENTS,INTEGRATION_PROVIDERS} from './integration-catalog.js';
import {validateIntegrationCredentials} from './integration-adapters.js';

const schema=z.object({name:z.string().trim().min(2).max(160),project_id:positiveId,provider:z.enum(['telegram','mattermost','slack','webhook']),enabled:z.boolean(),event_types:z.array(z.enum(INTEGRATION_EVENTS.map(e=>e.key))).min(1).max(INTEGRATION_EVENTS.length).transform(v=>[...new Set(v)]),config:z.object({chat_id:z.string().max(100).optional(),message_thread_id:z.union([z.string().max(20),z.number(),z.null()]).optional()}).strict().default({}),credentials:z.object({token:z.string().max(200).optional(),url:z.string().max(2000).optional(),secret:z.string().max(256).optional()}).strict().optional(),version_number:z.number().int().positive().optional()}).strict();
const columns='id,workspace_id,project_id,provider,name,destination_label,config_json,event_types_json,enabled,version_number,created_by,created_at,updated_at';
export function publicIntegration(row){const {config_json,event_types_json,credentials_encrypted,...safe}=row;return {...safe,config:parseJson(config_json,{}),event_types:parseJson(event_types_json,[]),enabled:Boolean(row.enabled)};}
async function requireView(user){const rights=await workspacePermissionSet(user);if(!rights.has('integration.view')&&!rights.has('integration.manage'))throw new WorkError(403,'Нет доступа к интеграциям');return rights;}
async function connectionFor(user,id,write=false){
 const item=await one('SELECT * FROM integration_connections WHERE id=? AND workspace_id=?',[positiveId.parse(id),user.workspace_id]);
 if(!item)throw new WorkError(404,'Подключение не найдено');
 await projectFor(user,item.project_id,write?'project.admin':'project.browse',write);return item;
}
function validated(draft,existing){
 try{return validateIntegrationCredentials(draft.provider,draft.credentials||JSON.parse(decryptSecret(existing?.credentials_encrypted)||'{}'),draft.config);}
 catch(error){if(error instanceof z.ZodError)throw error;throw new WorkError(422,'Проверьте реквизиты. Требуется HTTPS; для Slack и Mattermost — URL входящего webhook.');}
}
async function cancelPending(c,id){await c.query("UPDATE integration_deliveries SET status='cancelled',error_code='CONNECTION_CHANGED',completed_at=CURRENT_TIMESTAMP,lease_token=NULL,lease_until=NULL WHERE connection_id=? AND status IN ('pending','running')",[id]);}
export async function integrationsApi(request,path,user){
 await requireView(user);const method=request.method;
 if(path.length===1&&method==='GET'){
  const projects=await visibleProjects(user),ids=projects.map(p=>p.id);
  const found=ids.length?await rows(`SELECT ${columns} FROM integration_connections WHERE workspace_id=? AND project_id IN (${ids.map(()=>'?').join(',')}) ORDER BY id DESC`,[user.workspace_id,...ids]):[];
  return reply({connections:found.map(publicIntegration),providers:INTEGRATION_PROVIDERS,events:INTEGRATION_EVENTS});
 }
 if(path.length===1&&method==='POST'){
  await workspaceFor(user,'integration.manage');const draft=schema.parse(await body(request));await projectFor(user,draft.project_id,'project.admin',true);
  const checked=validated(draft);
  const id=await transaction(async c=>{
   await c.query('SELECT id FROM workspaces WHERE id=? FOR UPDATE',[user.workspace_id]);
   const [count]=await c.query('SELECT COUNT(*) AS total FROM integration_connections WHERE workspace_id=?',[user.workspace_id]);
   if(count[0].total>=200)throw new WorkError(409,'Максимум 200 подключений в пространстве');
   const [result]=await c.query('INSERT INTO integration_connections (workspace_id,project_id,provider,name,destination_label,config_json,credentials_encrypted,event_types_json,enabled,created_by) VALUES (?,?,?,?,?,?,?,?,?,?)',[user.workspace_id,draft.project_id,draft.provider,draft.name,checked.label,JSON.stringify(checked.config),encryptSecret(JSON.stringify(checked.credentials)),JSON.stringify(draft.event_types),draft.enabled,user.id]);return result.insertId;
  });await audit(user,'integration.created','integration',id,{provider:draft.provider,project_id:draft.project_id},request);return reply({id},201);
 }
 const item=await connectionFor(user,path[1]);
 if(path.length===3&&['health','history'].includes(path[2])&&method==='GET'){
  await workspaceFor(user,'integration.logs');
  if(path[2]==='health')return reply(await integrationHealthSummary(item.id));
  return reply(await rows("SELECT a.action,a.details_json,a.created_at,u.display_name AS actor FROM audit_log a LEFT JOIN users u ON u.id=a.actor_id WHERE a.workspace_id=? AND a.entity_type='integration' AND a.entity_id=? ORDER BY a.id DESC LIMIT 100",[user.workspace_id,String(item.id)]));
 }
 if(path.length===3&&path[2]==='deliveries'&&method==='GET'){
  await workspaceFor(user,'integration.logs');
  const params=new URL(request.url).searchParams,offset=z.coerce.number().int().min(0).max(100000).parse(params.get('offset')||0);
  const status=z.enum(['pending','running','delivered','failed','cancelled']).optional().parse(params.get('status')||undefined);
  const found=await rows(`SELECT id,event_uuid,event_type,status,attempts,http_status,error_code,created_at,completed_at,available_at FROM integration_deliveries WHERE connection_id=? ${status?'AND status=?':''} ORDER BY created_at DESC,id DESC LIMIT 51 OFFSET ?`,[item.id,...(status?[status]:[]),offset]);
  return reply({items:found.slice(0,50),has_more:found.length>50});
 }
 if(path.length===3&&path[2]==='test'&&method==='POST'){
  await workspaceFor(user,'integration.test');const testInput=z.object({version_number:z.number().int().positive()}).strict().parse(await body(request));const id=crypto.randomUUID();
  await transaction(async c=>{
   const [[current]]=await c.query('SELECT * FROM integration_connections WHERE id=? FOR UPDATE',[item.id]);
   if(!current||current.version_number!==testInput.version_number)throw new WorkError(409,'Подключение изменено. Обновите список перед тестовой отправкой');
   if(!current.enabled)throw new WorkError(409,'Сначала включите подключение');
   const [recent]=await c.query("SELECT id FROM integration_deliveries WHERE connection_id=? AND event_type='integration.test' AND created_at>DATE_SUB(CURRENT_TIMESTAMP,INTERVAL 30 SECOND) LIMIT 1",[item.id]);
   if(recent.length)throw new WorkError(429,'Повторная проверка доступна через 30 секунд');
   await c.query("INSERT INTO integration_deliveries (id,connection_id,event_uuid,event_type,requested_by,connection_version) VALUES (?,?,?,'integration.test',?,?)",[id,item.id,id,user.id,current.version_number]);
  });await audit(user,'integration.test','integration',item.id,{delivery_id:id},request);return reply({id,status:'pending'},202);
 }
 if(path.length===5&&path[2]==='deliveries'&&path[4]==='retry'&&method==='POST'){
  await workspaceFor(user,'integration.test');await workspaceFor(user,'integration.logs');await projectFor(user,item.project_id,'project.admin',true);
  const deliveryId=z.string().uuid().parse(path[3]);
  await transaction(async c=>{
   const [[current]]=await c.query('SELECT * FROM integration_connections WHERE id=? FOR UPDATE',[item.id]);
   if(!current?.enabled)throw new WorkError(409,'Подключение выключено');
   const [result]=await c.query("UPDATE integration_deliveries SET status='pending',available_at=CURRENT_TIMESTAMP,completed_at=NULL,lease_until=NULL,lease_token=NULL WHERE id=? AND connection_id=? AND connection_version=? AND status='failed' AND completed_at<DATE_SUB(CURRENT_TIMESTAMP,INTERVAL 30 SECOND)",[deliveryId,item.id,current.version_number]);
   if(!result.affectedRows)throw new WorkError(409,'Повтор доступен через 30 секунд после ошибки, если подключение не изменялось');
  });await audit(user,'integration.retry','integration',item.id,{delivery_id:deliveryId},request);return reply({status:'pending'},202);
 }
 if(path.length===2&&['PUT','PATCH','DELETE'].includes(method)){
  await workspaceFor(user,'integration.manage');await projectFor(user,item.project_id,'project.admin',true);
  const input=await body(request);
  const draft=method==='PUT'?schema.extend({version_number:z.number().int().positive()}).parse(input):z.object({version_number:z.number().int().positive(),...(method==='PATCH'?{enabled:z.boolean()}:{})}).strict().parse(input);
  if(method==='PUT'&&(draft.provider!==item.provider||Number(draft.project_id)!==Number(item.project_id)))throw new WorkError(422,'Для смены сервиса или проекта создайте отдельное подключение');
  const checked=method==='PUT'?validated(draft,item):null;
  await transaction(async c=>{
   const [[current]]=await c.query('SELECT version_number FROM integration_connections WHERE id=? FOR UPDATE',[item.id]);
   if(!current||current.version_number!==draft.version_number)throw new WorkError(409,'Подключение изменено другим пользователем. Обновите список');
   await cancelPending(c,item.id);
   if(method==='DELETE')await c.query('DELETE FROM integration_connections WHERE id=?',[item.id]);
   else if(method==='PATCH')await c.query('UPDATE integration_connections SET enabled=?,created_by=?,version_number=version_number+1 WHERE id=?',[draft.enabled,user.id,item.id]);
   else await c.query('UPDATE integration_connections SET name=?,destination_label=?,config_json=?,credentials_encrypted=?,event_types_json=?,enabled=?,created_by=?,version_number=version_number+1 WHERE id=?',[draft.name,checked.label,JSON.stringify(checked.config),encryptSecret(JSON.stringify(checked.credentials)),JSON.stringify(draft.event_types),draft.enabled,user.id,item.id]);
  });await audit(user,method==='DELETE'?'integration.deleted':'integration.updated','integration',item.id,{version_before:draft.version_number,version_after:draft.version_number+1,changed_fields:method==='PUT'?['name','events','config','enabled',...(draft.credentials?['credentials']:[])]:method==='PATCH'?['enabled']:['deleted']},request);return reply({ok:true});
 }
 throw new WorkError(404,'Метод интеграции не найден');
}
