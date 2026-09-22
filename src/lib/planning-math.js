const DAY=86400000;
const stamp=d=>Date.parse(`${String(d).slice(0,10)}T00:00:00Z`);
export function dateRange(start,end) {
  const from=stamp(start),to=stamp(end);
  if (!Number.isFinite(from)||!Number.isFinite(to)||to<from||to-from>DAY*366) throw new Error("Период должен составлять от 1 до 367 дней");
  return Array.from({length:Math.round((to-from)/DAY)+1},(_,i)=>new Date(from+i*DAY).toISOString().slice(0,10));
}
export function capacityDays(userId, dates, calendar, absences, allocations) {
  const hours=calendar || [0,8,8,8,8,8,0];
  return dates.map(date=>{
    const regular=Number(hours[new Date(`${date}T00:00:00Z`).getUTCDay()]||0);
    const off=Math.max(0,...absences.filter(a=>(!a.user_id||Number(a.user_id)===Number(userId))&&a.start_date<=date&&a.end_date>=date).map(a=>Number(a.unavailable_percent)));
    const available=Math.round(regular*(1-off/100)*100)/100;
    const planned=allocations.filter(a=>Number(a.user_id)===Number(userId)&&a.start_date<=date&&a.end_date>=date).reduce((n,a)=>n+(regular>0?Number(a.hours_per_day):0),0);
    return {date,available,planned,overload:Math.max(0,planned-available)};
  });
}
export function portfolioSchedule(tasks,dependencies,shifts={}) {
  const map=new Map(tasks.map(t=>[Number(t.id),t]));
  const parents=new Map(tasks.map(t=>[Number(t.id),[]]));
  for (const edge of dependencies) if(map.has(Number(edge.task_id))&&map.has(Number(edge.depends_on_task_id))) parents.get(Number(edge.task_id)).push(Number(edge.depends_on_task_id));
  const visiting=new Set(),computed=new Map(),cycles=new Set();
  function visit(id){
    if(computed.has(id)) return computed.get(id);
    if(visiting.has(id)){cycles.add(id);return null;}
    visiting.add(id);
    const task=map.get(id),valid=task.start_date&&task.due_date;
    let start=valid?stamp(task.start_date)+Number(shifts[task.project_id]||0)*DAY:null;
    const duration=valid?Math.max(1,Math.round((stamp(task.due_date)-stamp(task.start_date))/DAY)+1):null;
    let predecessor=null,chain=0;
    for(const parentId of parents.get(id)){
      const parent=visit(parentId);
      if(!parent||parent.cycle){cycles.add(id);continue;}
      if(start!==null&&parent.end!==null&&parent.end+DAY>start){start=parent.end+DAY;predecessor=parentId;}
      if(parent.chain>chain) chain=parent.chain;
    }
    const result={id,project_id:task.project_id,start,end:start===null?null:start+(duration-1)*DAY,duration,chain:chain+(duration||0),predecessor,cycle:cycles.has(id)};
    visiting.delete(id);computed.set(id,result);return result;
  }
  tasks.forEach(t=>visit(Number(t.id)));
  const scheduled=[...computed.values()];
  const finish=Math.max(0,...scheduled.filter(x=>!x.cycle&&x.end!==null).map(x=>x.end));
  const successors=new Map(tasks.map(t=>[Number(t.id),[]]));for(const [child,values]of parents)for(const parent of values)successors.get(parent).push(child);
  const latest=new Map(),backtracking=new Set();
  function backward(id){
    if(latest.has(id))return latest.get(id);
    const task=computed.get(id);if(task.cycle||task.start===null||backtracking.has(id))return null;
    backtracking.add(id);const children=successors.get(id).map(backward).filter(Boolean);
    const end=children.length?Math.min(...children.map(x=>x.start-DAY)):finish;
    const result={start:end-(task.duration-1)*DAY,end};latest.set(id,result);backtracking.delete(id);return result;
  }
  scheduled.forEach(t=>backward(t.id));
  return {cycle:cycles.size>0,tasks:scheduled.map(x=>({...x,start_date:x.start===null?null:new Date(x.start).toISOString().slice(0,10),due_date:x.end===null?null:new Date(x.end).toISOString().slice(0,10),slack_days:latest.has(x.id)?Math.round((latest.get(x.id).start-x.start)/DAY):null,critical:latest.has(x.id)&&latest.get(x.id).start===x.start}))};
}
