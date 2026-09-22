import test from 'node:test';
import assert from 'node:assert/strict';
import {load} from './test-module-loader.mjs';
const user={id:7,workspace_id:1},profileId='589196e2-160c-410e-8342-a4cbd67b7bda';
const config=()=>({profile_id:profileId,instructions:'Оцени риски проекта по данным.',trigger:{type:'manual'},sources:{tasks:{enabled:true},quality:{enabled:false}}});
const rights=new Set(['project.browse','agent.view','agent.run','agent.manage','agent.approve','agent.automate','qa.view','qa.execute','qa.manage','task.create','comment.create']);
const forbidden=async()=>{throw new Error('Unexpected operation');};
const permissions={'work-tasks.js':{createWorkTask:forbidden,changeTask:forbidden},'work-access.js':{fieldAccess:async()=>[]},'recordings.js':{recordingConferenceAccess:forbidden,assertRecording:forbidden},'permissions.js':{projectPermissionSet:async()=>rights,workspacePermissionSet:async()=>new Set()}};
const result=(patch={})=>({name:'Login',fullName:'tests.login',historyId:'history-1',uuid:'uuid-1',status:'passed',...patch});
const input=results=>({external_id:'build-1',title:'Build 1',results});

test('Allure merges retries in chronological order, deduplicates UUIDs and preserves stable keys',async()=>{
 const m=await load('allure-format.js');const results=[result({uuid:'two',status:'passed',stop:200}),result({uuid:'one',status:'failed',stop:100}),result({uuid:'two',status:'passed',stop:200})];
 const data=m.normalizeAllure(input(results));assert.equal(data.results.length,1);assert.equal(data.results[0].key,'history-1');assert.equal(data.results[0].attempts,2);assert.equal(data.results[0].flaky,true);assert.equal(data.summary.retries,1);assert.equal(data.summary.passed,1);
 assert.equal(m.allureFingerprint(data),m.allureFingerprint(m.normalizeAllure(input(results.reverse()))));
 assert.throws(()=>m.normalizeAllure(input([result(),result({status:'failed'})])),{status:422});
});
test('Allure parameter variants stay separate, secret values and attachments are not persisted',async()=>{
 const m=await load('allure-format.js');const a=result({historyId:undefined,parameters:[{name:'login',value:'SECRET',mode:'masked'}],attachments:[{source:'../../etc/passwd'}]});
 const b=result({uuid:'two',historyId:undefined,parameters:[{name:'login',value:'OTHER',mode:'hidden'}]});
 const data=m.normalizeAllure(input([a,b]));assert.equal(data.results.length,2);assert.ok(!JSON.stringify(data).includes('SECRET'));assert.ok(!JSON.stringify(data).includes('passwd'));assert.equal(data.results[0].key.includes('tests.login::'),true);
});
test('Allure maps broken and unknown to blocked, bounds deep steps, and rejects unsafe report links',async()=>{
 const m=await load('allure-format.js');let step={name:'bottom'};for(let i=0;i<1000;i++)step={name:'step',steps:[step]};const data=m.normalizeAllure(input([result({status:'broken',steps:[step]}),result({historyId:'other',uuid:'other',status:'unknown'})]));assert.equal(data.summary.broken,1);assert.equal(data.summary.unknown,1);assert.ok(data.results.every(r=>r.result==='blocked'));assert.ok(data.results[0].steps.length<=6);
 for(const url of ['javascript:alert(1)','https://user:pass@allure.test/reports/a','https://allure.test/reportsevil','https://other.test/reports/a','https://allure.test/reports/../private'])assert.throws(()=>m.allureReportUrl(url,'https://allure.test/reports'),{status:422});
 assert.equal(m.allureReportUrl('https://allure.test/reports/20','https://allure.test/reports'),'https://allure.test/reports/20');
});
test('Allure imports only once, binds external ID to normalized contents and requires case creation rights',async()=>{
 const conn={id:2,project_id:3,workspace_id:1,plan_id:5,key_strategy:'historyId',report_base_url:'',enabled:1,create_missing:1,revision:1};let previous=null,writes=0;
 const m=await load('work-allure.js',{...permissions,'events.js':{emitEvent:async()=>{}},'db.js':{one:async()=>({id:3,status:'active',workspace_id:1}),rows:async()=>[],transaction:async fn=>fn({query:async(sql,p)=>{
  if(sql.startsWith('SELECT * FROM allure_connections'))return [[conn]];
  if(sql.startsWith('SELECT * FROM allure_imports'))return [previous?[previous]:[]];
  if(sql.startsWith('SELECT * FROM quality_cases'))return [[]];
  if(sql.startsWith('SELECT id,status FROM projects'))return [[{id:3,status:'active'}]];
  writes++;if(sql.startsWith('INSERT INTO allure_imports'))previous={id:9,run_id:10,fingerprint:p[3],summary_json:p[5]};return [{insertId:sql.startsWith('INSERT INTO quality_runs')?10:9}];
 }})}});
 const first=await m.importAllure(user,conn,input([result()]));const count=writes;const second=await m.importAllure(user,conn,input([result()]));assert.equal(first.run_id,10);assert.equal(second.replayed,true);assert.equal(writes,count);
 await assert.rejects(()=>m.importAllure(user,conn,input([result({status:'failed'})])),{status:409});
 const preview=await m.importAllure(user,{...conn,create_missing:0},input([result()]),{preview:true});assert.equal(preview.can_import,false);
 await assert.rejects(()=>m.importAllure(user,{...conn,create_missing:0},input([result({historyId:'new'})])),{status:409});
});
test('Allure refuses a project without QA rights before reading or mutating results',async()=>{
 const m=await load('work-allure.js',{...permissions,'permissions.js':{projectPermissionSet:async()=>new Set(['project.browse']),workspacePermissionSet:async()=>new Set()},'db.js':{one:async()=>({id:3,status:'active',workspace_id:1})}});
 await assert.rejects(()=>m.importAllure(user,{project_id:3},input([result()])),{status:403});
});
test('agent schemas reject arbitrary tools, empty sources and unbounded scheduling',async()=>{
 const m=await load('agent-schema.js');const good=m.agentConfigSchema.parse(config());assert.equal(good.mode,'review');assert.equal(good.daily_limit,5);assert.equal(good.actions.length,0);
 assert.equal(m.agentConfigSchema.safeParse({...good,actions:['shell']}).success,false);
 assert.equal(m.agentConfigSchema.safeParse({...good,trigger:{...good.trigger,type:'schedule',interval_minutes:1}}).success,false);
 assert.equal(m.agentConfigSchema.safeParse({...good,sources:{...good.sources,tasks:{...good.sources.tasks,enabled:false}}}).success,false);
 assert.equal(m.agentConfigSchema.safeParse({...good,trigger:{...good.trigger,type:'event',events:[]}}).success,false);
});
test('agent result validation rejects unknown operations, cross-context task IDs and surplus actions',async()=>{
 const m=await load('agent-schema.js'),c=m.agentConfigSchema.parse({...config(),actions:['comment'],max_actions:1}),refs=[{kind:'task',id:10}];
 assert.equal(m.parseAgentResult(JSON.stringify({summary:'Сводка',actions:[{type:'comment',task_id:10,body:'Уточните срок'}]}),c,refs).actions.length,1);
 for(const actions of [[{type:'comment',task_id:11,body:'Hello'}],[{type:'create_task',title:'Task'}],[{type:'shell',command:'rm -rf'}],[{type:'comment',task_id:10,body:'One'},{type:'comment',task_id:10,body:'Two'}]])assert.throws(()=>m.parseAgentResult(JSON.stringify({summary:'Сводка',actions}),c,refs),{status:502});
 assert.throws(()=>m.parseAgentResult('{invalid',c,refs),{status:502});
});
test('agent triggers skip automation loops, unrelated events and passing Allure when configured',async()=>{
 const m=await load('agent-schema.js'),c=m.agentConfigSchema.parse({...config(),trigger:{type:'event',events:['task.updated','quality.allure.imported']}});
 assert.equal(m.agentEventMatches(c,{event_type:'task.updated'},{}),true);
 for(const p of [{automation_depth:1},{agent_run_id:42}])assert.equal(m.agentEventMatches(c,{event_type:'task.updated'},p),false);
 assert.equal(m.agentEventMatches(c,{event_type:'task.created'},{}),false);
 assert.equal(m.agentEventMatches(c,{event_type:'quality.allure.imported'},{failed:0}),false);
 assert.equal(m.agentEventMatches(c,{event_type:'quality.allure.imported'},{failed:2}),true);
});
test('context queries select only chosen task attributes, bind filters, enforce character limit',async()=>{
 const schema=await load('agent-schema.js'),cfg=schema.agentConfigSchema.parse(config());let query='',params=[];
 cfg.sources.tasks.fields=['title'];cfg.sources.tasks.priorities=['high'];cfg.sources.tasks.only_overdue=true;
 const m=await load('agent-sources.js',{...permissions,'work-semantic.js':{searchSemantic:forbidden},'db.js':{one:async()=>({id:3,status:'active',workspace_id:1,workflow_id:8,name:'Demo'}),rows:async(sql,p)=>{query=sql;params=p;return [{id:9,version_number:1,title:'Short'},{id:10,version_number:1,title:'Long'.repeat(200)}];}}});
 const data=await m.collectAgentSources(user,3,cfg,{},200);assert.equal(data.sources.length,1);assert.equal(data.meta.omitted,1);assert.ok(query.includes('t.title'));assert.ok(!query.includes('t.description'));assert.ok(!query.includes('custom_values'));assert.ok(query.includes('s.is_done=FALSE'));assert.equal(params[0],3);assert.equal(params[1],'high');
});
test('agent references hide moved or edited knowledge, deleted chat, foreign tasks and revoked token scopes',async()=>{
 const variants=[
  {ref:{kind:'task',id:5,project_id:3,version:1},db:{one:async sql=>sql.includes('FROM tasks')?{id:5,project_id:4,version_number:1}:{id:3,status:'active',workspace_id:1}},status:403},
  {ref:{kind:'article',id:8,space_id:2,version:1},db:{one:async sql=>sql.includes('knowledge_articles')?{id:8,space_id:2,version_number:2,status:'published'}:{id:3,status:'active',workspace_id:1}},status:409},
  {ref:{kind:'conference',id:8,project_id:3,messages:[{id:7,revision:1}]},db:{one:async()=>({id:3,status:'active',workspace_id:1}),rows:async()=>[]},status:409}
 ];
 for(const v of variants){const m=await load('agent-sources.js',{...permissions,'work-semantic.js':{searchSemantic:forbidden},'db.js':v.db,'knowledge-access.js':{knowledgeSpaceAccess:async()=>({level:'view'}),knowledgeAccessAtLeast:()=>true},'recordings.js':{recordingConferenceAccess:async()=>({id:8,project_id:3}),assertRecording:forbidden}});await assert.rejects(()=>m.checkAgentRefs(user,3,[v.ref]),{status:v.status});}
 const denied=await load('agent-sources.js',{'api-access.js':{apiBackgroundAllowed:async()=>false}});await assert.rejects(()=>denied.agentScope({...user,api_token_id:5},'tasks:read'),{status:403});
});
test('manual agent queue uses current caller, enforces one in flight, and replays request ID',async()=>{
 const schema=await load('agent-schema.js'),cfg=schema.agentConfigSchema.parse(config());const agent={id:2,project_id:3,revision:1,enabled:1,config:cfg};let previous=null,counts={pending:0,reviews:0,today:0},saved;
 const m=await load('agent-runtime.js',{'agent-sources.js':{agentActor:forbidden,agentAccess:async()=>{},agentScope:async()=>{},agentActor:async()=>user,validateAgentConfigAccess:async()=>{},collectAgentSources:async()=>{},checkAgentRefs:async()=>{}},'db.js':{transaction:async fn=>fn({query:async(sql,p)=>{if(sql.startsWith('SELECT * FROM ai_agents'))return [[agent]];if(sql.startsWith('SELECT r.id,r.status'))return [previous?[previous]:[]];if(sql.startsWith('SELECT SUM'))return [[counts]];if(sql.startsWith('INSERT INTO ai_agent_runs')){saved=p;previous={id:50,status:'queued'};return [{insertId:50}];}return [{affectedRows:1}];}})}});
 const first=await m.enqueueAgentRun({...user,id:9,api_token_id:44},agent,{key:'manual:9:id'});assert.equal(first.id,50);assert.equal(saved[3],9);assert.equal(saved[4],44);
 assert.equal((await m.enqueueAgentRun(user,agent,{key:'manual:9:id'})).replayed,true);
 previous=null;counts.pending=1;await assert.rejects(()=>m.enqueueAgentRun(user,agent,{key:'other'}),{status:409});counts.pending=0;counts.today=5;await assert.rejects(()=>m.enqueueAgentRun(user,agent,{key:'other'}),{status:429});
});
test('API routes require separate agent scopes; new scopes are not granted by default',async()=>{
 const m=await load('api-access.js');assert.equal(m.DEFAULT_API_SCOPES.some(s=>s.startsWith('agents:')),false);
 for(const [method,path,scope]of [['GET','agents','agents:read'],['POST','agents/2/run','agents:run'],['POST','agents/preview','agents:run'],['POST','agents/runs/1/review','agents:approve'],['PUT','agents/2','agents:write'],['POST','allure/connections/2/import','quality:write']]){
  const token={api_token_id:1,api_enabled:true,scopes_json:[scope],allowed_scopes_json:[scope]};const req=new Request(`https://kontur.test/api/work/${path}`,{method});assert.equal(m.apiRequestError(token,req),null);assert.ok(m.apiRequestError({...token,scopes_json:[]},req));
 }
});

