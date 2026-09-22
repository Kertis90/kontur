import {updateIntegrationHealth} from './integration-health.js';
import crypto from 'node:crypto';
import {one,rows,parseJson} from './db.js';
import {decryptSecret,encryptSecret} from './crypto.js';
import {projectFor,workspaceFor} from './work-common.js';
import {INTEGRATION_EVENTS} from './integration-catalog.js';
import {validateIntegrationCredentials,integrationEnvelope,sendIntegration} from './integration-adapters.js';

export async function enqueueIntegrationEvent(event){
 if(!INTEGRATION_EVENTS.some(e=>e.key===event.event_type))return 0;
 const payload=parseJson(event.payload_json,{}),taskId=Number(payload.task_id),projectId=Number(payload.project_id);
 if(!Number.isSafeInteger(taskId)||taskId<=0||!Number.isSafeInteger(projectId)||projectId<=0)return 0;
 const connections=await rows('SELECT id,event_types_json,version_number FROM integration_connections WHERE workspace_id=? AND project_id=? AND enabled=TRUE AND updated_at<=?',[event.workspace_id,projectId,event.created_at]);let count=0;
 for(const item of connections){
  if(!parseJson(item.event_types_json,[]).includes(event.event_type))continue;
  await rows('INSERT INTO integration_deliveries (id,connection_id,event_uuid,event_type,task_id,connection_version) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE event_uuid=event_uuid',[crypto.randomUUID(),item.id,event.event_uuid,event.event_type,taskId,item.version_number]);count++;
 }return count;
}
export function retryDelay(attempts,retryAfter=0){return Math.min(86400,Math.max([60,300,900,3600][Math.min(attempts-1,3)]||60,retryAfter));}
async function cancel(delivery,code){await rows("UPDATE integration_deliveries SET status='cancelled',error_code=?,completed_at=CURRENT_TIMESTAMP,lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=? AND status='running'",[code,delivery.id,delivery.lease_token]);}
export async function processIntegrationDelivery(id){
 const lease=crypto.randomUUID();
 const claimed=await rows("UPDATE integration_deliveries SET status='running',attempts=attempts+1,lease_token=?,lease_until=DATE_ADD(CURRENT_TIMESTAMP,INTERVAL 2 MINUTE) WHERE id=? AND status='pending' AND available_at<=CURRENT_TIMESTAMP",[lease,id]);
 if(!claimed.affectedRows)return {skipped:true};
 const delivery=await one('SELECT * FROM integration_deliveries WHERE id=? AND lease_token=?',[id,lease]);if(!delivery)return {skipped:true};
 let result;
 try{
  const item=await one('SELECT * FROM integration_connections WHERE id=?',[delivery.connection_id]);
  if(!item?.enabled||item.version_number!==delivery.connection_version){await cancel(delivery,'CONNECTION_CHANGED');return {cancelled:true};}
  const editor=await one("SELECT * FROM users WHERE id=? AND workspace_id=? AND status='active'",[item.created_by,item.workspace_id]);
  let task=null;
  try{
   if(!editor)throw new Error('inactive');
   await workspaceFor(editor,'integration.manage');await projectFor(editor,item.project_id,'project.admin',true);
   if(delivery.event_type==='automation.notification'){
    const requester=await one("SELECT * FROM users WHERE id=? AND workspace_id=? AND status='active'",[delivery.requested_by,item.workspace_id]);
    if(!requester)throw new Error('inactive');await workspaceFor(requester,'integration.send');await workspaceFor(requester,'automation.manage');await projectFor(requester,item.project_id);
   }
   if(delivery.event_type==='integration.test'){
    const requester=await one("SELECT * FROM users WHERE id=? AND workspace_id=? AND status='active'",[delivery.requested_by,item.workspace_id]);
    if(!requester)throw new Error('inactive');await workspaceFor(requester,'integration.test');await projectFor(requester,item.project_id);
   }
  }catch(error){if(error.status&&![403,404,409].includes(error.status))throw error;if(error.code)throw error;await cancel(delivery,'ACCESS_REVOKED');return {cancelled:true};}
  if(delivery.event_type!=='integration.test'){
   task=await one('SELECT t.id,t.project_id,t.task_number,t.title,p.key_code FROM tasks t JOIN projects p ON p.id=t.project_id WHERE t.id=? AND t.project_id=? AND p.workspace_id=?',[delivery.task_id,item.project_id,item.workspace_id]);
   if(!task){await cancel(delivery,'TASK_UNAVAILABLE');return {cancelled:true};}
  }
  let checked;try{checked=validateIntegrationCredentials(item.provider,JSON.parse(decryptSecret(item.credentials_encrypted)||'{}'),parseJson(item.config_json,{}));}catch{result={ok:false,code:'CONFIG_INVALID',retryable:false};}
  if(checked){
   let envelope;
   try{envelope=delivery.payload_encrypted?JSON.parse(decryptSecret(delivery.payload_encrypted)):integrationEnvelope(delivery,task);}catch{await cancel(delivery,'CONFIG_INVALID');return {cancelled:true};}
   if(!delivery.payload_encrypted)await rows("UPDATE integration_deliveries SET payload_encrypted=? WHERE id=? AND lease_token=? AND status='running'",[encryptSecret(JSON.stringify(envelope)),id,lease]);
   const current=await one("SELECT id FROM integration_deliveries WHERE id=? AND lease_token=? AND status='running'",[id,lease]);
   if(!current)return {cancelled:true};
   result=await sendIntegration(item.provider,checked.credentials,checked.config,envelope);
  }
 }catch(error){const code=['TIMEOUT','ADDRESS_BLOCKED','NETWORK_ERROR','RESPONSE_TOO_LARGE'].includes(error.code)?error.code:'NETWORK_ERROR';result={ok:false,code,retryable:['TIMEOUT','NETWORK_ERROR'].includes(code)};}
 const retry=!result.ok&&result.retryable&&delivery.attempts<5,status=result.ok?'delivered':retry?'pending':'failed';
 await rows(`UPDATE integration_deliveries SET status=?,http_status=?,error_code=?,available_at=DATE_ADD(CURRENT_TIMESTAMP,INTERVAL ? SECOND),completed_at=${retry?'NULL':'CURRENT_TIMESTAMP'},lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=? AND status='running'`,[status,result.status||null,result.ok?null:result.code,retryDelay(delivery.attempts,result.retryAfter),id,lease]);
 if(['delivered','failed'].includes(status))await updateIntegrationHealth(delivery.connection_id,status==='delivered');
 return {status};
}
export async function pollIntegrationDeliveries(){
 // Recover interrupted jobs without keeping transactions open during network I/O.
 await rows("UPDATE integration_deliveries SET status=IF(attempts<5,'pending','failed'),error_code='WORKER_INTERRUPTED',completed_at=IF(attempts<5,NULL,CURRENT_TIMESTAMP),lease_token=NULL,lease_until=NULL WHERE status='running' AND lease_until<CURRENT_TIMESTAMP");
 const pending=await rows("SELECT id FROM integration_deliveries WHERE status='pending' AND available_at<=CURRENT_TIMESTAMP ORDER BY available_at,id LIMIT 20");
 for(let i=0;i<pending.length;i+=4)await Promise.all(pending.slice(i,i+4).map(d=>processIntegrationDelivery(d.id)));
}
