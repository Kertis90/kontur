import {z} from 'zod';
import {rows,one,db,parseJson} from './db.js';
import {body,reply,WorkError,visibleProjects,positiveId} from './work-common.js';
import {projectPermissionSet,workspacePermissionSet} from './permissions.js';
import {dashboardFilterSchema,timezoneSchema,dashboardGroups,readableDashboard} from './dashboard-access.js';
import {filterTasks} from './view-filters.js';
import {formulaValue,metricSnapshot,previousPeriod,localDay,shiftDay,forecastCompletion,utcTime,METRICS,completionEvents} from './analytics-math.js';
import {fieldAccess,redactFields} from './work-access.js';
import {evaluateTaskSlas} from './task-sla.js';
import {sendSystemMail} from './settings.js';
export function reportPeriod(filter,now=new Date()){const to=filter.to||localDay(now,filter.timezone||'UTC'),from=filter.from||shiftDay(to,-29);if(from>to)throw new WorkError(422,'Начало периода позже окончания');return {from,to,timezone:filter.timezone||'UTC'};}
export async function analyticsData(user,filter={},permission='project.browse'){
 const projects=(await visibleProjects(user,permission)).filter(p=>!filter.projectId||p.id===filter.projectId),ids=projects.map(p=>p.id);
 if(!ids.length)return {tasks:[],events:[],slas:[],projects};
 const fields=new Map(await Promise.all(ids.map(async id=>[id,await fieldAccess(user,id)]))),hidden=new Set([...fields.values()].flatMap(p=>p.filter(f=>!f.can_read).map(f=>`custom.${f.field_code}`)));
 const marks=ids.map(()=>'?').join(',');
 const [tasks,events,policies,calendars]=await Promise.all([
  rows(`SELECT t.*,p.key_code,s.is_done FROM tasks t JOIN projects p ON p.id=t.project_id JOIN workflow_stages s ON s.id=t.stage_id WHERE t.project_id IN (${marks})`,ids),
  rows(`SELECT e.* FROM task_state_events e JOIN tasks t ON t.id=e.task_id WHERE t.project_id IN (${marks})`,ids),
  rows('SELECT * FROM task_sla_policies WHERE workspace_id=? AND enabled=TRUE',[user.workspace_id]),rows('SELECT * FROM business_calendars WHERE workspace_id=?',[user.workspace_id])]);
 const visible=filterTasks(tasks.map(t=>redactFields({...t,custom_values:parseJson(t.custom_values_json,{})},fields.get(t.project_id)||[])),filter);
 return {tasks:visible,events,slas:evaluateTaskSlas(visible,policies.filter(p=>!parseJson(p.conditions_json,[]).some(c=>hidden.has(c.field))),new Date(),{events,calendars}),projects};
}
export async function dashboardMetrics(user,filter={},expression='total',widgetProjectId=null){
 const source=await analyticsData(user,filter);if(widgetProjectId)source.tasks=source.tasks.filter(t=>t.project_id===widgetProjectId);const period=reportPeriod(filter),current=metricSnapshot(source.tasks,source.events,source.slas,period),previous=metricSnapshot(source.tasks,source.events,source.slas,previousPeriod(period));
 let value;try{value=formulaValue(expression,current);}catch(e){throw new WorkError(422,e.message);}
 return {metrics:current,value,period,previous:{created:previous.created,completed:previous.completed},note:'Период влияет на created/completed. Остальные показатели — текущее состояние. Отбор по текущим параметрам задач; старые закрытия до миграции не включаются.'};
}
const subscriptionSchema=z.object({enabled:z.boolean(),frequency:z.enum(['daily','weekly']),timezone:timezoneSchema,delivery_hour:z.number().int().min(0).max(23),weekday:z.number().int().min(0).max(6),revision:z.number().int().min(0)});
export function subscriptionDue(s,now=new Date()){
 if(!s.enabled)return false;const parts=Object.fromEntries(new Intl.DateTimeFormat('en',{timeZone:s.timezone,hour:'numeric',hourCycle:'h23',weekday:'short'}).formatToParts(now).map(p=>[p.type,p.value]));
 if(Number(parts.hour)!==Number(s.delivery_hour))return false;
 if(s.frequency==='weekly'&&['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(parts.weekday)!==Number(s.weekday))return false;
 if(s.last_sent_at&&localDay(utcTime(s.last_sent_at),s.timezone)===localDay(now,s.timezone))return false;
 if(s.last_attempt_at&&now-utcTime(s.last_attempt_at)<15*60000)return false;
 return true;
}
export async function analyticsApi(request,path,user){
 if(path[1]==='metrics'&&request.method==='POST'){const d=z.object({filter:dashboardFilterSchema.default({}),expression:z.string().max(512).default('total'),widget_project_id:positiveId.nullable().optional()}).parse(await body(request));return reply(await dashboardMetrics(user,d.filter,d.expression,d.widget_project_id));}
 if(path[1]==='groups'&&request.method==='GET')return reply((await workspacePermissionSet(user)).has('dashboard.share')?await rows('SELECT id,name FROM access_groups WHERE workspace_id=? AND active=TRUE ORDER BY name',[user.workspace_id]):await dashboardGroups(user));
 if(path[1]==='forecast'&&request.method==='GET'){
  const projectId=positiveId.parse(new URL(request.url).searchParams.get('project_id')),source=await analyticsData(user,{projectId},'report.view');if(!source.projects.length||!(await projectPermissionSet(user,source.projects[0])).has('project.browse'))throw new WorkError(403,'Нет доступа к отчёту проекта');
  const today=localDay(new Date()),end=shiftDay(today,-1),first=source.events.filter(e=>e.source==='recorded').map(e=>localDay(utcTime(e.occurred_at))).sort()[0]||today,start=first>shiftDay(end,-83)?first:shiftDay(end,-83),count=Math.max(0,Math.round((Date.parse(end)-Date.parse(start))/86400000)+1),days=Array.from({length:count},(_,i)=>shiftDay(start,i)),daily=days.map(()=>0),seen=new Set();
  // One final recorded closure per task; reopening does not inflate throughput.
  const completeIds=new Set(source.tasks.filter(t=>t.is_done).map(t=>t.id));
  for(const e of completionEvents(source.events).sort((a,b)=>utcTime(b.occurred_at)-utcTime(a.occurred_at)||b.id-a.id)){if(!e.is_done||e.source!=='recorded'||seen.has(e.task_id)||!completeIds.has(e.task_id))continue;seen.add(e.task_id);const day=localDay(utcTime(e.occurred_at)),index=days.indexOf(day);if(index>=0)daily[index]++;}
  const forecast=forecastCompletion(daily,source.tasks.filter(t=>!t.is_done).length);return reply({...forecast,dates:Object.fromEntries(['p50','p85','p95'].map(p=>[p,forecast[p]!=null?shiftDay(end,forecast[p]):null])),daily:days.map((date,i)=>({date,completed:daily[i]})),window:{from:start,to:end},assumptions:'Случайная выборка семидневных блоков за 84 дня. Будущая очередь должна быть сопоставима с прошлой; поступление новых задач не учитывается. Вероятности — оценка модели, не гарантия срока.'});
 }
 if(path[1]==='subscriptions'&&path[2]){
  const dashboard=await readableDashboard(user,path[2]);
  if(request.method==='GET')return reply(await one('SELECT * FROM dashboard_subscriptions WHERE user_id=? AND dashboard_id=?',[user.id,dashboard.id])||{enabled:false,frequency:'weekly',timezone:'UTC',delivery_hour:9,weekday:1,revision:0});
  if(request.method==='PUT'){
   const d=subscriptionSchema.parse(await body(request)),connection=await db.getConnection();
   try{await connection.beginTransaction();await connection.query('SELECT id FROM users WHERE id=? FOR UPDATE',[user.id]);const [[old]]=await connection.query('SELECT revision FROM dashboard_subscriptions WHERE user_id=? AND dashboard_id=?',[user.id,dashboard.id]);if(Number(old?.revision||0)!==d.revision)throw new WorkError(409,'Подписка изменена на другом устройстве');await connection.query('INSERT INTO dashboard_subscriptions(user_id,dashboard_id,enabled,frequency,timezone,delivery_hour,weekday) VALUES(?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE enabled=VALUES(enabled),frequency=VALUES(frequency),timezone=VALUES(timezone),delivery_hour=VALUES(delivery_hour),weekday=VALUES(weekday),revision=revision+1,last_error=NULL',[user.id,dashboard.id,d.enabled,d.frequency,d.timezone,d.delivery_hour,d.weekday]);await connection.commit();}catch(e){await connection.rollback();throw e;}finally{connection.release();}return reply({ok:true});
  }
 }
 throw new WorkError(404,'Метод аналитики не найден');
}
export async function deliverDashboardReports(){
 const subscriptions=await rows("SELECT s.* FROM dashboard_subscriptions s JOIN users u ON u.id=s.user_id WHERE s.enabled=TRUE AND u.status='active'");
 for(const subscription of subscriptions){if(!subscriptionDue(subscription))continue;const connection=await db.getConnection(),lockName=`kontur-dashboard-${subscription.user_id}-${subscription.dashboard_id}`;
  try{const [[lock]]=await connection.query('SELECT GET_LOCK(?,0) AS acquired',[lockName]);if(!lock.acquired)continue;
   const fresh=await one('SELECT * FROM dashboard_subscriptions WHERE user_id=? AND dashboard_id=?',[subscription.user_id,subscription.dashboard_id]);if(!fresh||!subscriptionDue(fresh))continue;
   const user=await one("SELECT * FROM users WHERE id=? AND status='active'",[fresh.user_id]);if(!user)continue;
   await rows('UPDATE dashboard_subscriptions SET last_attempt_at=CURRENT_TIMESTAMP WHERE user_id=? AND dashboard_id=?',[fresh.user_id,fresh.dashboard_id]);
   const dashboard=await readableDashboard(user,fresh.dashboard_id),filter={...parseJson(dashboard.layout_json,{}).filter,timezone:fresh.timezone},result=await dashboardMetrics(user,filter),widgets=await rows('SELECT title,config_json FROM dashboard_widgets WHERE dashboard_id=? AND widget_type=\'formula\'',[dashboard.id]);
   const lines=[`Показатели дашборда «${dashboard.name}»`,`${result.period.from} — ${result.period.to} (${result.period.timezone})`,...Object.entries(result.metrics).map(([key,value])=>`${METRICS[key]}: ${Math.round(value*100)/100}`)];
   for(const widget of widgets){const config=parseJson(widget.config_json,{}),metric=await dashboardMetrics(user,filter,config.expression,config.projectId?Number(config.projectId):null);lines.push(`${widget.title}: ${metric.value??'Не определено'}`);}
   lines.push(result.note);
   const resultMail=await sendSystemMail(user.workspace_id,user.email,`Контур: ${dashboard.name}`,lines.join('\n'));if(resultMail.status!=='sent')throw new WorkError(503,'SMTP не настроен или недоступен');
   await rows('UPDATE dashboard_subscriptions SET last_sent_at=CURRENT_TIMESTAMP,last_error=NULL WHERE user_id=? AND dashboard_id=?',[fresh.user_id,fresh.dashboard_id]);
  }catch(e){await rows('UPDATE dashboard_subscriptions SET last_error=? WHERE user_id=? AND dashboard_id=?',[e instanceof WorkError?e.message:'Не удалось отправить отчёт; проверьте SMTP и журнал worker',subscription.user_id,subscription.dashboard_id]);}
  finally{await connection.query('SELECT RELEASE_LOCK(?)',[lockName]).catch(()=>{});connection.release();}
 }
}