async function reviewFixture({version=1,revoked=false,failSecond=false,automatic=false}={}){
 const schema=await load('agent-schema.js'),cfg=schema.agentConfigSchema.parse({...config(),actions:['create_task','comment'],mode:automatic?'automatic':'review'});
 const run={id:40,agent_id:2,workspace_id:1,project_id:3,actor_id:7,api_token_id:11,agent_revision:1,status:'review',config_json:cfg,source_refs_json:[{kind:'task',id:10,project_id:3,version:1}],result_json:{summary:'Анализ',actions:[{type:'create_task',title:'Проверить риск',description:'Описание',priority:'high'},{type:'comment',task_id:10,body:'Уточните сроки'}]},applied_json:null};
 const agent={id:2,workspace_id:1,project_id:3,enabled:true,revision:version,config_json:cfg};let created=0,comments=0;
 const m=await load('agent-runtime.js',{
  'agent-sources.js':{agentActor:forbidden,agentAccess:async()=>{},agentScope:async()=>{},agentActor:async(id)=>({...user,id}),validateAgentConfigAccess:async()=>{if(revoked)throw Object.assign(new Error('Revoked'),{status:403});},checkAgentRefs:async()=>{},collectAgentSources:async()=>{}},
  'work-common.js':{...await load('work-common.js'),projectFor:async()=>({id:3,status:'active'})},
  'api-access.js':{apiBackgroundAllowed:async()=>true},'events.js':{emitEvent:async()=>{}},'work-tasks.js':{changeTask:forbidden,createWorkTask:async(u,p,d,c,opts)=>{assert.equal(opts.depth,1);created++;return {task_id:90};}},
  'db.js':{one:async sql=>sql.startsWith('SELECT * FROM ai_agents')?agent:sql.startsWith('SELECT status')?{status:run.status}:run,rows:async()=>({affectedRows:1}),transaction:async fn=>{
   const oldCreated=created,oldComments=comments,oldStatus=run.status;
   try{return await fn({query:async(sql,p)=>{
    if(sql.startsWith('SELECT enabled,revision'))return [[agent]];
    if(sql.startsWith('SELECT status,applied_json'))return [[{status:run.status,applied_json:run.applied_json}]];
    if(sql.startsWith('SELECT id,project_id,version_number'))return [[{id:10,project_id:3,version_number:1}]];
    if(sql.startsWith('INSERT INTO comments')){if(failSecond)throw new Error('DB interrupted');comments++;return [{insertId:92}];}
    if(sql.startsWith('UPDATE ai_agent_runs')){run.status='completed';run.applied_json=p[0];}
    return [{affectedRows:1}];
   }});}catch(e){created=oldCreated;comments=oldComments;run.status=oldStatus;throw e;}
  }}
 });return {m,run,get writes(){return {created,comments};}};
}
test('agent review applies selected actions once, preserves automation depth and rolls back a failed batch',async()=>{
 const f=await reviewFixture();const first=await f.m.applyAgentRun(user,40,{indices:[0,1]});assert.equal(first.status,'completed');assert.deepEqual(f.writes,{created:1,comments:1});
 assert.equal((await f.m.applyAgentRun(user,40,{indices:[0,1]})).replayed,true);assert.deepEqual(f.writes,{created:1,comments:1});
 const broken=await reviewFixture({failSecond:true});await assert.rejects(()=>broken.m.applyAgentRun(user,40,{indices:[0,1]}),/DB interrupted/);assert.deepEqual(broken.writes,{created:0,comments:0});assert.equal(broken.run.status,'review');
});
test('agent actions refuse stale config, revoked execution identity, invalid choices and unapproved automatic mode',async()=>{
 const stale=await reviewFixture({version:2});await assert.rejects(()=>stale.m.applyAgentRun(user,40),{status:409});assert.equal(stale.writes.created,0);
 const revoked=await reviewFixture({revoked:true});await assert.rejects(()=>revoked.m.applyAgentRun(user,40),{status:403});assert.equal(revoked.writes.created,0);
 const normal=await reviewFixture();await assert.rejects(()=>normal.m.applyAgentRun(user,40,{indices:[9]}),{status:422});await assert.rejects(()=>normal.m.applyAgentRun(user,40,{automatic:true}),{status:403});assert.equal(normal.writes.created,0);
});
test('worker saves a real model response, uses configured profile, and discards a response after cancellation',async()=>{
 for(const cancel of [false,true]){
  const schema=await load('agent-schema.js'),cfg=schema.agentConfigSchema.parse(config());
  const run={id:20,agent_id:2,project_id:3,workspace_id:1,actor_id:7,api_token_id:null,agent_revision:1,status:'queued',trigger_context_json:{}},agent={id:2,project_id:3,workspace_id:1,enabled:true,revision:1,config_json:cfg};let saved=null,calls=0;
  const sources={project:{id:3,name:'Project'},sources:[{kind:'task',id:10,title:'Task'}],refs:[{kind:'task',id:10,version:1}],meta:{included:1,characters:40,omitted:0}};
  const m=await load('agent-runtime.js',{
   'agent-sources.js':{agentActor:forbidden,agentAccess:async()=>{},agentScope:async()=>{},agentActor:async()=>user,validateAgentConfigAccess:async()=>{},collectAgentSources:async()=>sources,checkAgentRefs:async()=>{}},
   'ai-settings.js':{getAiSettings:async()=>({}),chooseAiProfile:(s,k,id)=>{assert.equal(id,profileId);return {id,revision:'v1',model:'custom-model',max_input_chars:12000};},aiProfileKey:()=>''},
   'work-ai.js':{reserveWorkAi:async(u,p,c,id)=>assert.equal(id,profileId)},
   'ai-budget.js':{generateMeteredAi:async(u,p,profile,key,system,prompt)=>{calls++;assert.ok(prompt.includes('Task'));assert.ok(system.includes('Источники'));if(cancel)run.status='cancelled';return {text:JSON.stringify({summary:'Есть риск',actions:[]}),input_tokens:100,output_tokens:20};}},
   'db.js':{transaction:async fn=>fn({query:async(sql,p)=>{if(sql.startsWith("SELECT id FROM ai_agent_runs"))return [[]];if(sql.startsWith("UPDATE ai_agent_runs SET status='running'")){if(run.status!=='queued')return [{affectedRows:0}];run.status='running';return [{affectedRows:1}];}return [[]];}}),one:async sql=>sql.startsWith('SELECT * FROM ai_agents')?agent:sql.startsWith('SELECT status')?{status:run.status}:run,rows:async(sql,p)=>{
    if(sql.startsWith("UPDATE ai_agent_runs SET status='running'")){if(run.status!=='queued')return {affectedRows:0};run.status='running';}
    if(sql.startsWith('UPDATE ai_agent_runs SET status=?')){if(run.status!=='running')return {affectedRows:0};run.status=p[0];saved=JSON.parse(p[1]);}
    return {affectedRows:1};
   }}
  });
  await m.processAgentRun(20);assert.equal(calls,1);assert.equal(run.status,cancel?'cancelled':'completed');assert.equal(saved?.summary,cancel?undefined:'Есть риск');
 }
});
test('saving a scheduled agent binds the current editor and token, persists a UTC next run time',async()=>{
 const schema=await load('agent-schema.js'),cfg=schema.agentConfigSchema.parse({...config(),trigger:{type:'schedule',interval_minutes:60}});let sqlWritten='',params=[],validated=false;
 const module=await load('work-agents.js',{
  'agent-sources.js':{agentActor:forbidden,agentAccess:async()=>({id:3}),agentScope:async()=>{},validateAgentConfigAccess:async(u,p,c,options)=>{validated=options.execute;},collectAgentSources:async()=>{},checkAgentRefs:async()=>{}},
  'agent-runtime.js':{getAgent:async()=>({id:2,project_id:3}),enqueueAgentRun:async()=>{},applyAgentRun:async()=>{},currentRun:forbidden},
  'ai-settings.js':{getAiSettings:async()=>({}),chooseAiProfile:()=>({}),aiProfileKey:forbidden},
  'db.js':{rows:async()=>({affectedRows:1}),transaction:async fn=>fn({query:async(sql,p)=>{if(sql.startsWith('SELECT COUNT'))return [[{total:1}]];if(sql.startsWith('INSERT INTO ai_agents')){sqlWritten=sql;params=p;return [{insertId:2}];}return [[]];}})}
 });
 const response=await module.agentsApi(new Request('https://kontur.test/api/work/agents',{method:'POST',body:JSON.stringify({project_id:3,name:'Scheduled',enabled:true,config:cfg})}),['agents'],{...user,api_token_id:13});
 assert.equal(response.status,201);assert.equal(validated,true);assert.equal(params[5],user.id);assert.equal(params[6],13);assert.ok(Math.abs(Date.parse(params[7].replace(' ','T')+'Z')-Date.now()-3600000)<2000);assert.equal(params[8],user.id);assert.equal((sqlWritten.match(/\?/g)||[]).length,params.length);
});
test('manager can pause an agent even when source rights or model are unavailable',async()=>{
 let writes=0;
 const module=await load('work-agents.js',{
  'agent-runtime.js':{getAgent:async(u,id,p)=>{assert.equal(p,'agent.manage');return {id:2,project_id:3};},enqueueAgentRun:async()=>{},applyAgentRun:async()=>{},currentRun:forbidden},
  'agent-sources.js':{agentActor:forbidden,agentAccess:forbidden,agentScope:forbidden,validateAgentConfigAccess:forbidden,collectAgentSources:forbidden,checkAgentRefs:forbidden},
  'db.js':{transaction:async fn=>fn({query:async(sql)=>{if(sql.startsWith('SELECT'))return [[{id:2,project_id:3,revision:1,name:'Agent',enabled:1,config_json:{},execution_user_id:7}]];if(sql.startsWith('UPDATE'))writes++;return [{affectedRows:1}];}})}
 });
 const response=await module.agentsApi(new Request('https://kontur.test/api/work/agents/2',{method:'PATCH',body:'{"enabled":false,"revision":1}'}),['agents','2'],user);assert.equal(response.status,200);assert.equal(writes,2);
});
