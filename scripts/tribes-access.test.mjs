import test from 'node:test';
import assert from 'node:assert/strict';
import {load} from './test-module-loader.mjs';
import {tribeViewData} from '../src/lib/tribe-view-data.js';

const actor={id:8,workspace_id:1,global_role:'member',email:'test@example.invalid'};
// Проверяет настоящую функцию прав с контролируемыми назначениями без подключения к рабочей БД.
async function permissions({role='member',owner=2,mode='members',membership=null,decisions=[],tribe=null}={}){
 const project={id:3,workspace_id:1,access_mode:mode,owner_id:owner,tribe_id:tribe?5:null};
 const module=await load('permissions.js',{'tribe-policy.js':{tribeAccess:async()=>tribe?.access||null},'db.js':{one:async sql=>sql.includes('project_members')?membership:project,rows:async sql=>sql.includes('access_assignments')?decisions:sql.includes('permission_schemes')?[{permission_key:'project.browse',principal_type:'any_authenticated'}]:[]}});
 return module.projectPermissionSet({...actor,global_role:role},project);
}
test('new closed projects do not inherit the company scheme or global project-manager access',async()=>{
 assert.equal((await permissions({role:'project_manager'})).size,0);
 assert.equal((await permissions()).size,0);
 assert.ok((await permissions({mode:'scheme'})).has('project.browse'));
});
test('project ownership grants management independently of membership while explicit denials win',async()=>{
 assert.ok((await permissions({owner:actor.id})).has('project.access.manage'));
 assert.equal((await permissions({owner:actor.id,decisions:[{permission_key:'project.delete',effect:'deny'}]})).has('project.delete'),false);
 assert.equal((await permissions({owner:actor.id,decisions:[{permission_key:'project.browse',effect:'deny'}]})).size,0);
});
test('tribe membership is required even for a project member and delegated project rights stay in that tribe',async()=>{
 assert.equal((await permissions({membership:{project_role:'manager'},tribe:{access:null}})).size,0);
 assert.ok((await permissions({tribe:{access:{can_manage_projects:true}}})).has('project.access.manage'));
 assert.equal((await permissions({tribe:{access:{can_manage_projects:false}}})).size,0);
});
test('a functional role opens a closed project only when assigned to that project',async()=>{
 assert.equal((await permissions({decisions:[{permission_key:'task.edit',effect:'allow',scope_type:'workspace'}]})).size,0);
 const allowed=await permissions({decisions:[{permission_key:'task.edit',effect:'allow',scope_type:'project'}]});assert.ok(allowed.has('task.edit'));assert.ok(allowed.has('project.browse'));
});
test('only company administrators can promote a global tribe leader',async()=>{
 const module=await load('work-security.js');assert.throws(()=>module.assertAccountChange(actor,null,{global_role:'tribe_leader'}),{status:403});assert.doesNotThrow(()=>module.assertAccountChange({...actor,global_role:'admin'},null,{global_role:'tribe_leader'}));
});
test('selecting a tribe filters project data without mutating the company snapshot',()=>{
 const company={tribes:[{id:1,can_create_projects:false}],projects:[{id:10,tribe_id:1},{id:20,tribe_id:2}],tasks:[{id:1,project_id:10},{id:2,project_id:20}],permissions:{features:{'project.create':true}}};
 const selected=tribeViewData(company,1);assert.deepEqual(selected.projects.map(p=>p.id),[10]);assert.deepEqual(selected.tasks.map(t=>t.id),[1]);assert.equal(selected.permissions.features['project.create'],false);assert.equal(company.projects.length,2);assert.equal(company.permissions.features['project.create'],true);
});
test('AI inbox excludes other reviewers, expired requests, dry runs and revoked source access',async()=>{
 const base={id:1,project_id:3,checkpoint_status:'waiting',reviewers_json:[8],source_meta_json:{gate_message:'Проверьте решение'},config_json:{mode:'review'},source_refs_json:[],agent_name:'Проверка'};
 const candidates=[base,{...base,id:2,reviewers_json:[9]},{...base,id:3,expired:1},{...base,id:4,source_meta_json:{dry_run:true}},{...base,id:5,project_id:99},{...base,id:6,checkpoint_status:null,reviewers_json:[],result_json:{summary:'Действия'}}];
 const module=await load('agent-approvals.js',{'db.js':{rows:async()=>candidates},'agent-sources.js':{agentScope:async()=>{},agentAccess:async()=>{},checkAgentRefs:async(_user,projectId)=>{if(projectId===99){const error=new Error('Revoked');error.status=403;throw error;}}}});
 const result=await module.pendingAgentApprovals(actor);assert.deepEqual(Array.from(result.items,item=>item.id),[1,6]);assert.equal(result.items[0].kind,'step');assert.equal(result.items[1].kind,'actions');assert.equal(result.items[0].source_refs_json,undefined);
});
