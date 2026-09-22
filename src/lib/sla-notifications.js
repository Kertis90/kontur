import crypto from 'node:crypto';
import {z} from 'zod';
import {rows,one,transaction,parseJson} from './db.js';
import {body,reply,WorkError,positiveId,workspaceFor,projectFor,validUsers} from './work-common.js';
import {evaluateTaskSlas} from './task-sla.js';
import {createNotification,emitEvent} from './events.js';
import {audit} from './audit.js';
import {fieldAccess} from './work-access.js';
async function canReadPolicy(user,projectId,policy){const hidden=new Set((await fieldAccess(user,projectId)).filter(a=>!a.can_read).map(a=>`custom.${a.field_code}`));return !parseJson(policy.conditions_json,[]).some(c=>hidden.has(c.field));}
const configSchema=z.object({revision:z.number().int().nonnegative(),enabled:z.boolean(),notify_assignee:z.boolean(),warning:z.boolean(),breached:z.boolean(),escalation_minutes:z.number().int().min(1).max(525600).nullable(),escalation_user_ids:z.array(positiveId).max(30)}).strict();
export function slaNoticeTypes(sla,config){
 if(!config.enabled||sla.phase!=='running')return [];
 if(sla.status==='warning'&&config.warning)return ['sla.warning'];
 if(sla.status!=='breached')return [];
 return [...(config.breached?['sla.breached']:[]),...(config.escalation_minutes&&sla.elapsed_minutes-sla.goal_minutes>=config.escalation_minutes?['sla.escalated']:[])];
}
export async function slaNotificationsApi(request,path,user){
 await workspaceFor(user,'sla.manage');
 const policy=await one('SELECT * FROM task_sla_policies WHERE id=? AND workspace_id=?',[positiveId.parse(path[2]),user.workspace_id]);
 if(!policy)throw new WorkError(404,'Правило SLA не найдено');if(policy.project_id)await projectFor(user,policy.project_id);
 if(request.method==='GET'){
  const settings=await one('SELECT * FROM sla_notification_settings WHERE policy_id=?',[policy.id]);
  return reply(settings?{...settings,enabled:Boolean(settings.enabled),notify_assignee:Boolean(settings.notify_assignee),warning:Boolean(settings.warning),breached:Boolean(settings.breached),escalation_user_ids:parseJson(settings.escalation_user_ids_json,[])}:{revision:0,enabled:false,notify_assignee:true,warning:true,breached:true,escalation_minutes:null,escalation_user_ids:[]});
 }
 if(request.method!=='PUT')throw new WorkError(405,'Метод не поддерживается');
 const d=configSchema.parse(await body(request));await validUsers(user,d.escalation_user_ids,policy.project_id);
 if(d.escalation_minutes&&!d.escalation_user_ids.length)throw new WorkError(422,'Выберите получателей эскалации');
 await transaction(async c=>{
  await c.query('SELECT id FROM task_sla_policies WHERE id=? FOR UPDATE',[policy.id]);
  const [[existing]]=await c.query('SELECT revision FROM sla_notification_settings WHERE policy_id=?',[policy.id]);
  if((existing?.revision||0)!==d.revision)throw new WorkError(409,'Настройки изменены, обновите страницу');
  await c.query('INSERT INTO sla_notification_settings(policy_id,enabled,notify_assignee,warning,breached,escalation_minutes,escalation_user_ids_json,updated_by) VALUES(?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE enabled=VALUES(enabled),notify_assignee=VALUES(notify_assignee),warning=VALUES(warning),breached=VALUES(breached),escalation_minutes=VALUES(escalation_minutes),escalation_user_ids_json=VALUES(escalation_user_ids_json),updated_by=VALUES(updated_by),revision=revision+1',[policy.id,d.enabled,d.notify_assignee,d.warning,d.breached,d.escalation_minutes,JSON.stringify([...new Set(d.escalation_user_ids)]),user.id]);
 });await audit(user,'sla.notifications.updated','sla_policy',policy.id,{revision:d.revision+1},request);return reply({revision:d.revision+1});
}
export async function scanSlaNotifications(){
 const tasks=await transaction(async c=>{
  await c.query("INSERT IGNORE INTO maintenance_cursors(name) VALUES('sla-notifications')");
  const [[cursor]]=await c.query("SELECT last_id FROM maintenance_cursors WHERE name='sla-notifications' FOR UPDATE");
  const [items]=await c.query("SELECT t.*,p.workspace_id,s.is_done,s.code AS stage_code,s.category AS status_category,it.code AS issue_type_code FROM tasks t JOIN projects p ON p.id=t.project_id JOIN workflow_stages s ON s.id=t.stage_id LEFT JOIN issue_types it ON it.id=t.issue_type_id WHERE t.id>? AND p.deleted_at IS NULL AND p.status='active' AND s.is_done=FALSE ORDER BY t.id LIMIT 500",[cursor.last_id]);
  await c.query("UPDATE maintenance_cursors SET last_id=? WHERE name='sla-notifications'",[items.length===500?items.at(-1).id:0]);return items;
 });
 for(const workspaceId of new Set(tasks.map(t=>t.workspace_id))){
  const scoped=tasks.filter(t=>t.workspace_id===workspaceId).map(t=>({...t,custom_values:parseJson(t.custom_values_json,{})}));
  const policies=await rows('SELECT p.* FROM task_sla_policies p JOIN sla_notification_settings n ON n.policy_id=p.id WHERE p.workspace_id=? AND p.enabled=TRUE AND n.enabled=TRUE',[workspaceId]);
  if(!policies.length)continue;
  const calendars=await rows('SELECT * FROM business_calendars WHERE workspace_id=?',[workspaceId]);
  const events=await rows(`SELECT * FROM task_state_events WHERE task_id IN (${scoped.map(()=>'?').join(',')}) ORDER BY task_id,occurred_at,id`,scoped.map(t=>t.id));
  // Evaluate all active policies so disabling notifications on the winning policy cannot activate a lower-priority timer.
  const allPolicies=await rows('SELECT * FROM task_sla_policies WHERE workspace_id=? AND enabled=TRUE',[workspaceId]);
  const calculated=evaluateTaskSlas(scoped,allPolicies,new Date(),{calendars,events});
  for(const policy of policies){
   const config=await one('SELECT * FROM sla_notification_settings WHERE policy_id=?',[policy.id]);if(!config?.enabled)continue;
   const actor=await one("SELECT * FROM users WHERE id=? AND workspace_id=? AND status='active'",[config.updated_by,workspaceId]);if(!actor)continue;
   try{await workspaceFor(actor,'sla.manage');}catch(e){if(e.status===403)continue;throw e;}
   for(const sla of calculated.filter(s=>s.policy_id===policy.id)){
    const task=scoped.find(t=>t.id===sla.task_id);
    try{await projectFor(actor,task.project_id);if(!await canReadPolicy(actor,task.project_id,policy))continue;}catch(e){if(e.status===403)continue;throw e;}
    for(const eventType of slaNoticeTypes(sla,config)){
     const candidates=eventType==='sla.escalated'?parseJson(config.escalation_user_ids_json,[]):config.notify_assignee&&task.assignee_id?[task.assignee_id]:[];
     const recipients=[];for(const id of [...new Set(candidates)]){try{await validUsers(actor,[id],task.project_id);const recipient=await one("SELECT * FROM users WHERE id=? AND workspace_id=? AND status='active'",[id,workspaceId]);if(recipient&&await canReadPolicy(recipient,task.project_id,policy))recipients.push(id);}catch(e){if(![403,422].includes(e.status))throw e;}}
     const fingerprint=crypto.createHash('sha256').update([task.id,policy.id,policy.revision,config.revision,sla.calendar_revision||0,sla.cycle,eventType].join(':')).digest('hex');
     await transaction(async c=>{
      const [[current]]=await c.query('SELECT version_number FROM tasks WHERE id=? FOR UPDATE',[task.id]);if(!current||current.version_number!==task.version_number)return;
      const [insert]=await c.query('INSERT IGNORE INTO sla_notification_dispatches(fingerprint,task_id,policy_id,event_type) VALUES(?,?,?,?)',[fingerprint,task.id,policy.id,eventType]);if(!insert.affectedRows)return;
      const title={'sla.warning':'Приближается нарушение SLA','sla.breached':'Нарушен SLA задачи','sla.escalated':'Эскалация SLA'}[eventType];
      for(const recipient of recipients)await createNotification(recipient,eventType,title,`${task.title} · ${policy.name}`,'task',task.id,`/?task=${task.id}`,c);
      await emitEvent({workspaceId,eventType,aggregateType:'task',aggregateId:task.id,payload:{task_id:task.id,project_id:task.project_id,policy_id:policy.id,counter_key:sla.counter_key,cycle:sla.cycle}},c);
     });
    }
   }
  }
 }
 return {scanned:tasks.length};
}
