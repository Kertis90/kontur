export const METRICS={total:'Всего задач',open:'Открытые',done:'Выполненные',overdue:'Просроченные',estimate_hours:'Оценка в часах',sla_breached:'Задачи с нарушением SLA',sla_achieved:'Задачи с выполненным SLA',created:'Созданы за период',completed:'Завершены за период'};
export function formulaValue(expression,metrics){
 if(typeof expression!=='string'||expression.length>512)throw Error('Формула должна содержать от 1 до 512 символов');
 const tokens=expression.match(/\d+(?:\.\d+)?|[a-z_][a-z_0-9]*|[+\-*/()]|\S/g)||[];
 if(!tokens.length||tokens.length>128)throw Error('Слишком длинная или пустая формула');let at=0;
 const take=()=>tokens[at++];
 function atom(){const t=take();if(t==='-')return -atom();if(t==='+')return atom();if(t==='('){const value=sum();if(take()!==')')throw Error('Не закрыта скобка');return value;}if(/^\d+(\.\d+)?$/.test(t||''))return Number(t);if(Object.hasOwn(METRICS,t))return Number(metrics[t]||0);throw Error(`Неизвестный показатель или символ: ${String(t).slice(0,50)}`);}
 function product(){let value=atom();while(['*','/'].includes(tokens[at])){const op=take(),right=atom();value=op==='*'?value*right:right===0?NaN:value/right;}return value;}
 function sum(){let value=product();while(['+','-'].includes(tokens[at])){const op=take(),right=product();value=op==='+'?value+right:value-right;}return value;}
 const result=sum();if(at!==tokens.length)throw Error('Некорректная формула');return Number.isFinite(result)?result:null;
}
export const utcTime=value=>new Date(typeof value==='string'&&!value.endsWith('Z')&&!/[+-]\d\d:\d\d$/.test(value)?value.replace(' ','T')+'Z':value);
export const localDay=(date,timezone='UTC')=>new Intl.DateTimeFormat('sv-SE',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
export const shiftDay=(day,amount)=>new Date(Date.parse(`${day}T12:00:00Z`)+amount*86400000).toISOString().slice(0,10);
export function previousPeriod(period){const days=Math.round((Date.parse(period.to)-Date.parse(period.from))/86400000)+1;return {...period,from:shiftDay(period.from,-days),to:shiftDay(period.to,-days)};}
export function completionEvents(events){
 const state=new Map(),closed=[];
 for(const e of [...events].sort((a,b)=>utcTime(a.occurred_at)-utcTime(b.occurred_at)||a.id-b.id)){const before=state.get(Number(e.task_id));if(e.is_done&&!before&&e.source!=='baseline')closed.push(e);state.set(Number(e.task_id),Boolean(e.is_done));}
 return closed;
}
export function metricSnapshot(tasks,events,slas,period,now=new Date()){
 const ids=new Set(tasks.map(t=>Number(t.id))),today=localDay(now,period.timezone||'UTC');
 const inPeriod=value=>{const d=localDay(utcTime(value),period.timezone||'UTC');return d>=period.from&&d<=period.to;};
 const closed=new Set(completionEvents(events).filter(e=>ids.has(Number(e.task_id))&&inPeriod(e.occurred_at)).map(e=>Number(e.task_id)));
 return {total:tasks.length,open:tasks.filter(t=>!t.is_done).length,done:tasks.filter(t=>t.is_done).length,overdue:tasks.filter(t=>!t.is_done&&t.due_date&&t.due_date<today).length,estimate_hours:tasks.reduce((sum,t)=>sum+Number(t.estimate_minutes||0)/60,0),sla_breached:new Set(slas.filter(s=>ids.has(Number(s.task_id))&&s.status==='breached').map(s=>s.task_id)).size,sla_achieved:new Set(slas.filter(s=>ids.has(Number(s.task_id))&&s.status==='achieved').map(s=>s.task_id)).size,created:tasks.filter(t=>inPeriod(t.created_at)).length,completed:closed.size};
}
export function forecastCompletion(daily,remaining,{runs=2000,maxDays=730,random=Math.random}={}){
 if(!remaining)return {status:'complete',p50:0,p85:0,p95:0,samples:daily.length};
 if(daily.length<28||daily.reduce((a,b)=>a+b,0)<5)return {status:'insufficient',reason:'Нужно минимум 28 дней наблюдений и 5 завершённых задач'};
 const outcomes=[];let censored=0;
 for(let run=0;run<runs;run++){let completed=0,day=0;while(day<maxDays&&completed<remaining){const start=Math.min(daily.length-7,Math.floor(random()*(daily.length-6)));for(let i=0;i<7&&day<maxDays&&completed<remaining;i++){completed+=daily[start+i];day++;}}if(completed<remaining){outcomes.push(Infinity);censored++;}else outcomes.push(day);}
 outcomes.sort((a,b)=>a-b);const q=p=>{const value=outcomes[Math.ceil(outcomes.length*p)-1];return Number.isFinite(value)?value:null;};return {status:'forecast',p50:q(.5),p85:q(.85),p95:q(.95),censored_runs:censored,runs,samples:daily.length,completed:daily.reduce((a,b)=>a+b,0),remaining};
}
