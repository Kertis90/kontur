import {utc,zonedMinute,localParts} from './business-time.js';
import {WorkError} from './work-common.js';
const fail=()=>{throw new WorkError(422,'Календарь содержит неподдерживаемую или некорректную встречу');};
export const icalEscape=value=>String(value||'').replaceAll('\\','\\\\').replace(/\r?\n/g,'\\n').replaceAll(';','\\;').replaceAll(',','\\,').replaceAll('\r','');
const unescape=value=>value.replace(/\\([nN,;\\])/g,(_,char)=>/[nN]/.test(char)?'\n':char);
export function foldCalendarLine(value){let line='',bytes=0,result='';for(const char of value){const size=Buffer.byteLength(char);if(bytes+size>75){result+=line+'\r\n';line=' ';bytes=1;}line+=char;bytes+=size;}return result+line;}
const date=value=>new Date(utc(value)).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
export function calendarDocument(uid,snapshot,email){
 const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Kontur//Work Calendar//RU','CALSCALE:GREGORIAN','BEGIN:VEVENT',`UID:${uid}`,`DTSTAMP:${date(new Date())}`,`DTSTART:${date(snapshot.start)}`,`DTEND:${date(snapshot.end)}`,`SUMMARY:${icalEscape(snapshot.title)}`,`DESCRIPTION:${icalEscape(snapshot.description)}`,`STATUS:${snapshot.status==='cancelled'?'CANCELLED':'CONFIRMED'}`];
 if(email&&/^[^\s:;,<>\r\n]+@[^\s:;,<>\r\n]+$/.test(email))lines.push(`ATTENDEE;PARTSTAT=${{accepted:'ACCEPTED',declined:'DECLINED',pending:'NEEDS-ACTION'}[snapshot.response]||'NEEDS-ACTION'}:mailto:${email}`);
 return [...lines,'END:VEVENT','END:VCALENDAR'].map(foldCalendarLine).join('\r\n')+'\r\n';
}
export function calendarDate(value,params){
 const match=/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(value);if(!match)fail();
 const [,y,m,d,h,min,sec,z]=match,day=`${y}-${m}-${d}`,zone=params.TZID?.replace(/^"|"$/g,'')||'UTC';
 if(!z&&!params.TZID)fail();
 const stamp=z?Date.parse(`${day}T${h}:${min}:${sec}Z`):zonedMinute(day,Number(h)*60+Number(min),zone)+Number(sec)*1000;
 if(!Number.isFinite(stamp))fail();const p=localParts(stamp,z?'UTC':zone);
 if([p.year,p.month,p.day,p.hour,p.minute,p.second].join(':')!==[y,m,d,h,min,sec].map(Number).join(':'))fail();return new Date(stamp).toISOString();
}
export function parseCalendar(text,uid,email){
 if(Buffer.byteLength(text)>512000||text.includes('\0'))fail();
 const lines=text.replace(/\r?\n[ \t]/g,'').split(/\r?\n/),props={};let inside=false,count=0;
 for(const line of lines){if(line==='BEGIN:VEVENT'){if(inside||++count>1)fail();inside=true;continue;}if(line==='END:VEVENT'){inside=false;continue;}if(!inside)continue;
  if(line.startsWith('BEGIN:')||line.startsWith('END:'))fail();const index=line.indexOf(':');if(index<1)fail();
  const parts=line.slice(0,index).split(';'),key=parts.shift().toUpperCase(),params=Object.fromEntries(parts.map(p=>{const i=p.indexOf('=');return [p.slice(0,i).toUpperCase(),p.slice(i+1)];}));
  (props[key]||=[]).push({value:line.slice(index+1),params});
 }
 if(inside||count!==1||props.RRULE||props.RDATE||props['RECURRENCE-ID']||props.EXDATE)fail();
 for(const key of ['UID','DTSTART','DTEND','SUMMARY'])if(props[key]?.length!==1)fail();
 if(props.UID[0].value!==uid||props.DESCRIPTION?.length>1||props.STATUS?.length>1)fail();
 const own=(props.ATTENDEE||[]).filter(p=>p.value.toLowerCase()===`mailto:${email}`.toLowerCase());if(own.length>1)fail();
 const snapshot={title:unescape(props.SUMMARY[0].value),description:unescape(props.DESCRIPTION?.[0]?.value||''),start:calendarDate(props.DTSTART[0].value,props.DTSTART[0].params),end:calendarDate(props.DTEND[0].value,props.DTEND[0].params),status:props.STATUS?.[0]?.value==='CANCELLED'?'cancelled':'scheduled',response:{ACCEPTED:'accepted',DECLINED:'declined','NEEDS-ACTION':'pending'}[own[0]?.params.PARTSTAT]||'pending'};
 if(snapshot.title.length<2||snapshot.title.length>220||snapshot.description.length>1000||snapshot.end<=snapshot.start)fail();return snapshot;
}
