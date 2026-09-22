import {capacityDays,dateRange} from './planning-math.js';
export const remainingHours=t=>Math.max(0,Number(t.estimate_minutes||0)*(1-Math.min(100,Math.max(0,Number(t.progress||0)))/100)/60);
export function suggestLeveling({people,tasks,calendars,absences,allocations,eligible,start,end,maxSuggestions=20}){
 const dates=dateRange(start,end),windowTasks=tasks.filter(t=>!t.is_done&&(!t.start_date||t.start_date<=end)),assignment=new Map(windowTasks.map(t=>[t.id,t.assignee_id])),available=new Map(),reserved=new Map();
 for(const person of people){const calendar=calendars.find(c=>Number(c.user_id)===Number(person.id)),hours=typeof calendar?.hours_json==='string'?JSON.parse(calendar.hours_json):calendar?.hours_json;available.set(person.id,capacityDays(person.id,dates,hours,absences,[]).reduce((s,d)=>s+d.available,0));const projects=new Set(allocations.filter(a=>a.user_id===person.id).map(a=>a.project_id));reserved.set(person.id,new Map([...projects].map(id=>[id,capacityDays(person.id,dates,hours,[],allocations.filter(a=>a.project_id===id)).reduce((s,d)=>s+d.planned,0)])));}
 function load(userId){const byProject=new Map();for(const t of windowTasks)if(assignment.get(t.id)===userId)byProject.set(t.project_id,(byProject.get(t.project_id)||0)+remainingHours(t));for(const [id,value]of reserved.get(userId)||[])byProject.set(id,Math.max(value,byProject.get(id)||0));return [...byProject.values()].reduce((s,n)=>s+n,0);}
 const pressure=id=>Math.max(0,load(id)-(available.get(id)||0));
 const initial=people.map(p=>({id:p.id,display_name:p.display_name,available_hours:available.get(p.id),planned_hours:Math.round(load(p.id)*100)/100,overload_hours:Math.round(pressure(p.id)*100)/100}));
 const proposals=[];
 for(const task of [...windowTasks].filter(t=>eligible[t.project_id]).sort((a,b)=>remainingHours(b)-remainingHours(a)||a.id-b.id)){
  if(proposals.length>=maxSuggestions)break;
  const from=assignment.get(task.id),hours=remainingHours(task);if(!from||!hours||!pressure(from))continue;
  let best=null;
  for(const to of eligible[task.project_id]){if(to===from||!available.has(to))continue;const before=pressure(from)+pressure(to),beforeTarget=load(to);assignment.set(task.id,to);const after=pressure(from)+pressure(to),score=before-after,targetLoad=load(to);assignment.set(task.id,from);if(score>.01&&targetLoad<=available.get(to)&&(!best||score>best.score||score===best.score&&beforeTarget<best.target_load))best={to,score,target_load:beforeTarget};}
  if(best){assignment.set(task.id,best.to);proposals.push({task_id:task.id,task_key:`${task.key_code}-${task.task_number}`,title:task.title,version_number:task.version_number,from_user_id:from,to_user_id:best.to,hours:Math.round(hours*100)/100,reduced_overload_hours:Math.round(best.score*100)/100});}
 }
 return {people:initial,proposals,unestimated_tasks:windowTasks.filter(t=>!t.estimate_minutes).length};
}
