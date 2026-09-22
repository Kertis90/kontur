import crypto from 'node:crypto';
import {one} from './db.js';
import {workspaceFor,projectFor,WorkError} from './work-common.js';
export async function automationConnection(user,connectionId,projectId){
 await workspaceFor(user,'integration.send');
 const item=await one('SELECT id,project_id,name,provider,enabled,version_number FROM integration_connections WHERE id=? AND workspace_id=?',[connectionId,user.workspace_id]);
 if(!item||!item.enabled||Number(item.project_id)!==Number(projectId))throw new WorkError(422,'Подключение выключено или не принадлежит проекту правила');
 await projectFor(user,item.project_id);return item;
}
export async function queueAutomationIntegration(action,context,user,c){
 const item=await automationConnection(user,action.connection_id,context.project_id),id=crypto.randomUUID();
 await c.query("INSERT INTO integration_deliveries(id,connection_id,event_uuid,event_type,task_id,requested_by,connection_version) VALUES(?,?,?,'automation.notification',?,?,?)",[id,item.id,id,context.task_id,user.id,item.version_number]);return {status:'queued',delivery_id:id};
}
export async function validateAutomationIntegrations(user,rule){
 const visit=async actions=>{for(const action of actions){if(action.type==='branch'){await visit(action.then);await visit(action.else);}if(action.type==='integration_send'){if(!rule.project_id)throw new WorkError(422,'Действие интеграции требует конкретный проект правила');await automationConnection(user,action.connection_id,rule.project_id);}}};await visit(rule.actions);
}
