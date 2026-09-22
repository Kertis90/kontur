import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {load} from './test-module-loader.mjs';
const user={id:7,workspace_id:2,status:'active',session_id:'test-session'};
const env={WEB_PUSH_ENABLED:'true',WEB_PUSH_PUBLIC_KEY:'test-public',WEB_PUSH_PRIVATE_KEY:'test-private',WEB_PUSH_SUBJECT:'mailto:admin@example.test',AUTH_SECRET:'test-encryption-only'};
const ec=crypto.createECDH('prime256v1');ec.generateKeys();
const subscription={endpoint:'https://fcm.googleapis.com/fcm/send/test-device',keys:{p256dh:ec.getPublicKey().toString('base64url'),auth:Buffer.alloc(16,1).toString('base64url')}};
const personal={'work-personal.js':{localNotificationTime:()=>({quiet:false}),mayReadNotification:async()=>false}};
const request=(method,data)=>new Request('https://kontur.test/api/work/push',{method,...(data?{body:JSON.stringify(data)}:{})});

test('push is opt-in and exposes no VAPID private key',async()=>{
 const m=await load('browser-push.js',personal,env);
 assert.equal(m.pushConfig({}).enabled,false);
 assert.equal(m.pushConfig({...env,WEB_PUSH_PRIVATE_KEY:''}).enabled,false);
 const value=await (await m.browserPushApi(request('GET'),['push'],user)).json();
 assert.deepEqual(value,{configured:true,public_key:'test-public'});assert.ok(!JSON.stringify(value).includes('test-private'));
});
test('push subscriptions reject unsafe hosts, credentials, ports and invalid key lengths',async()=>{
 const m=await load('browser-push.js',personal);
 for(const value of ['http://fcm.googleapis.com/x','https://127.0.0.1/x','https://169.254.169.254/x','https://fcm.googleapis.com.evil.test/x','https://user:secret@fcm.googleapis.com/x','https://fcm.googleapis.com:444/x','https://web.push.apple.com/#secret','https://evil.test/x']) assert.throws(()=>m.safePushEndpoint(value),{status:422},value);
 for(const value of [subscription.endpoint,'https://updates.push.services.mozilla.com/wpush/v2/abc','https://web.push.apple.com/test','https://wns2.notify.windows.com/test']) assert.equal(m.safePushEndpoint(value),value);
 assert.ok(m.subscriptionSchema.parse(subscription));
 assert.throws(()=>m.subscriptionSchema.parse({...subscription,keys:{...subscription.keys,auth:'bad'}}));
 assert.throws(()=>m.subscriptionSchema.parse({...subscription,keys:{...subscription.keys,p256dh:Buffer.alloc(65).toString('base64url')}}));
});
test('personal API tokens and missing browser sessions cannot register devices',async()=>{
 const m=await load('browser-push.js',personal,env);
 for(const person of [{...user,api_token_id:4},{id:7,workspace_id:2}]) for(const method of ['GET','POST','DELETE']) await assert.rejects(()=>m.browserPushApi(request(method,method==='GET'?undefined:subscription),['push'],person),{status:403});
 const access=await load('api-access.js');assert.ok(access.apiRequestError({...user,api_token_id:1,api_enabled:true,scopes_json:['*'],allowed_scopes_json:['*']},request('POST',subscription)));
});
test('registration encrypts subscription, initializes cursors and limits devices',async()=>{
 let written,limit=0;
 const m=await load('browser-push.js',{...personal,'db.js':{transaction:async fn=>fn({query:async(sql,params)=>{
  if(sql.includes('FOR UPDATE'))return [[]];
  if(sql.includes('COUNT(*)'))return [[{total:limit}]];
  if(sql.includes('MAX(id)'))return [[{notification_id:18,message_id:900}]];
  assert.match(sql,/last_chat_message_id=IF\(user_id=VALUES\(user_id\)/);written=params;return [{affectedRows:1}];
 }})}},env);
 assert.equal((await m.browserPushApi(request('POST',subscription),['push'],user)).status,200);
 assert.equal(written[0],crypto.createHash('sha256').update(subscription.endpoint).digest('hex'));
 assert.deepEqual(Array.from(written).slice(1,4),[7,2,'test-session']);assert.equal(written[4].includes('test-device'),false);
 const cipher=await load('crypto.js',{},env);assert.deepEqual(JSON.parse(cipher.decryptSecret(written[4])),subscription);
 assert.deepEqual(Array.from(written).slice(5),[18,900]);
 limit=10;await assert.rejects(()=>m.browserPushApi(request('POST',subscription),['push'],user),{status:422});
});
test('unsubscribe only deletes the current user device',async()=>{
 let args;
 const m=await load('browser-push.js',{...personal,'db.js':{rows:async(sql,params)=>{assert.match(sql,/WHERE id=\? AND user_id=\?/);args=params;}}},env);
 await m.browserPushApi(request('DELETE',{endpoint:subscription.endpoint}),['push'],user);
 assert.equal(args[1],7);assert.equal(args[0],crypto.createHash('sha256').update(subscription.endpoint).digest('hex'));
});
test('push rechecks project rights, direct membership, own messages, deleted messages and read cursors',async()=>{
 let allowed=false;const seen=[];
 const m=await load('browser-push.js',{...personal,'permissions.js':{workspacePermissionSet:async()=>new Set(),projectPermissionSet:async(_,id)=>{seen.push(id);return new Set(allowed?['chat.use']:[]);}},'db.js':{one:async sql=>{assert.match(sql,/FROM chat_rooms/);return null;},rows:async sql=>sql.includes('user_notifications')?[]:[
  {id:11,channel_id:1,sender_id:7,member_id:7},
  {id:12,channel_id:1,sender_id:8,member_id:7,last_read_message_id:12},
  {id:13,channel_id:1,sender_id:8,member_id:7,deleted_at:'2026-09-21'},
  {id:14,channel_id:2,sender_id:8,member_id:null},
  {id:15,channel_id:3,sender_id:8,project_id:55,member_id:7},
  {id:16,channel_id:3,sender_id:8,project_id:55,member_id:7},
 ]}},env);
 const cursor={last_notification_id:0,last_chat_message_id:10};
 const denied=await m.pushItems(user,cursor);assert.equal(denied.notify,false);assert.equal(denied.messageId,16);assert.deepEqual(seen,[55]);
 allowed=true;const yes=await m.pushItems(user,cursor);assert.equal(yes.notify,true);assert.equal(yes.url,'/?view=chat&channel=3');
});
async function pollingFixture(options={}){
 const calls=[],sent=[];
 const m=await load('browser-push.js',{
  'work-personal.js':{localNotificationTime:()=>({quiet:Boolean(options.quiet)}),mayReadNotification:async()=>true},
  'crypto.js':{decryptSecret:()=>JSON.stringify(subscription),encryptSecret:v=>v},
  'web-push':{default:{sendNotification:async(...args)=>{sent.push(args);if(options.error)throw {statusCode:options.error};}}},
  'db.js':{
   rows:async(sql,params=[])=>{
    calls.push({sql,params});
    if(sql.startsWith('SELECT id FROM browser_push_subscriptions'))return [{id:'device'}];
    if(sql.startsWith('UPDATE browser_push_subscriptions SET lease_token')){assert.match(sql,/next_attempt_at<=CURRENT_TIMESTAMP/);return {affectedRows:options.claimed===false?0:1};}
    if(sql.includes('FROM user_notifications'))return [{id:20,read_at:null}];
    if(sql.includes('FROM chat_messages'))return [];
    return {affectedRows:1};
   },
   one:async sql=>{
    calls.push({sql});
    if(sql.includes('FROM browser_push_subscriptions'))return {id:'device',user_id:7,workspace_id:2,session_id:'test-session',last_notification_id:18,last_chat_message_id:30,subscription_encrypted:'encrypted'};
    if(sql.includes('JOIN user_sessions')){assert.match(sql,/s.revoked_at IS NULL AND s.expires_at>CURRENT_TIMESTAMP/);return options.revoked?null:user;}
    if(sql.includes('notification_preferences'))return {};
    throw new Error(sql);
   },
  },
 },options.disabled?{}:env);
 await m.pollBrowserPush();return {calls,sent};
}
test('push worker sends generic encrypted transport payload, then advances cursors under lease',async()=>{
 const {calls,sent}=await pollingFixture();assert.equal(sent.length,1);
 assert.deepEqual(JSON.parse(sent[0][1]),{title:'Контур',body:'Есть новые сообщения или уведомления',url:'/?notifications=1',tag:'kontur-7'});
 assert.equal(sent[0][2].timeout,8000);
 const update=calls.find(c=>c.sql.startsWith('UPDATE browser_push_subscriptions SET last_notification_id'));
 assert.deepEqual(Array.from(update.params).slice(0,2),[20,30]);assert.match(update.sql,/lease_token=\?/);
});
test('push skips disabled, revoked, quiet and already-claimed subscriptions',async()=>{
 const disabled=await pollingFixture({disabled:true});assert.equal(disabled.calls.length,0);
 for(const option of [{revoked:true},{quiet:true},{claimed:false}]){const f=await pollingFixture(option);assert.equal(f.sent.length,0);assert.equal(f.calls.some(c=>c.sql.startsWith('UPDATE browser_push_subscriptions SET last_notification_id')),false);}
 const revoked=await pollingFixture({revoked:true});assert.ok(revoked.calls.some(c=>c.sql.startsWith('DELETE FROM browser_push_subscriptions')));
});
test('expired endpoints are removed, transient failures retry without losing cursors',async()=>{
 for(const code of [404,410,503]){
  const {calls}=await pollingFixture({error:code});assert.equal(calls.some(c=>c.sql.startsWith('UPDATE browser_push_subscriptions SET last_notification_id')),false);
  assert.ok(calls.some(c=>code===503?c.sql.includes('failures=failures+1'):c.sql.startsWith('DELETE FROM browser_push_subscriptions')));
 }
});
