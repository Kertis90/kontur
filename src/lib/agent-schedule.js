import {WorkError} from './work-common.js';
export function validAgentTimezone(zone){try{new Intl.DateTimeFormat('en',{timeZone:zone}).format();return true;}catch{return false;}}
export function nextAgentSchedule(trigger,after=new Date()){
 const cfg=trigger.schedule||{mode:'interval'};
 if(trigger.type!=='schedule')return null;
 if(cfg.mode==='interval')return new Date(after.getTime()+trigger.interval_minutes*60000);
 if(!validAgentTimezone(cfg.timezone))throw new WorkError(422,'Неизвестный часовой пояс');
 const fmt=new Intl.DateTimeFormat('en-CA',{timeZone:cfg.timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
 const parts=t=>Object.fromEntries(fmt.formatToParts(new Date(t)).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
 const offset=t=>{const p=parts(t);return Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute)-Math.floor(t/60000)*60000;};
 const current=parts(after.getTime()),[hour,minute]=cfg.time.split(':').map(Number);
 for(let day=0;day<9;day++){
  const local=new Date(Date.UTC(current.year,current.month-1,current.day+day,hour,minute));
  if(cfg.mode==='weekly'&&!cfg.weekdays.includes(local.getUTCDay()))continue;
  const seed=local.getTime(),possible=new Set([-24,-12,0,12,24].map(h=>seed-offset(seed+h*3600000)));
  const matches=[...possible].filter(t=>{const p=parts(t);return p.year===local.getUTCFullYear()&&p.month===local.getUTCMonth()+1&&p.day===local.getUTCDate()&&p.hour===hour&&p.minute===minute;}).sort((a,b)=>a-b);
  // A repeated wall-clock time runs once, at its earliest occurrence. A nonexistent time is skipped.
  if(matches.length&&matches[0]>after.getTime())return new Date(matches[0]);
 }throw new WorkError(422,'Не удалось вычислить следующее время запуска');
}
export const agentSqlDate=date=>date?date.toISOString().slice(0,19).replace('T',' '):null;
