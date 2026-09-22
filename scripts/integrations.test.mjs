import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {load} from './test-module-loader.mjs';

const user={id:7,workspace_id:1,global_role:'member',status:'active'};
const connection={id:3,workspace_id:1,project_id:2,provider:'telegram',name:'Команда',destination_label:'Telegram · -1001',enabled:1,version_number:2,created_by:7,config_json:{chat_id:'-1001'},event_types_json:['task.created']};
const credentials={token:'123456:abcdefghijklmnopqrstuvwxyz123456'};
const perms=(keys=['integration.view','integration.manage','integration.logs','integration.test'],project=true)=>({workspacePermissionSet:async()=>new Set(keys),projectPermissionSet:async()=>new Set(project?['project.browse','project.admin']:[])});
const request=(url,method='GET',data)=>new Request(`https://kontur.example/api/work/${url}`,{method,...(data?{body:JSON.stringify(data)}:{})});

test('network policy denies private, loopback, metadata, mapped IPv6 and non-global ranges',async()=>{
 const m=await load('integration-http.js');
 for(const address of ['127.0.0.1','0.0.0.0','10.0.0.1','172.16.0.1','192.168.1.1','169.254.169.254','100.64.0.1','224.0.0.1','::1','::ffff:127.0.0.1','::ffff:8.8.8.8','fe80::1','fd00::1','2001:db8::1','2002:7f00:1::'])assert.equal(m.addressAllowed(address),false,address);
 assert.equal(m.addressAllowed('8.8.8.8'),true);assert.equal(m.addressAllowed('2606:4700:4700::1111'),true);
 assert.equal(m.addressAllowed('10.0.0.1',true),true);assert.equal(m.addressAllowed('fd00::1',true),true);assert.equal(m.addressAllowed('169.254.169.254',true),false);assert.equal(m.addressAllowed('127.0.0.1',true),false);
 for(const url of ['http://example.com','https://user:pass@example.com','https://example.com/#secret'])assert.throws(()=>m.integrationUrl(url));
});
test('DNS checks every answer and pins only the resolved address; private exception is exact hostname',async()=>{
 const m=await load('integration-http.js',{}, {INTEGRATION_ALLOWED_PRIVATE_HOSTS:'chat.internal'});
 await assert.rejects(()=>m.pinnedDestination(new URL('https://example.com'),async()=>[{address:'8.8.8.8',family:4},{address:'127.0.0.1',family:4}]),{code:'ADDRESS_BLOCKED'});
 const pin=await m.pinnedDestination(new URL('https://chat.internal'),async()=>[{address:'10.1.2.3',family:4}]);assert.equal(pin.address,'10.1.2.3');
 await assert.rejects(()=>m.pinnedDestination(new URL('https://evil.chat.internal'),async()=>[{address:'10.1.2.3',family:4}]),{code:'ADDRESS_BLOCKED'});
});
test('credentials enforce providers, HTTPS and redact stored secrets',async()=>{
 const a=await load('integration-adapters.js');
 assert.throws(()=>a.validateIntegrationCredentials('slack',{url:'https://evil.test/services/a/b/c'}));
 assert.throws(()=>a.validateIntegrationCredentials('mattermost',{url:'https://chat.test/api/users'}));
 assert.throws(()=>a.validateIntegrationCredentials('telegram',{token:'bad'}, {chat_id:'1'}));
 assert.throws(()=>a.validateIntegrationCredentials('webhook',{url:'https://hook.test',secret:'short'}));
 const checked=a.validateIntegrationCredentials('mattermost',{url:'https://chat.test/hooks/secretVALUE'});assert.equal(checked.label,'https://chat.test');
 const api=await load('work-integrations.js');const safe=api.publicIntegration({...connection,credentials_encrypted:'secret',config_json:'{"chat_id":"-1001"}'});assert.equal(safe.credentials_encrypted,undefined);assert.equal(safe.config.chat_id,'-1001');
});
test('connector bodies avoid unintended mentions and webhook signature covers exact bytes',async()=>{
 const a=await load('integration-adapters.js'),envelope={id:'event-1',type:'task.created',data:{key:'P-1',title:'@channel <!here> [x](https://evil)'}};
 const telegram=a.adapterRequest('telegram',credentials,{chat_id:'-123',message_thread_id:5},envelope);const tg=JSON.parse(telegram.body);assert.equal(tg.message_thread_id,5);assert.equal(tg.parse_mode,undefined);assert.equal(tg.chat_id,'-123');
 const slack=JSON.parse(a.adapterRequest('slack',{url:'https://hooks.slack.com/services/a/b/c'},{},envelope).body);assert.equal(slack.mrkdwn,false);assert.equal(slack.link_names,false);assert.ok(!slack.text.includes('<!here>'));
 const mm=JSON.parse(a.adapterRequest('mattermost',{url:'https://chat.test/hooks/key'},{},envelope).body);assert.ok(!mm.text.includes('@channel'));assert.ok(!mm.text.includes('[x]('));
 const hook=a.adapterRequest('webhook',{url:'https://hook.test',secret:'secret-for-signing'},{},envelope);assert.equal(hook.headers['x-kontur-signature-256'],`sha256=${crypto.createHmac('sha256','secret-for-signing').update(hook.body).digest('hex')}`);assert.equal(hook.headers['x-kontur-delivery'],'event-1');
});
test('adapter distinguishes acknowledged responses, permanent errors and retry-after',async()=>{
 const a=await load('integration-adapters.js');
 assert.equal(a.adapterResult('telegram',{status:200,text:'{"ok":true}',headers:{}}).ok,true);
 assert.equal(a.adapterResult('telegram',{status:200,text:'oops',headers:{}}).ok,false);
 const limit=a.adapterResult('telegram',{status:429,text:'{"ok":false,"parameters":{"retry_after":120}}',headers:{}});assert.equal(limit.retryAfter,120);assert.equal(limit.retryable,true);
 assert.equal(a.adapterResult('slack',{status:403,text:'invalid_token',headers:{}}).retryable,false);
 assert.equal(a.adapterResult('mattermost',{status:200,text:'ok',headers:{}}).ok,true);
 assert.equal(a.adapterResult('webhook',{status:302,text:'',headers:{location:'https://evil.test'}}).retryable,false);
});
test('API scopes separate read, configuration and sending; defaults do not silently grant new scopes',async()=>{
 const a=await load('api-access.js');for(const scope of ['integrations:read','integrations:write','integrations:send'])assert.ok(!a.DEFAULT_API_SCOPES.includes(scope));
 const token={api_token_id:1,api_enabled:true,scopes_json:['integrations:read'],allowed_scopes_json:['integrations:read','integrations:write','integrations:send']};
 assert.equal(a.apiRequestError(token,request('integrations')),null);
 assert.ok(a.apiRequestError(token,request('integrations/3/test','POST')));
 assert.ok(a.apiRequestError(token,request('integrations/3','PUT')));
 token.scopes_json=['integrations:send'];assert.equal(a.apiRequestError(token,request('integrations/3/test','POST')),null);assert.ok(a.apiRequestError(token,request('integrations/3','PUT')));
});
test('API rejects unauthorized workspace access before querying connections',async()=>{
 const a=await load('work-integrations.js',{'permissions.js':perms([])});
 await assert.rejects(()=>a.integrationsApi(request('integrations'),['integrations'],user),{status:403});
});
test('API filters projects and returns neither tokens nor secret URLs',async()=>{
 const a=await load('work-integrations.js',{'permissions.js':perms(), 'db.js':{rows:async(sql,params)=>{
  if(sql.startsWith('SELECT * FROM projects'))return [{id:2,workspace_id:1}];
  assert.ok(sql.includes('project_id IN'));assert.deepEqual(Array.from(params),[1,2]);return [connection];
 }}});
 const result=await (await a.integrationsApi(request('integrations'),['integrations'],user)).json();assert.equal(result.connections.length,1);assert.ok(!JSON.stringify(result).includes(credentials.token));
});
test('API blocks other-workspace IDs and project access, even with integration.manage',async()=>{
 const db={one:async sql=>sql.includes('integration_connections')?connection:{id:2,workspace_id:1,status:'active'}};
 let a=await load('work-integrations.js',{'permissions.js':perms(), 'db.js':{one:async()=>null}});
 await assert.rejects(()=>a.integrationsApi(request('integrations/3/deliveries'),['integrations','3','deliveries'],user),{status:404});
 a=await load('work-integrations.js',{'permissions.js':perms(undefined,false),'db.js':db});
 await assert.rejects(()=>a.integrationsApi(request('integrations/3/deliveries'),['integrations','3','deliveries'],user),{status:403});
});
test('log access and test sending require their own feature grants',async()=>{
 const a=await load('work-integrations.js',{'permissions.js':perms(['integration.manage']), 'db.js':{one:async sql=>sql.includes('integration_connections')?connection:{id:2,workspace_id:1,status:'active'}}});
 await assert.rejects(()=>a.integrationsApi(request('integrations/3/deliveries'),['integrations','3','deliveries'],user),{status:403});
 await assert.rejects(()=>a.integrationsApi(request('integrations/3/test','POST',{version_number:2}),['integrations','3','test'],user),{status:403});
});
test('configuration update checks version before canceling or mutating anything',async()=>{
 let mutation=false;
 const a=await load('work-integrations.js',{'permissions.js':perms(),'db.js':{one:async sql=>sql.includes('integration_connections')?connection:{id:2,workspace_id:1,status:'active'},transaction:async f=>f({query:async(sql)=>{if(sql.startsWith('SELECT version_number'))return [[{version_number:3}]];mutation=true;throw Error('Unexpected');}})}});
 await assert.rejects(()=>a.integrationsApi(request('integrations/3','PATCH',{version_number:2,enabled:false}),['integrations','3'],user),{status:409});assert.equal(mutation,false);
});
test('test request is durable, synthetic and rate limited under connection lock',async()=>{
 const sqls=[];let recent=false;
 const a=await load('work-integrations.js',{'permissions.js':perms(),'db.js':{one:async sql=>sql.includes('integration_connections')?connection:{id:2,workspace_id:1,status:'active'},transaction:async f=>f({query:async(sql,params)=>{sqls.push({sql,params});if(sql.startsWith('SELECT * FROM integration_connections'))return [[connection]];if(sql.startsWith('SELECT id FROM integration_deliveries'))return [recent?[{id:'1'}]:[]];return [{affectedRows:1}];}})}});
 const result=await a.integrationsApi(request('integrations/3/test','POST',{version_number:2}),['integrations','3','test'],user);assert.equal(result.status,202);assert.ok(sqls[0].sql.includes('FOR UPDATE'));assert.ok(sqls.at(-1).sql.includes("'integration.test'"));assert.ok(!sqls.at(-1).sql.includes('task_id'));
 await assert.rejects(()=>a.integrationsApi(request('integrations/3/test','POST',{version_number:1}),['integrations','3','test'],user),{status:409});
 recent=true;await assert.rejects(()=>a.integrationsApi(request('integrations/3/test','POST',{version_number:2}),['integrations','3','test'],user),{status:429});
});

