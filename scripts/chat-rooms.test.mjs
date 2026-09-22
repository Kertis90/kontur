import test from 'node:test';
import assert from 'node:assert/strict';
import {load} from './test-module-loader.mjs';
const user={id:7,workspace_id:1},room={id:9,workspace_id:1,project_id:null,name:'Комната',created_by:8,join_policy:'workspace',description:'',archived:0,revision:1,member_count:0,member_id:null,invited_id:null};
const req=(method,data)=>new Request('https://test/api/chat/rooms',{method,...(data?{body:JSON.stringify(data)}:{})});
async function fixture(options={}){
 const calls=[],value={...room,...options.room},rights=new Set(options.rights||['chat.room.join','chat.room.create']);const common=await load('work-common.js');
 const permit=async(_,key)=>{if(!rights.has(key))throw new common.WorkError(403,'Denied');};
 const m=await load('chat-rooms.js',{
  'permissions.js':{workspacePermissionSet:async()=>rights},
  'work-common.js':{...common,workspaceFor:permit,projectFor:async(_u,id,_perm,write)=>{if(options.projectDenied)throw new common.WorkError(403,'Project denied');if(options.projectArchived&&write)throw new common.WorkError(409,'Archived');return {id};},validUsers:async()=>{}},
  'db.js':{
   one:async(sql,p)=>{calls.push({sql,p});if(sql.includes('FROM chat_rooms r'))return value;if(sql.includes('SELECT * FROM chat_rooms'))return options.legacy?null:value;if(sql.includes('FROM chat_channel_members'))return value.member_id?{user_id:value.member_id}:null;throw Error(sql);},
   rows:async(sql,p)=>{calls.push({sql,p});if(sql.includes('FROM chat_rooms r'))return [value];if(sql.includes('SELECT user_id FROM chat_room_invites'))return [{user_id:9}];return {affectedRows:1};},
   transaction:async work=>work({query:async(sql,p)=>{calls.push({sql,p});if(sql.startsWith('SELECT revision'))return [[{revision:options.lockRevision??value.revision,archived:value.archived}]];if(sql.startsWith('INSERT INTO chat_channels'))return [{insertId:9}];return [{affectedRows:1}];}}),
  }
 });return {m,calls,value,rights};
}
test('creating an empty room creates no memberships, even for its owner',async()=>{
 const f=await fixture();const res=await f.m.chatRoomsApi(req('POST',{name:'Архитектура',join_policy:'workspace',invite_ids:[]}),['chat','rooms'],user);
 assert.deepEqual(await res.json(),{id:9,member_count:0,revision:1});assert.equal(res.status,201);
 assert.ok(f.calls.some(c=>c.sql.startsWith('INSERT INTO chat_rooms')));assert.equal(f.calls.some(c=>c.sql.includes('INSERT')&&c.sql.includes('chat_channel_members')),false);
});
test('closed rooms are invisible and cannot be joined without an invitation',async()=>{
 const f=await fixture({room:{join_policy:'invite'}});assert.deepEqual(await (await f.m.chatRoomsApi(req('GET'),['chat','rooms'],user)).json(),[]);
 await assert.rejects(()=>f.m.chatRoomsApi(req('POST'),['chat','rooms','9','join'],user),{status:404});assert.equal(f.calls.some(c=>c.sql.startsWith('INSERT')),false);
});
test('invitation permits joining, but does not grant history until explicit membership',async()=>{
 const f=await fixture({room:{join_policy:'invite',invited_id:7}});
 await assert.rejects(()=>f.m.assertChatRoomMembership(user,f.value),{status:403});
 await f.m.chatRoomsApi(req('POST'),['chat','rooms','9','join'],user);
 const join=f.calls.find(c=>c.sql.startsWith('INSERT IGNORE INTO chat_channel_members'));assert.ok(join);assert.match(join.sql,/COALESCE\(MAX\(id\),0\)/);assert.deepEqual(Array.from(join.p),[9,7,'member',9]);
 f.value.member_id=7;await f.m.assertChatRoomMembership(user,f.value,{write:true});
});
test('leave removes only membership and preserves the room, history and invitation',async()=>{
 const f=await fixture({room:{member_id:7}});await f.m.chatRoomsApi(req('POST'),['chat','rooms','9','leave'],user);
 const deletes=f.calls.filter(c=>c.sql.startsWith('DELETE'));assert.equal(deletes.length,1);assert.match(deletes[0].sql,/chat_channel_members.*user_id=\?/);assert.deepEqual(Array.from(deletes[0].p),[9,7]);
});
test('archived rooms retain history for members, disallow writing and joining',async()=>{
 const f=await fixture({room:{member_id:7,archived:1}});await f.m.assertChatRoomMembership(user,f.value);
 await assert.rejects(()=>f.m.assertChatRoomMembership(user,f.value,{write:true}),{status:409});await assert.rejects(()=>f.m.chatRoomsApi(req('POST'),['chat','rooms','9','join'],user),{status:409});
});
test('project membership never substitutes for room membership and revoked project access is enforced',async()=>{
 const f=await fixture({room:{project_id:3,join_policy:'project'}});await assert.rejects(()=>f.m.assertChatRoomMembership(user,f.value),{status:403});
 const revoked=await fixture({room:{project_id:3,join_policy:'project',member_id:7},projectDenied:true});await assert.rejects(()=>revoked.m.assertChatRoomMembership(user,revoked.value),{status:403});
});
test('policy change during join is optimistic and creates no membership',async()=>{
 const f=await fixture({lockRevision:2});await assert.rejects(()=>f.m.chatRoomsApi(req('POST'),['chat','rooms','9','join'],user),{status:409});assert.equal(f.calls.some(c=>c.sql.startsWith('INSERT')),false);
});
test('owners can configure empty rooms without entering; closing revokes uninvited members',async()=>{
 const f=await fixture({room:{created_by:7}});await f.m.chatRoomsApi(req('PUT',{name:'Закрытая',join_policy:'invite',project_id:null,invite_ids:[10],revision:1}),['chat','rooms','9'],user);
 const revoke=f.calls.find(c=>c.sql.startsWith('DELETE FROM chat_channel_members'));assert.ok(revoke);assert.deepEqual(Array.from(revoke.p),[9,7,0,10]);assert.ok(f.calls.some(c=>c.sql.includes('revision=revision+1')));
});
test('ordinary members cannot manage a room, creation needs an explicit permission, and service users cannot create rooms',async()=>{
 const f=await fixture({room:{member_id:7},rights:['chat.room.join']});await assert.rejects(()=>f.m.chatRoomsApi(req('POST',{name:'Room'}),['chat','rooms'],user),{status:403});await assert.rejects(()=>f.m.chatRoomsApi(req('PUT',{}),['chat','rooms','9'],user),{status:403});await assert.rejects(()=>f.m.chatRoomsApi(req('GET'),['chat','rooms'],{...user,is_service:true}),{status:403});
});
test('room schema requires a project for project rooms and rejects mixed audience or duplicate invites',async()=>{
 const {m}=await fixture();for(const d of [{name:'R',join_policy:'project'},{name:'R',join_policy:'workspace',project_id:2},{name:'R',invite_ids:[7,7]}])assert.equal(m.roomSchema.safeParse(d).success,false);assert.equal(m.roomSchema.safeParse({name:'R',join_policy:'invite',invite_ids:[]}).success,true);
});
test('legacy channels keep their existing authorization path',async()=>{
 const f=await fixture({legacy:true});assert.equal(await f.m.assertChatRoomMembership(user,{id:1}),null);
});
test('browser push does not alert for project rooms that the recipient has left',async()=>{
 const common=await load('work-common.js');const m=await load('browser-push.js',{'work-personal.js':{localNotificationTime:()=>({quiet:false}),mayReadNotification:async()=>false},'permissions.js':{projectPermissionSet:async()=>new Set(['chat.use']),workspacePermissionSet:async()=>new Set(['chat.room.join'])},'db.js':{rows:async sql=>sql.includes('user_notifications')?[]:[{id:100,channel_id:9,sender_id:8,project_id:3}],one:async sql=>sql.includes('FROM chat_rooms')?room:sql.includes('FROM chat_channel_members')?null:Promise.reject(new common.WorkError(500,sql))}});
 const value=await m.pushItems(user,{last_notification_id:0,last_chat_message_id:0});assert.equal(value.notify,false);assert.equal(value.messageId,100);
});
