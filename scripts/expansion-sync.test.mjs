import test from 'node:test';
import assert from 'node:assert/strict';
import {load} from './test-module-loader.mjs';

test('SLA notifications respect pauses, warning threshold, breach and business-time escalation',async()=>{
 const m=await load('sla-notifications.js'),config={enabled:true,warning:true,breached:true,escalation_minutes:30};
 assert.equal(m.slaNoticeTypes({phase:'paused',status:'breached',elapsed_minutes:1000,goal_minutes:10},config).length,0);
 assert.equal(m.slaNoticeTypes({phase:'completed',status:'breached'},config).length,0);
 assert.deepEqual(Array.from(m.slaNoticeTypes({phase:'running',status:'warning'},config)),['sla.warning']);
 assert.deepEqual(Array.from(m.slaNoticeTypes({phase:'running',status:'breached',elapsed_minutes:125,goal_minutes:100},config)),['sla.breached']);
 assert.deepEqual(Array.from(m.slaNoticeTypes({phase:'running',status:'breached',elapsed_minutes:130,goal_minutes:100},config)),['sla.breached','sla.escalated']);
 assert.equal(m.slaNoticeTypes({phase:'running',status:'warning'},{...config,enabled:false}).length,0);
});
test('integration automation requires a concrete project and the explicit send permission',async()=>{
 let allowed=false;
 const m=await load('automation-integrations.js',{'work-common.js':{workspaceFor:async()=>{if(!allowed)throw Object.assign(new Error('Denied'),{status:403});},projectFor:async()=>{},WorkError:class extends Error{constructor(status,message){super(message);this.status=status;}}},'db.js':{one:async()=>({id:1,project_id:2,enabled:true})}});
 await assert.rejects(()=>m.validateAutomationIntegrations({},{project_id:2,actions:[{type:'integration_send',connection_id:1}]}),{status:403});
 allowed=true;await assert.rejects(()=>m.validateAutomationIntegrations({},{project_id:null,actions:[{type:'integration_send',connection_id:1}]}),{status:422});
 await assert.rejects(()=>m.automationConnection({},1,3),{status:422});
 await m.validateAutomationIntegrations({},{project_id:2,actions:[{type:'branch',then:[{type:'integration_send',connection_id:1}],else:[]}]});
});
test('automation integration queues in the caller transaction and does not perform network I/O',async()=>{
 const calls=[];const m=await load('automation-integrations.js',{'work-common.js':{workspaceFor:async()=>{},projectFor:async()=>{},WorkError:Error},'db.js':{one:async()=>({id:1,project_id:2,enabled:true,version_number:3})}});
 const result=await m.queueAutomationIntegration({connection_id:1},{project_id:2,task_id:9},{id:7},{query:async(...args)=>calls.push(args)});
 assert.equal(result.status,'queued');assert.equal(calls.length,1);assert.ok(calls[0][0].includes("'automation.notification'"));assert.equal(calls[0][1].at(-1),3);
});
test('CalDAV format round-trips Russian text, Unicode folds, escaped punctuation and RSVP',async()=>{
 const m=await load('calendar-format.js'),snapshot={title:'Обсуждение проекта '.repeat(8),description:'Первая строка; запятая, слэш \\ \nВторая строка',start:'2026-09-16T10:00:00.000Z',end:'2026-09-16T11:00:00.000Z',status:'scheduled',response:'accepted'};
 const document=m.calendarDocument('kontur-1-test',snapshot,'user@example.ru');for(const line of document.split('\r\n'))assert.ok(Buffer.byteLength(line)<=75);
 assert.deepEqual(JSON.parse(JSON.stringify(m.parseCalendar(document,'kontur-1-test','user@example.ru'))),snapshot);
 assert.throws(()=>m.parseCalendar(document,'wrong-uid','user@example.ru'));
 assert.throws(()=>m.parseCalendar(document.replace('END:VEVENT','RRULE:FREQ=DAILY\r\nEND:VEVENT'),'kontur-1-test','user@example.ru'));
});
test('calendar dates honor TZID and reject invalid dates and floating times',async()=>{
 const m=await load('calendar-format.js');assert.equal(m.calendarDate('20260916T130000',{TZID:'Europe/Moscow'}),'2026-09-16T10:00:00.000Z');
 assert.throws(()=>m.calendarDate('20260230T130000Z',{}));assert.throws(()=>m.calendarDate('20260916T130000',{}));
});
test('sync uses a three-way comparison and does not overwrite simultaneous changes',async()=>{
 const m=await load('external-sync-model.js'),a={title:'A'},b={title:'B'},c={title:'C'},baseline={local:a,remote:a};
 assert.equal(m.syncDecision(null,a,null),'push');assert.equal(m.syncDecision(null,a,b),'conflict');assert.equal(m.syncDecision(baseline,b,a),'push');assert.equal(m.syncDecision(baseline,a,b),'pull');assert.equal(m.syncDecision(baseline,b,c),'conflict');assert.equal(m.syncDecision(baseline,b,b),'equal');assert.equal(m.syncDecision(baseline,a,null),'conflict');
 assert.throws(()=>m.safeExternalKey('gitlab','../admin'));assert.throws(()=>m.safeExternalKey('caldav','https://evil.test'));
});
test('remote conflict is encrypted and requires a matching revision without applying data',async()=>{
 let mutation=0;const m=await load('external-sync.js',{'external-sync-drivers.js':{syncLocal:async()=>({snapshot:{title:'Local'}}),syncRemote:async()=>({snapshot:{title:'Remote'}}),pushExternal:async()=>{mutation++;},pullExternal:async()=>{mutation++;}},'crypto.js':{encryptSecret:value=>'encrypted:'+value,decryptSecret:value=>value},'db.js':{rows:async(sql,args)=>{assert.ok(sql.includes("status='conflict'"));assert.ok(args[0].startsWith('encrypted:'));assert.equal(args.at(-1),3);}}});
 assert.equal(await m.syncOneBinding({},{id:1,revision:3},{},{}),'conflict');assert.equal(mutation,0);
});
test('CalDAV uses conditional PUT and refuses to overwrite an event without ETag',async()=>{
 const calls=[];const snapshot={title:'Тестовая встреча',description:'',start:'2026-09-16T10:00:00.000Z',end:'2026-09-16T11:00:00.000Z',status:'scheduled',response:'pending'};
 const m=await load('external-sync-drivers.js',{'work-tasks.js':{changeTask:async()=>{throw new Error('Unexpected task change');}},'recordings.js':{recordingConferenceAccess:async()=>({id:9,project_id:2,title:snapshot.title,description:'',scheduled_start:snapshot.start,scheduled_end:snapshot.end,status:'scheduled'})},'work-common.js':{workspaceFor:async()=>{},projectFor:async()=>{},WorkError:class extends Error{constructor(status,msg){super(msg);this.status=status;}}},'integration-http.js':{integrationUrl:v=>new URL(v),integrationRequest:async(url,options)=>{calls.push({url,options});return {status:412,headers:{}};}},'db.js':{one:async sql=>sql.includes('conference_participants')?{response:'pending'}:{id:7,workspace_id:1,email:'a@example.ru'}}});
 const connection={id:1,kind:'caldav',lease_token:'lease'},binding={entity_id:9,external_key:'kontur-1-test'},cred={url:'https://calendar.example.ru/users/me',username:'me',password:'secret'};
 await assert.rejects(()=>m.pushExternal(connection,binding,cred,{id:7,workspace_id:1,email:'a@example.ru'},{snapshot},{snapshot,etag:null}),{syncCode:'ETAG_REQUIRED'});assert.equal(calls.length,0);
 await assert.rejects(()=>m.pushExternal(connection,binding,cred,{id:7,workspace_id:1,email:'a@example.ru'},{snapshot},{snapshot,etag:'"v1"'}),{syncCode:'REMOTE_CHANGED'});assert.equal(calls[0].options.headers['if-match'],'"v1"');assert.equal(calls[0].options.method,'PUT');
});