async function deliveryFixture({enabled=true,version=2,allowed=true,task=true,sendResult={ok:true,status:200},sendError=null,attempts=0,snapshot=null,claim=true}={}){
 const changes=[];let sends=0;
 const delivery={id:'delivery-1',connection_id:3,connection_version:2,event_uuid:'event-1',event_type:'task.created',task_id:5,attempts,created_at:'2026-09-15 10:00:00',payload_encrypted:snapshot?JSON.stringify(snapshot):null};
 const m=await load('integration-delivery.js',{
  'integration-health.js':{updateIntegrationHealth:async()=>{}},
  'crypto.js':{decryptSecret:value=>value,encryptSecret:value=>value},
  'work-common.js':{workspaceFor:async()=>{if(!allowed)throw Object.assign(new Error('Forbidden'),{status:403});},projectFor:async()=>({id:2})},
  'integration-adapters.js':{validateIntegrationCredentials:()=>({credentials,config:{}}),integrationEnvelope:(d,t)=>({id:d.event_uuid,data:{title:t.title}}),sendIntegration:async(_p,_cred,_config,envelope)=>{sends++;changes.push({envelope});if(sendError)throw sendError;return sendResult;}},
  'db.js':{one:async(sql)=>{
   if(sql.includes('FROM integration_deliveries'))return delivery;
   if(sql.includes('FROM integration_connections'))return {...connection,enabled,version_number:version,credentials_encrypted:JSON.stringify(credentials)};
   if(sql.includes('FROM users'))return user;
   if(sql.includes('FROM tasks'))return task?{id:5,project_id:2,title:'Current title'}:null;
   throw Error(sql);
  },rows:async(sql,params)=>{changes.push({sql,params});if(sql.startsWith("UPDATE integration_deliveries SET status='running'")){delivery.lease_token=params[0];delivery.attempts++;return {affectedRows:claim?1:0};}return {affectedRows:1};}}
 });return {m,changes,sends:()=>sends};
}
test('claim prevents concurrent workers from sending the same pending job',async()=>{const f=await deliveryFixture({claim:false});assert.equal((await f.m.processIntegrationDelivery('delivery-1')).skipped,true);assert.equal(f.sends(),0);});
test('sender cancels disabled/version-changed connections, revoked access and unavailable tasks before network',async()=>{
 for(const opts of [{enabled:false},{version:3},{allowed:false},{task:false}]){const f=await deliveryFixture(opts);assert.equal((await f.m.processIntegrationDelivery('delivery-1')).cancelled,true);assert.equal(f.sends(),0);assert.ok(f.changes.some(c=>c.sql?.includes("status='cancelled'")));}
});
test('successful send persists an encrypted snapshot and finalizes with its lease token',async()=>{
 const f=await deliveryFixture();assert.equal((await f.m.processIntegrationDelivery('delivery-1')).status,'delivered');assert.equal(f.sends(),1);
 assert.ok(f.changes.some(c=>c.sql?.includes('SET payload_encrypted=')));assert.ok(f.changes.at(-1).sql.includes('AND lease_token=?'));assert.equal(f.changes.at(-1).params[2],null);
});
test('retry reuses the first payload rather than changing bytes for an existing event ID',async()=>{
 const f=await deliveryFixture({snapshot:{id:'event-1',data:{title:'Original title'}}});await f.m.processIntegrationDelivery('delivery-1');assert.equal(f.changes.find(c=>c.envelope).envelope.data.title,'Original title');assert.ok(!f.changes.some(c=>c.sql?.includes('SET payload_encrypted=')));
});
test('temporary errors retry with delay, permanent errors stop, fifth failure becomes terminal',async()=>{
 for(const [opts,expected] of [[{sendResult:{ok:false,status:429,code:'RATE_LIMIT',retryable:true,retryAfter:600}},'pending'],[{sendResult:{ok:false,status:403,code:'HTTP_ERROR',retryable:false}},'failed'],[{attempts:4,sendResult:{ok:false,status:500,code:'HTTP_ERROR',retryable:true}},'failed']]){const f=await deliveryFixture(opts);assert.equal((await f.m.processIntegrationDelivery('delivery-1')).status,expected);if(expected==='pending')assert.equal(f.changes.at(-1).params[3],600);}
});
test('transport failures do not persist secret URLs or provider response bodies in errors',async()=>{
 const f=await deliveryFixture({sendError:new Error('https://example.com/hooks/SECRET_TOKEN')});assert.equal((await f.m.processIntegrationDelivery('delivery-1')).status,'pending');assert.ok(!JSON.stringify(f.changes).includes('SECRET_TOKEN'));assert.equal(f.changes.at(-1).params[2],'NETWORK_ERROR');
});
test('outbox fanout filters subscriptions and relies on a unique event key for deduplication',async()=>{
 const queries=[];const m=await load('integration-delivery.js',{'db.js':{rows:async(sql,params)=>{queries.push({sql,params});return sql.startsWith('SELECT')?[{id:3,version_number:1,event_types_json:['task.created']},{id:4,version_number:1,event_types_json:['comment.created']}]:{affectedRows:1};}}});
 assert.equal(await m.enqueueIntegrationEvent({event_uuid:crypto.randomUUID(),workspace_id:1,event_type:'task.created',created_at:'2026-09-15 10:00:00',payload_json:{project_id:2,task_id:5,secret:'must not be stored'}}),1);
 assert.ok(queries[0].sql.includes('updated_at<=?'));assert.ok(queries[1].sql.includes('ON DUPLICATE KEY'));assert.ok(!JSON.stringify(queries).includes('must not be stored'));
 assert.equal(await m.enqueueIntegrationEvent({event_type:'telephony.call.completed'}),0);
});
