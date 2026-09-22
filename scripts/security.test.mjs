import test from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { base32Encode,base32Decode,hotp,verifyTotp,secretHash } from '../src/lib/totp.js';
import { load } from './test-module-loader.mjs';
test('TOTP matches all SHA-1 reference vectors from RFC 6238',()=>{
 const secret=Buffer.from('12345678901234567890');for(const [seconds,expected]of [[59,'94287082'],[1111111109,'07081804'],[1111111111,'14050471'],[1234567890,'89005924'],[2000000000,'69279037'],[20000000000,'65353130']])assert.equal(hotp(secret,Math.floor(seconds/30),{digits:8}),expected);
 assert.equal(base32Encode(Buffer.from('foobar')),'MZXW6YTBOI');assert.equal(base32Decode('MZXW6YTBOI======').toString(),'foobar');
});
test('TOTP rejects replay, out-of-window codes, malformed input and empty secrets',()=>{
 const secret=base32Encode(Buffer.from('12345678901234567890')),now=1234567890000,counter=Math.floor(now/30000),code=hotp(secret,counter);
 assert.equal(verifyTotp(secret,code,{now}),counter);assert.equal(verifyTotp(secret,code,{now,lastCounter:counter}),null);
 assert.equal(verifyTotp(secret,hotp(secret,counter-4),{now}),null);assert.equal(verifyTotp(secret,'123',{now}),null);assert.equal(verifyTotp('',code,{now}),null);
});
test('a revoked server session invalidates an otherwise valid signed JWT',async()=>{
 const secret='test-secret-with-at-least-thirty-two-characters',token=await new SignJWT({workspaceId:'1',role:'owner'}).setProtectedHeader({alg:'HS256'}).setSubject('2').setJti('session').setExpirationTime('1h').sign(new TextEncoder().encode(secret));let active=false;
 const auth=await load('auth.js',{'session-store.js':{registerSession:async()=>'',liveSession:async()=>active?{id:'session',created_at:'2026-09-10 00:00:00',mfa_verified:1}:null},'work-directory.js':{externalAccount:async()=>null,synchronizeGroups:async()=>[]},'db.js':{one:async()=>({id:2,workspace_id:1,global_role:'viewer',status:'active'}),rows:async()=>[]}}, {AUTH_SECRET:secret});
 const request={headers:new Headers(),cookies:{get:()=>({value:token})}};assert.equal(await auth.currentUser(request),null);active=true;const user=await auth.currentUser(request);assert.equal(user.global_role,'viewer');assert.equal(user.mfa_verified,true);
});
test('invalid bearer credentials do not silently fall back to a browser session',async()=>{
 let cookieRead=false;const auth=await load('auth.js',{'db.js':{one:async()=>null},'session-store.js':{registerSession:async()=>'',liveSession:async()=>null},'work-directory.js':{externalAccount:async()=>null,synchronizeGroups:async()=>[]}});
 assert.equal(await auth.currentUser({headers:new Headers({authorization:'Bearer kw_invalid'}),cookies:{get:()=>{cookieRead=true;return {};}}}),null);assert.equal(cookieRead,false);
});
test('session issuance requires active account and completed second factor',async()=>{
 let factor=true,writes=0,active=true;const c={query:async sql=>{if(sql.startsWith('SELECT id FROM users'))return [active?[{id:2}]:[]];if(sql.startsWith('SELECT enabled'))return [[{enabled:factor}]];writes++;return [{affectedRows:1}];}};
 const module=await load('session-store.js',{'db.js':{transaction:fn=>fn(c)}});const user={id:2,workspace_id:1};
 await assert.rejects(module.registerSession(user,null,false),e=>e.status===401);assert.equal(writes,0);await module.registerSession(user,null,true);assert.equal(writes,1);active=false;await assert.rejects(module.registerSession(user,null,true),e=>e.status===401);assert.equal(writes,1);
});
test('recovery codes are consumed once and clear only the used hash',async()=>{
 const hashes=[secretHash('0123456789abcdef'),secretHash('fedcba9876543210')];const factor={user_id:2,secret_encrypted:'',recovery_hashes_json:hashes};
 const module=await load('work-security.js');const c={query:async(sql,args)=>{assert.ok(sql.includes('recovery_hashes_json'));factor.recovery_hashes_json=JSON.parse(args[0]);return [{affectedRows:1}];}};
 assert.equal(await module.checkFactor(c,factor,'0123-4567-89ab-cdef'),true);assert.equal(await module.checkFactor(c,factor,'0123456789abcdef'),false);assert.deepEqual(factor.recovery_hashes_json,[hashes[1]]);
});
test('MFA rate limit is shared across challenges for the same account',async()=>{
 let count=0;const module=await load('session-store.js',{'db.js':{rows:async()=>{count++;},one:async()=>({attempts:count})}});
 for(let i=0;i<8;i++)await module.consumeRate('mfa:2',{max:8});await assert.rejects(module.consumeRate('mfa:2',{max:8}),e=>e.status===429);assert.equal(count,9);
});
test('external login cannot turn a local administrator into an OIDC account',async()=>{
 let writes=0;const module=await load('work-directory.js',{'db.js':{transaction:fn=>fn({query:async sql=>{if(sql.startsWith('SELECT id FROM workspaces'))return [[{id:1}]];if(sql.startsWith('SELECT * FROM users'))return [[{id:2,auth_source:'local',global_role:'admin',email:'admin@example.test'}]];writes++;return [{}];}})}});
 await assert.rejects(module.externalAccount(1,'oidc','subject','admin@example.test','Admin','https://id.example.test'),e=>e.status===403);assert.equal(writes,0);
});
test('external identity may not switch issuer or take another account email',async()=>{
 const account={id:2,auth_source:'oidc',external_subject:'subject',external_issuer:'https://first.test'};const module=await load('work-directory.js',{'db.js':{transaction:fn=>fn({query:async sql=>sql.startsWith('SELECT id FROM workspaces')?[[{id:1}]]:[[account]]})}});
 await assert.rejects(module.externalAccount(1,'oidc','subject','a@example.test','A','https://second.test'),e=>e.status===403);
});
test('directory plan respects manual blocks and stops excessive removals',async()=>{
 const module=await load('work-directory.js'),config=module.directoryDefaults();const users=[{id:1,email:'a@example.test',display_name:'A',auth_source:'ldap',external_subject:'a',global_role:'member',status:'active'},{id:2,email:'b@example.test',auth_source:'ldap',external_subject:'b',status:'blocked',directory_disabled:0},{id:3,email:'c@example.test',auth_source:'ldap',external_subject:'c',status:'blocked',directory_disabled:1}];
 const plan=module.planDirectory([{subject:'b',email:'b@example.test',name:'B',active:true},{subject:'c',email:'c@example.test',name:'C',active:true}],users,config);
 assert.equal(plan.blocked,true);assert.equal(plan.counts.block,1);assert.equal(plan.changes.find(c=>c.user_id===2).action,'sync');assert.equal(plan.changes.find(c=>c.user_id===3).action,'reactivate');
});
test('malformed LDAP snapshots fail before any user is disabled',async()=>{
 const module=await load('work-directory.js'),config=module.directoryDefaults();assert.throws(()=>module.normalizeDirectoryEntries([{dn:'uid=a',mail:'not-an-email'}],config),e=>e.status===422);
 const raw={dn:'uid=a',mail:'a@example.test',displayName:'A',userAccountControl:'514',memberOf:['group-a']};assert.equal(module.normalizeDirectoryEntries([raw],config)[0].active,false);assert.throws(()=>module.normalizeDirectoryEntries([raw,raw],config),e=>e.status===422);
});
test('security methods reject API tokens before accessing session data',async()=>{
 const module=await load('work-security.js');await assert.rejects(module.securityApi(new Request('https://example.test/api/work/security/sessions'),['security','sessions'],{id:2,api_token_id:1}),e=>e.status===403);
});
test('delegated user management cannot elevate roles or reset an administrator password',async()=>{
 const {assertAccountChange}=await load('work-security.js');
 assert.throws(()=>assertAccountChange({id:2,global_role:'member'},null,{global_role:'admin'}),e=>e.status===403);
 assert.throws(()=>assertAccountChange({id:2,global_role:'member'},{id:1,global_role:'admin'},{password:'replacement'}),e=>e.status===403);
 assert.throws(()=>assertAccountChange({id:2,global_role:'admin'},{id:1,global_role:'owner'},{global_role:'member'},2),e=>e.status===403);
 assert.throws(()=>assertAccountChange({id:2,global_role:'admin'},{id:2,global_role:'admin',status:'active'},{global_role:'member'},1),e=>e.status===409);
 assert.doesNotThrow(()=>assertAccountChange({id:2,global_role:'admin'},{id:2,global_role:'admin',status:'active'},{global_role:'member'},2));
});
