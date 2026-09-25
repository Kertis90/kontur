import test from 'node:test';
import assert from 'node:assert/strict';
import {load} from './test-module-loader.mjs';
const user={id:7,workspace_id:1},service={id:70,workspace_id:1,is_service:true,global_role:'admin'},profileId='589196e2-160c-410e-8342-a4cbd67b7bda';
const plain=v=>JSON.parse(JSON.stringify(v));
const base={profile_id:profileId,instructions:'Оцени состояние проекта и укажи источники.',trigger:{type:'manual'},sources:{tasks:{enabled:true},quality:{enabled:false}}};
const request=(method,data)=>new Request('https://test/api/work/agents',{method,...(data?{body:JSON.stringify(data)}:{})});
const fail=async()=>{throw Error('Unexpected operation');};
const sources={agentAccess:async()=>({id:3,status:'active'}),agentScope:async()=>{},agentActor:async()=>user,validateAgentConfigAccess:async()=>{},collectAgentSources:fail,checkAgentRefs:async()=>{}};
const identity={id:2,user_id:70,owner_id:7,monthly_tokens:1000,policy_json:{projects:[{id:3,permissions:['project.browse','agent.view','agent.run']}],workspace_permissions:['knowledge.view'],profile_ids:[profileId],actions:[],source_kinds:['task'],spaces:[{id:4,level:'view'}],chat_ids:[],conference_ids:[]}};

