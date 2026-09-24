import test from 'node:test';
import assert from 'node:assert/strict';
import {load} from './test-module-loader.mjs';
// Создаёт сотрудника и план одной рабочей области для проверок границ доступа.
const user={id:7,workspace_id:1,global_role:'member'},plan={id:4,workspace_id:1,project_id:3,archived:0,revision:2};
test('planning needs both project access and its own permission; foreign workspace is hidden',async()=>{
 const calls=[];let granted=false;
 const common=await load('work-common.js');
 const m=await load('work-plans.js',{'work-common.js':{...common,projectFor:async(u,id,permission='project.browse')=>{calls.push(permission);if(permission.startsWith('planning.')&&!granted)throw new common.WorkError(403,'Denied');return {id};}}});
 await assert.rejects(()=>m.planAccess(user,plan),{status:403});
 await assert.rejects(()=>m.planAccess(user,{...plan,workspace_id:2}),{status:404});
 granted=true;await m.planAccess(user,plan,true);assert.deepEqual(calls.slice(-3),['project.browse','planning.view','planning.manage']);
 await assert.rejects(()=>m.planAccess(user,{...plan,archived:1},true),{status:409});
});
test('new project drafts require membership, with a separate edit flag',async()=>{
 let membership=null;const m=await load('work-plans.js',{'db.js':{one:async()=>membership}}),draft={...plan,project_id:null};
 await assert.rejects(()=>m.planAccess(user,draft),{status:403});membership={can_edit:0};await m.planAccess(user,draft);await assert.rejects(()=>m.planAccess(user,draft,true),{status:403});
 membership.can_edit=1;await m.planAccess(user,draft,true);await m.planAccess({...user,global_role:'owner'},draft,true);
 await assert.rejects(()=>m.planAccess({...user,is_service:1,global_role:'owner'},draft),{status:403});
});
test('plan validation rejects stale revisions, inverted dates, nested epics and injected fields',async()=>{
 const m=await load('plan-schema.js');assert.throws(()=>m.checkPlanRevision(plan,1),{status:409});m.checkPlanRevision(plan,2);
 assert.throws(()=>m.checkPlanDates({start_date:'2026-09-30',due_date:'2026-09-01'}),{status:422});
 assert.throws(()=>m.checkPlanDates({kind:'epic',parent_id:1}),{status:422});
 const data={title:'Идея',kind:'task',request_id:'589196e2-160c-410e-8342-a4cbd67b7bda'};
 assert.equal(m.planCreateSchema.safeParse({title:data.title,request_id:data.request_id,archived:true}).success,false);
 assert.equal(m.planItemCreateSchema.safeParse(data).success,true);
 for(const patch of [{task_id:1},{state:'active'},{revision:0},{due_date:'2026-02-30'}])assert.equal(m.planItemCreateSchema.safeParse({...data,...patch}).success,false);
});
test('planning scopes are separate from ordinary tasks and are not enabled by default',async()=>{
 const m=await load('api-access.js');for(const [method,scope]of [['GET','planning:read'],['POST','planning:write']]){const request=new Request('https://test/api/work/plans',{method}),actor={api_token_id:1,api_enabled:true,scopes_json:[scope],allowed_scopes_json:[scope]};assert.equal(m.apiRequestError(actor,request),null);assert.ok(m.apiRequestError({...actor,scopes_json:['tasks:read','tasks:write']},request));}
 assert.equal(m.DEFAULT_API_SCOPES.includes('planning:read'),false);
});
