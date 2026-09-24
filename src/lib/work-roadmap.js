import {z} from 'zod';
import {one,rows,parseJson} from './db.js';
import {body,reply,visibleProjects,projectFor,WorkError} from './work-common.js';
import {planAccess} from './work-plans.js';
import {apiBackgroundAllowed} from './api-access.js';
import {planningApi} from './work-planning.js';
import {portfolioSchedule,dateRange} from './planning-math.js';
// Добавляет оценки только видимых планов к существующим резервам времени, используя рабочие дни календаря.
export function roadmapCapacity(capacity,items,schedule){
 const byId=new Map(schedule.tasks.map(t=>[t.id,t]));
 return capacity.people.map(person=>{const hours=new Map(capacity.dates.map(d=>[d,0]));for(const item of items){if(item.kind!=='planned'||Number(item.assignee_id)!==Number(person.id)||!item.estimate_minutes)continue;const dates=byId.get(item.id);if(!dates?.start_date||!dates?.due_date)continue;
   let period;try{period=dateRange(dates.start_date,dates.due_date);}catch{continue;}
   const calendar=parseJson(person.calendar?.hours_json,[0,8,8,8,8,8,0]),working=period.filter(day=>Number(calendar[new Date(`${day}T00:00:00Z`).getUTCDay()])>0);if(!working.length)continue;
   for(const day of working)if(hours.has(day))hours.set(day,hours.get(day)+Number(item.estimate_minutes)/60/working.length);
  }return {id:person.id,display_name:person.display_name,days:person.days.map(day=>{const proposed=Math.round((hours.get(day.date)||0)*100)/100;return {...day,proposed,total:Math.round((day.planned+proposed)*100)/100,overload:Math.max(0,Math.round((day.planned+proposed-day.available)*100)/100)};})};});
}
// Собирает рабочие карточки и доступные планы в одну карту; закрытые объекты отбрасываются до расчёта.
export async function roadmapApi(request,path,user){
 if(!(request.method==='GET'&&path.length===1||request.method==='POST'&&path[1]==='scenario'))throw new WorkError(404,'Метод карты не найден');
 const input=request.method==='POST'?z.object({shifts:z.record(z.string().regex(/^(project|plan):[1-9]\d*$/),z.number().int().min(-365).max(365)).refine(v=>Object.keys(v).length<=500)}).strict().parse(await body(request)):{shifts:{}};
 const groups=[],items=[],dependencies=[],taskAllowed=await apiBackgroundAllowed(user,user.api_token_id,'tasks:read')&&await apiBackgroundAllowed(user,user.api_token_id,'projects:read');
 if(taskAllowed){for(const p of await visibleProjects(user,'report.view')){try{await projectFor(user,p.id);}catch(e){if(e.status===403)continue;throw e;}let can_edit=true;try{await projectFor(user,p.id,'task.edit',true);}catch(e){if(![403,409].includes(e.status))throw e;can_edit=false;}groups.push({id:`project:${p.id}`,title:p.name,kind:'project'});const tasks=await rows('SELECT id,project_id,title,start_date,due_date,version_number,assignee_id,estimate_minutes FROM tasks WHERE project_id=? ORDER BY id LIMIT 2001',[p.id]);if(tasks.length>2000)throw new WorkError(422,'Для карты доступно не более 2000 задач одного проекта');items.push(...tasks.map(t=>({...t,can_edit,kind:'task',project_id:`project:${p.id}`,href:`/?task=${t.id}`})));}}
 const plans=await rows('SELECT * FROM work_plans WHERE workspace_id=? AND archived=FALSE ORDER BY id',[user.workspace_id]);
 const plannedIds=new Map();
 for(const plan of plans){try{await planAccess(user,plan);}catch(e){if([403,404].includes(e.status))continue;throw e;}let can_edit=true;try{await planAccess(user,plan,true);}catch(e){if(![403,409].includes(e.status))throw e;can_edit=false;}const group=plan.project_id?`project:${plan.project_id}`:`plan:${plan.id}`;
  if(!groups.some(g=>g.id===group))groups.push({id:group,title:plan.project_id?(await one('SELECT name FROM projects WHERE id=?',[plan.project_id])).name:plan.title,kind:plan.project_id?'project':'plan'});
  const planned=await rows("SELECT id,title,start_date,due_date,revision,assignee_id,estimate_minutes,state,task_id FROM work_plan_items WHERE plan_id=? AND state<>'cancelled' ORDER BY id",[plan.id]);
  for(const i of planned){plannedIds.set(i.id,i.state==='active'?Number(i.task_id):-Number(i.id));if(i.state==='planning')items.push({...i,can_edit,id:-Number(i.id),item_id:i.id,plan_id:plan.id,plan_title:plan.title,kind:'planned',project_id:group,href:`/?view=work&tab=plans&plan=${plan.id}`});}
  if(!planned.length)items.push({id:-1000000000000-Number(plan.id),kind:'initiative',can_edit,plan_id:plan.id,revision:plan.revision,project_id:group,title:plan.title,start_date:plan.start_date,due_date:plan.due_date,href:`/?view=work&tab=plans&plan=${plan.id}`});
  dependencies.push(...(await rows('SELECT * FROM work_plan_dependencies WHERE plan_id=?',[plan.id])).map(d=>({task_id:-Number(d.item_id),planned_parent:d.depends_on_item_id,depends_on_task_id:d.depends_on_task_id})));
 }
 if(items.length>5000)throw new WorkError(422,'Карта поддерживает до 5000 доступных карточек. Сократите объём активной работы');
 const ids=new Set(items.map(i=>Number(i.id))),working=items.filter(i=>i.kind==='task').map(i=>i.id);
 if(working.length)dependencies.push(...await rows(`SELECT task_id,depends_on_task_id FROM task_dependencies WHERE dependency_type='blocks' AND task_id IN (${working.map(()=>'?').join(',')})`,working));
 const edges=dependencies.map(d=>({task_id:d.task_id,depends_on_task_id:d.planned_parent?plannedIds.get(d.planned_parent):d.depends_on_task_id})).filter(d=>ids.has(Number(d.task_id))&&ids.has(Number(d.depends_on_task_id)));
 const shifts=Object.fromEntries(Object.entries(input.shifts).filter(([key])=>groups.some(g=>g.id===key))),schedule=portfolioSchedule(items,edges,shifts);
 let capacity=null;
 try{const start=new Date().toISOString().slice(0,10),end=new Date(Date.now()+13*86400000).toISOString().slice(0,10);
  if(await apiBackgroundAllowed(user,user.api_token_id,'projects:read')){const result=await planningApi(new Request(`https://kontur.local/api/work/capacity?start=${start}&end=${end}`),['capacity'],user),data=await result.json();capacity={dates:data.dates,people:roadmapCapacity(data,items,schedule)};}
 }catch(e){if(![403,404].includes(e.status))throw e;}
 return reply({groups,items,dependencies:edges,schedule,capacity,shifts});
}