test('service accounts never inherit global admin, project assignments or open knowledge spaces',async()=>{
 const db={'db.js':{one:async sql=>{assert.match(sql,/FROM ai_agent_identities/);return identity;},rows:fail}};
 const permissions=await load('permissions.js',db);assert.deepEqual([...await permissions.projectPermissionSet(service,{id:3,workspace_id:1,access_mode:'members',owner_id:7})].sort(),['agent.run','agent.view','project.browse']);assert.equal((await permissions.projectPermissionSet(service,{id:9,workspace_id:1,access_mode:'members'})).size,0);assert.deepEqual([...await permissions.workspacePermissionSet(service)],['knowledge.view']);
 const kb=await load('knowledge-access.js',db);const access=await kb.knowledgeAccessMap(service,[{id:4,visibility:'private'},{id:9,visibility:'public'}]);assert.equal(access.get(4),'view');assert.equal(access.get(9),'none');
});
test('disabled identity or owner removes all permissions and denies model reservation',async()=>{
 const p=await load('permissions.js',{'db.js':{one:async()=>null}});assert.equal((await p.workspacePermissionSet(service)).size,0);assert.equal((await p.projectPermissionSet(service,{id:3,workspace_id:1,access_mode:'members',owner_id:7})).size,0);
 const m=await load('agent-identity-policy.js',{'db.js':{one:async()=>null}});await assert.rejects(()=>m.readAgentIdentity(service),{status:403});await assert.rejects(()=>m.assertIdentityModelBudget(service,profileId,1,{query:async()=>[[]]}),{status:403});
});
test('identity policy restricts projects, tools, source kinds and each model, with cumulative token budget',async()=>{
 const m=await load('agent-identity-policy.js',{'db.js':{one:async()=>identity}}),schema=await load('agent-schema.js'),cfg=schema.agentConfigSchema.parse(base);
 await m.assertIdentityConfiguration(service,3,cfg);
 for(const c of [{...cfg,actions:['create_task']},{...cfg,profile_id:'wrong'},{...cfg,sources:{...cfg.sources,objectives:true}}])await assert.rejects(()=>m.assertIdentityConfiguration(service,3,c),{status:403});
 await assert.rejects(()=>m.assertIdentityConfiguration(service,4,cfg),{status:403});await assert.rejects(()=>m.assertIdentityRefs(service,[{kind:'article'}]),{status:403});
 const c={query:async sql=>sql.includes('SUM(')?[[{total:950}]]:[[identity]]};await m.assertIdentityModelBudget(service,profileId,50,c);await assert.rejects(()=>m.assertIdentityModelBudget(service,profileId,51,c),{status:429});
});
test('approval checkpoints resume exactly at the gate, preserving branch data and previous model work',async()=>{
 const m=await load('agent-flow.js');const flow=m.flowSchema.parse({nodes:[{id:'analysis',name:'Анализ',type:'analyze',prompt:'Проанализируй данные',fields:[]},{id:'approval',name:'Решение',type:'approval',message:'Проверить',reviewer_ids:[7],timeout_hours:24},{id:'result',name:'Итог',type:'template',text:'{{steps.analysis.summary}} · {{steps.approval.approved}}'}]});
 let calls=0,snapshot;const context={sources:[{kind:'task',id:1}],inputs:{}};
 const paused=await m.executeAgentFlow({flow},context,{analyze:async()=>{calls++;return {summary:'Факты',values:{}};},approval:async(_node,state)=>{snapshot=structuredClone(state);return null;}});assert.equal(paused.paused,true);assert.equal(snapshot.index,1);assert.equal(calls,1);
 const result=await m.executeAgentFlow({flow},context,{analyze:fail,resume:snapshot,approval:async()=>({approved:true,summary:'Да'})});assert.equal(result.state.steps.result.summary,'Факты · true');assert.equal(result.trace.length,2);assert.equal(calls,1);
});
test('gate decisions require assigned reviewer and optimistic version; approval persists encrypted resume state',async()=>{
 const checkpoint={node_id:'approval',revision:2,status:'waiting',reviewers_json:[8],expired:0,snapshot_encrypted:JSON.stringify({decisions:{},flow:{index:1}})},writes=[];
 const m=await load('agent-checkpoints.js',{'agent-sources.js':sources,'crypto.js':{encryptSecret:v=>'encrypted:'+v,decryptSecret:v=>v},'db.js':{transaction:async fn=>fn({query:async(sql,p)=>{if(sql.startsWith('SELECT enabled'))return [[{enabled:1,revision:4}]];if(sql.startsWith('SELECT status'))return [[{status:'review',source_meta_json:{waiting_gate:'approval'}}]];if(sql.startsWith('SELECT *,expires_at'))return [[checkpoint]];if(sql.startsWith('UPDATE'))writes.push({sql,p});return [[]];}})}});
 const run={id:4,project_id:3,agent_id:2,agent_revision:4,source_refs_json:[]},decision={node_id:'approval',revision:2,decision:'approve',note:'Проверено'},verify=async()=>({actor:user});
 await assert.rejects(()=>m.decideAgentGate(user,run,decision,verify),{status:403});assert.equal(writes.length,0);
 checkpoint.reviewers_json=[7];await assert.rejects(()=>m.decideAgentGate(user,run,{...decision,revision:1},verify),{status:409});
 const result=await m.decideAgentGate(user,run,decision,verify);assert.equal(result.status,'queued');const saved=writes.find(w=>w.sql.includes('snapshot_encrypted'));assert.ok(saved.p[0].startsWith('encrypted:'));assert.equal(JSON.parse(saved.p[0].slice(10)).decisions.approval.approved,true);
 checkpoint.status='ready';await assert.rejects(()=>m.decideAgentGate(user,run,decision,verify),{status:409});
});
test('gate timeout and corrupt persisted state fail closed without another provider request',async()=>{
 const m=await load('agent-checkpoints.js',{'db.js':{one:async()=>({snapshot_encrypted:'bad'})},'crypto.js':{decryptSecret:()=>'',encryptSecret:fail}});await assert.rejects(()=>m.loadAgentCheckpoint({id:1}),{status:409});
});
test('saving a draft updates only the draft and does not cancel or replace live runs',async()=>{
 const schema=await load('agent-schema.js'),cfg=schema.agentConfigSchema.parse(base),calls=[];
 const m=await load('agent-lifecycle.js',{'agent-sources.js':sources,'db.js':{transaction:async fn=>fn({query:async(sql,p)=>{calls.push({sql,p});if(sql.startsWith('SELECT revision FROM ai_agents'))return [[{revision:5}]];if(sql.startsWith('SELECT revision FROM ai_agent_drafts'))return [[{revision:2}]];return [[]];}})}});
 const agent={id:2,project_id:3,revision:5},data={project_id:3,name:'Черновик',enabled:true,revision:5,draft_revision:2,config:cfg};
 const res=await m.agentLifecycleApi(request('PUT',data),['agents','2','draft'],user,{getAgent:async()=>agent,saveAgent:fail});assert.equal((await res.json()).draft_revision,3);
 assert.equal(calls.some(c=>c.sql.startsWith('UPDATE ai_agents')||c.sql.includes('ai_agent_runs')),false);assert.ok(calls.some(c=>c.sql.startsWith('INSERT INTO ai_agent_drafts')));
 await assert.rejects(()=>m.agentLifecycleApi(request('PUT',{...data,draft_revision:1}),['agents','2','draft'],user,{getAgent:async()=>agent,saveAgent:fail}),{status:409});
});
test('publishing locks both versions and binds the selected service principal inside the transaction',async()=>{
 const schema=await load('agent-schema.js'),config=schema.agentConfigSchema.parse(base),c={query:async(sql)=>sql.startsWith('SELECT revision FROM ai_agents')?[[{revision:5}]]:sql.startsWith('SELECT * FROM ai_agent_drafts')?[[{revision:2,base_revision:5,name:'Draft',enabled:1,config_json:config,identity_id:2}]]:[[]]};let seen;
 const m=await load('agent-lifecycle.js',{'agent-sources.js':sources,'agent-identities.js':{identityActor:async()=>service},'db.js':{transaction:fn=>fn(c)}});
 const res=await m.agentLifecycleApi(request('POST',{revision:5,draft_revision:2}),['agents','2','publish'],user,{getAgent:async()=>({id:2,project_id:3}),saveAgent:async(u,d,id,opts)=>{seen=opts;return {id,revision:6};}});assert.equal((await res.json()).revision,6);assert.equal(seen.connection,c);assert.equal(seen.executor,service);assert.equal(seen.identityId,2);
});
test('exact source quotes are accepted; invented or uncollected quotes and IDs are rejected',async()=>{
 const m=await load('agent-schema.js'),config=m.agentConfigSchema.parse(base),refs=[{kind:'task',id:1,evidence:'Нужна проверка интеграции'}];
 const value={summary:'Проверить',citations:[{kind:'task',id:1,quote:'проверка интеграции'}]};assert.equal(m.parseAgentResult(JSON.stringify(value),config,refs).citations.length,1);
 for(const cite of [{kind:'task',id:1,quote:'всё готово'},{kind:'task',id:2,quote:'проверка'}])assert.throws(()=>m.parseAgentResult(JSON.stringify({...value,citations:[cite]}),config,refs),{status:502});
});
test('before and after previews show only the fields proposed for modification',async()=>{
 const m=await load('agent-workbench.js');const diff=m.actionDifference({type:'update_task',patch:{priority:'high'}},{priority:'low',description:'Unrelated secret'});assert.deepEqual(plain(diff),{before:{priority:'low'},after:{priority:'high'}});assert.equal(m.actionDifference({type:'create_task',title:'New',reason:'Why'}).after.reason,undefined);
});
test('evaluation scoring is deterministic and measures only explicit checks',async()=>{
 const m=await load('agent-evaluations.js'),testCase=m.evaluationCaseSchema.parse({key:'a',name:'Risk',expected:{summary_contains:['риск'],summary_excludes:['готов'],required_actions:['comment'],forbidden_actions:['create_task'],max_actions:1,require_citations:true}});
 const result={summary:'Есть РИСК задержки',actions:[{type:'comment'}],citations:[{kind:'task',id:1}],confidence:null};const score=m.scoreAgentEvaluation(result,testCase.expected);assert.equal(score.percent,100);assert.equal(score.total,6);assert.deepEqual(plain(score),plain(m.scoreAgentEvaluation(result,testCase.expected)));result.summary='Готово';assert.equal(m.scoreAgentEvaluation(result,testCase.expected).passed,4);
});
test('frozen evaluation snapshots require matching principal, batch status, run and source rights',async()=>{
 const item={workspace_id:1,agent_id:2,user_id:7,api_token_id:4,batch_status:'running',status:'running',run_id:9,config_json:{version:1},context_encrypted:'encrypted'},refs=[{kind:'task',id:1}];let checked=false;
 const m=await load('agent-evaluations.js',{'agent-sources.js':{...sources,checkAgentRefs:async(_u,_p,r,opts)=>{checked=true;assert.equal(opts.versions,true);assert.equal(r[0].id,1);}},'crypto.js':{decryptSecret:()=>JSON.stringify({refs,sources:[{kind:'task',id:1}]}),encryptSecret:fail},'db.js':{one:async()=>item}});
 const run={id:9,agent_id:2,workspace_id:1,project_id:3,api_token_id:4,config_json:{version:1}};assert.equal((await m.evaluationContext(user,run,1)).sources.length,1);assert.equal(checked,true);
 for(const patch of [{id:10},{api_token_id:5},{workspace_id:2},{config_json:{version:2}}])await assert.rejects(()=>m.evaluationContext(user,{...run,...patch},1),{status:409});item.batch_status='cancelled';await assert.rejects(()=>m.evaluationContext(user,run,1),{status:409});
});
test('workbench routes have separate scopes, including identities and gate approval',async()=>{
 const m=await load('api-access.js');for(const [method,path,scope]of [['GET','agents/identities','agents:identities'],['PUT','agents/identities/1','agents:identities'],['POST','agents/runs/9/gate','agents:approve'],['PUT','agents/2/draft','agents:write'],['POST','agents/2/publish','agents:write'],['POST','agents/2/evaluations/suites','agents:write'],['POST','agents/2/evaluations/batches','agents:run'],['GET','agents/runs/9/preview','agents:read']]){const req=new Request('https://test/api/work/'+path,{method});const actor={api_token_id:1,api_enabled:true,scopes_json:[scope],allowed_scopes_json:[scope]};assert.equal(m.apiRequestError(actor,req),null,path);assert.ok(m.apiRequestError({...actor,scopes_json:[]},req),path);}
});
test('all practical templates parse and start paused without automatic actions',async()=>{
 const template=await load('agent-templates.js'),schema=await load('agent-schema.js');for(const name of ['release','followup','knowledge','recurring']){const d=schema.agentSchema.parse(template.initialAgent(3,profileId,name));assert.equal(d.enabled,false);assert.equal(d.config.mode,'review');assert.equal(d.config.policy.require_citations,true);}
});
