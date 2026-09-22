import {slaNotificationsApi} from './sla-notifications.js';
import { z } from 'zod';
import { rows,one,transaction } from './db.js';
import { body,reply,WorkError,positiveId,workspaceFor,projectFor,dateOnly } from './work-common.js';
import { normalizeCalendar } from './business-time.js';
import { evaluateTaskSlas } from './task-sla.js';
import { fieldAccess,redactFields } from './work-access.js';
export const slaExtension={counter_key:z.string().regex(/^[a-z][a-z0-9_]{0,79}$/).default('completion'),calendar_id:positiveId.nullable().default(null),revision:positiveId.optional(),config:z.object({start_stage_ids:z.array(positiveId).max(100).default([]),stop_stage_ids:z.array(positiveId).max(100).default([]),pause_stage_ids:z.array(positiveId).max(100).default([]),reopen:z.enum(['resume','restart','keep']).default('resume')}).default({})};
export async function validateSlaConfig(user,data){
 if(data.calendar_id&&!await one('SELECT id FROM business_calendars WHERE id=? AND workspace_id=?',[data.calendar_id,user.workspace_id]))throw new WorkError(422,'Календарь не найден');
 const ids=[...new Set(Object.entries(data.config).filter(([k])=>k.endsWith('_ids')).flatMap(([,v])=>v))];if(ids.length){const found=await rows(`SELECT s.id,w.id AS workflow_id FROM workflow_stages s JOIN workflows w ON w.id=s.workflow_id WHERE w.workspace_id=? AND s.id IN (${ids.map(()=>'?').join(',')})`,[user.workspace_id,...ids]);if(found.length!==ids.length)throw new WorkError(422,'Этап недоступен');if(data.project_id){const p=await one('SELECT workflow_id FROM projects WHERE id=? AND workspace_id=?',[data.project_id,user.workspace_id]);if(found.some(s=>Number(s.workflow_id)!==Number(p?.workflow_id)))throw new WorkError(422,'Этап не принадлежит процессу проекта');}}
 if(data.config.pause_stage_ids.some(id=>data.config.stop_stage_ids.includes(id)))throw new WorkError(422,'Этап не может одновременно завершать и приостанавливать таймер');
}
const weekly=z.record(z.string().regex(/^[0-6]$/),z.array(z.tuple([z.number().int().min(0).max(1439),z.number().int().min(1).max(1440)])).max(8)).superRefine((week,ctx)=>{for(const intervals of Object.values(week)){const sorted=[...intervals].sort((a,b)=>a[0]-b[0]);for(let i=0;i<sorted.length;i++)if(sorted[i][0]>=sorted[i][1]||(i&&sorted[i][0]<sorted[i-1][1]))ctx.addIssue({code:'custom',message:'Рабочие интервалы должны идти по возрастанию и не пересекаться'});}});
export const calendarSchema=z.object({name:z.string().trim().min(2).max(180),timezone:z.string().max(100).refine(v=>{try{new Intl.DateTimeFormat('ru',{timeZone:v});return true;}catch{return false;}},'Неизвестный часовой пояс'),weekly,holidays:z.array(dateOnly).max(3660).default([]),revision:z.number().int().positive().optional()}).refine(c=>Object.values(c.weekly).some(v=>v.length),'Нужен хотя бы один рабочий интервал');
export async function slaApi(request,path,user){
 const method=request.method;
 if(path[1]==='notifications')return slaNotificationsApi(request,path,user);
 if(path[1]==='calendars'){
  await workspaceFor(user,'sla.manage');
  if(method==='GET')return reply((await rows('SELECT * FROM business_calendars WHERE workspace_id=? ORDER BY name',[user.workspace_id])).map(normalizeCalendar));
  const id=path[2]?positiveId.parse(path[2]):null;
  if(method==='DELETE'&&id)return transaction(async c=>{const [found]=await c.query('SELECT id FROM business_calendars WHERE id=? AND workspace_id=? FOR UPDATE',[id,user.workspace_id]);if(!found.length)throw new WorkError(404,'Календарь не найден');const [used]=await c.query('SELECT id FROM task_sla_policies WHERE calendar_id=? LIMIT 1',[id]);if(used.length)throw new WorkError(409,'Сначала замените календарь в правилах SLA');await c.query('DELETE FROM business_calendars WHERE id=?',[id]);return reply({ok:true});});
  if(['POST','PATCH'].includes(method)){const d=calendarSchema.parse(await body(request)),args=[d.name,d.timezone,JSON.stringify(d.weekly),JSON.stringify([...new Set(d.holidays)])];if(method==='PATCH'&&id){if(!d.revision)throw new WorkError(422,'Нужна версия календаря');const changed=await rows('UPDATE business_calendars SET name=?,timezone=?,weekly_json=?,holidays_json=?,revision=revision+1 WHERE id=? AND workspace_id=? AND revision=?',[...args,id,user.workspace_id,d.revision]);if(!changed.affectedRows)throw new WorkError(409,'Календарь уже изменён: обновите страницу');return reply({id,revision:d.revision+1});}if(method==='POST'&&!id){const created=await rows('INSERT INTO business_calendars(name,timezone,weekly_json,holidays_json,workspace_id,created_by) VALUES(?,?,?,?,?,?)',[...args,user.workspace_id,user.id]);return reply({id:created.insertId},201);}}
 }
 if(path[1]==='tasks'&&path[2]&&method==='GET'){
  const task=await one('SELECT t.*,s.is_done,s.code AS stage_code,s.category AS status_category,it.code AS issue_type_code FROM tasks t JOIN workflow_stages s ON s.id=t.stage_id LEFT JOIN issue_types it ON it.id=t.issue_type_id WHERE t.id=?',[positiveId.parse(path[2])]);if(!task)throw new WorkError(404,'Задача не найдена');await projectFor(user,task.project_id);
  const acl=await fieldAccess(user,task.project_id);task.custom_values=typeof task.custom_values_json==='string'?JSON.parse(task.custom_values_json):task.custom_values_json;const hidden=new Set(acl.filter(p=>!p.can_read).map(p=>`custom.${p.field_code}`));
  const policies=(await rows('SELECT * FROM task_sla_policies WHERE workspace_id=? AND (project_id=? OR project_id IS NULL)',[user.workspace_id,task.project_id])).filter(p=>!(typeof p.conditions_json==='string'?JSON.parse(p.conditions_json):p.conditions_json||[]).some(c=>hidden.has(c.field)));
  const [events,calendars]=await Promise.all([rows('SELECT * FROM task_state_events WHERE task_id=? ORDER BY occurred_at,id',[task.id]),rows('SELECT * FROM business_calendars WHERE workspace_id=?',[user.workspace_id])]);return reply(evaluateTaskSlas([redactFields(task,acl)],policies,new Date(),{events,calendars}));
 }
 throw new WorkError(404,'Метод SLA не найден');
}
