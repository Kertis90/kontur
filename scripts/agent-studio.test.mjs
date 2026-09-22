import test from 'node:test';
import assert from 'node:assert/strict';
import {load} from './test-module-loader.mjs';
const user={id:7,workspace_id:1},profileId='589196e2-160c-410e-8342-a4cbd67b7bda';
const basic={profile_id:profileId,instructions:'Проверь состояние проекта и укажи основания.',trigger:{type:'manual'},sources:{tasks:{enabled:true},quality:{enabled:false}}};
const config=async patch=>(await load('agent-schema.js')).agentConfigSchema.parse({...basic,...patch});
const plain=v=>JSON.parse(JSON.stringify(v));
const reject=async()=>{throw Error('Unexpected side effect');};
const sourceStubs={agentAccess:async()=>{},agentScope:async()=>{},agentActor:async()=>user,validateAgentConfigAccess:async()=>{},collectAgentSources:reject,checkAgentRefs:async()=>{}};

test('old configurations hydrate studio defaults without enabling new writes',async()=>{
 const c=await config();assert.equal(c.flow.nodes.length,0);assert.equal(c.queue_limit,1);assert.equal(c.trigger.schedule.mode,'interval');assert.equal(c.policy.require_citations,false);assert.equal(c.actions.length,0);assert.equal(c.sources.tasks.include_comments,false);
});
test('workflow rejects cycles, missing targets, duplicate IDs and unsafe keys',async()=>{
 const m=await load('agent-flow.js'),a={id:'a',name:'A',type:'template',text:'Text'};
 for(const nodes of [[{...a,next:'a'}],[{...a,next:'missing'}],[a,a],[{...a,id:'constructor'}],[a,{...a,id:'b',next:'a'}]])assert.equal(m.flowSchema.safeParse({nodes}).success,false);
 assert.equal(m.flowSchema.safeParse({nodes:[{...a,next:'b'},{...a,id:'b',next:'$end'}]}).success,true);
 assert.equal(m.conditionSchema.safeParse({rules:[{path:'inputs.constructor',operator:'empty'}]}).success,false);
});
test('typed parameters preserve false and zero, require values and reject unknown keys',async()=>{
 const m=await load('agent-flow.js'),defs=m.inputsSchema.parse([{key:'threshold',label:'Порог',type:'number',default:0},{key:'approve',label:'Да',type:'boolean',required:true}]);
 assert.deepEqual(plain(m.agentInputs(defs,{approve:false})),{threshold:0,approve:false});
 for(const values of [{},{approve:'false'},{approve:false,other:1},{approve:false,threshold:NaN}])assert.throws(()=>m.agentInputs(defs,values),{status:422});
 assert.equal(m.inputsSchema.safeParse([{key:'x',label:'X',type:'number',default:'1'}]).success,false);
});
test('templates never evaluate code, recurse into input or read object prototypes',async()=>{
 const m=await load('agent-flow.js'),context={inputs:{text:'{{inputs.secret}}',secret:'SECRET'}};
 assert.equal(m.renderAgentTemplate('{{inputs.text}} {{inputs.constructor}} {{missing}}',context),'{{inputs.secret}}  ');
 assert.equal(m.readVariable(context,'inputs.__proto__'),undefined);
 assert.equal(m.renderAgentTemplate('${process.env.SECRET}',context),'${process.env.SECRET}');
});
test('conditions use typed comparisons and tolerate absent branch outputs',async()=>{
 const m=await load('agent-flow.js'),c={metrics:{task_count:2},inputs:{ok:false}};
 assert.equal(m.matchesCondition({rules:[{path:'metrics.task_count',operator:'equals',value:'2'}]},c),false);
 assert.equal(m.matchesCondition({rules:[{path:'inputs.ok',operator:'equals',value:false}]},c),true);
 assert.equal(m.matchesCondition({rules:[{path:'steps.skipped.summary',operator:'not_equals',value:''}]},c),false);
 assert.equal(m.matchesCondition({mode:'any',rules:[{path:'metrics.task_count',operator:'greater',value:5},{path:'inputs.ok',operator:'equals',value:false}]},c),true);
});
test('workflow executes selected forward branch, typed output, filter and stop with a trace',async()=>{
 const m=await load('agent-flow.js'),nodes=m.flowSchema.parse({nodes:[
  {id:'score',name:'Оценка',type:'analyze',prompt:'Оцени состояние',fields:[{key:'risk',type:'number'}]},
  {id:'gate',name:'Порог',type:'condition',condition:{rules:[{path:'steps.score.values.risk',operator:'greater',value:5}]},on_true:'keep',on_false:'stop'},
  {id:'keep',name:'Задачи',type:'filter',kinds:['task'],limit:1},
  {id:'text',name:'Текст',type:'template',text:'Риск {{steps.score.values.risk}} · {{metrics.task_count}}'},
  {id:'stop',name:'Готово',type:'stop',text:'{{steps.text.summary}}'}]}),trace=[];
 let calls=0,guards=0;const result=await m.executeAgentFlow({flow:nodes},{sources:[{kind:'task',id:1},{kind:'chat',id:2}]},{analyze:async()=>{calls++;return m.parseNodeOutput('{"summary":"Риск","values":{"risk":8}}',[{key:'risk',type:'number'}]);},onStep:async s=>trace.push(s.status),guard:async()=>guards++});
 assert.equal(calls,1);assert.equal(result.stopped,true);assert.equal(result.summary,'Риск 8 · 1');assert.equal(result.sources.length,1);assert.equal(guards,10);assert.equal(trace.filter(s=>s==='completed').length,5);
 const branch=await m.executeAgentFlow({flow:nodes},{sources:[{kind:'task'}]},{analyze:async()=>({summary:'OK',values:{risk:1}})});assert.equal(branch.trace.length,3);assert.equal(branch.state.steps.keep,undefined);
});
test('model step refuses missing, surplus or wrongly typed output fields and stops after guard rejection',async()=>{
 const m=await load('agent-flow.js'),fields=[{key:'score',type:'number'}];
 for(const text of ['plain text','{"summary":"x","values":{}}','{"summary":"x","values":{"score":"9"}}','{"summary":"x","values":{"score":9,"other":1}}'])assert.throws(()=>m.parseNodeOutput(text,fields),{status:502});
 let calls=0;await assert.rejects(()=>m.executeAgentFlow({flow:{nodes:[{id:'a',name:'A',type:'analyze',prompt:'test'}]}},{sources:[]},{guard:async()=>{throw Object.assign(Error('Revoked'),{status:403});},analyze:async()=>calls++}),{status:403});assert.equal(calls,0);
});
test('overdue metrics use workflow completion and UTC date, not optional progress',async()=>{
 const m=await load('agent-flow.js'),metrics=m.sourceMetrics([{kind:'task',due_date:'2026-09-01',is_done:0},{kind:'task',due_date:'2026-09-01',is_done:1,progress:0},{kind:'task',due_date:'2026-09-22',is_done:false}],new Date('2026-09-22T12:00:00Z'));assert.equal(metrics.overdue_count,1);
});
test('calendar schedule supports half-hour zones, weekly days and DST gap/fold exactly once',async()=>{
 const m=await load('agent-schedule.js'),next=(zone,time,date,mode='daily',weekdays=[1])=>m.nextAgentSchedule({type:'schedule',schedule:{mode,time,timezone:zone,weekdays}},new Date(date)).toISOString();
 assert.equal(next('Asia/Kolkata','09:00','2026-09-22T00:00:00Z'),'2026-09-22T03:30:00.000Z');
 assert.equal(next('Europe/Moscow','09:00','2026-09-22T00:00:00Z','weekly',[1]),'2026-09-28T06:00:00.000Z');
 assert.equal(next('America/New_York','02:30','2026-03-08T06:00:00Z'),'2026-03-09T06:30:00.000Z');
 assert.equal(next('America/New_York','01:30','2026-11-01T04:00:00Z'),'2026-11-01T05:30:00.000Z');
 assert.equal(next('America/New_York','01:30','2026-11-01T05:31:00Z'),'2026-11-02T06:30:00.000Z');
 assert.equal(m.validAgentTimezone('Bad/Timezone'),false);
});
test('action policy constrains target fields, recipients and result citations',async()=>{
 const m=await load('agent-schema.js'),c=await config({actions:['update_task','assign_task','move_task','create_article','chat_message'],policy:{editable_fields:['priority'],allowed_assignee_ids:[8],allowed_stage_ids:[2],article_space_ids:[4],chat_channel_ids:[5]}}),refs=[{kind:'task',id:1}],valid=[{type:'update_task',task_id:1,patch:{priority:'high'}},{type:'assign_task',task_id:1,assignee_id:8},{type:'move_task',task_id:1,stage_id:2},{type:'create_article',space_id:4,title:'Draft',body:'Text'},{type:'chat_message',channel_id:5,body:'Text'}];c.max_actions=10;
 assert.equal(m.parseAgentResult(JSON.stringify({summary:'Done',actions:valid,citations:refs}),c,refs).actions.length,5);
 for(const action of [{...valid[0],patch:{title:'Disallowed'}},{...valid[1],assignee_id:9},{...valid[2],stage_id:3},{...valid[3],space_id:7},{...valid[4],channel_id:6},{...valid[0],task_id:99}])assert.throws(()=>m.parseAgentResult(JSON.stringify({summary:'Done',actions:[action]}),c,refs),{status:502});
 assert.throws(()=>m.parseAgentResult('{"summary":"x","citations":[{"kind":"chat","id":5}]}',c,refs),{status:502});
});
test('quality gates demand review for low confidence, missing evidence or missing reasons',async()=>{
 const m=await load('agent-schema.js'),c=await config({policy:{min_confidence:.8,require_citations:true,require_reasons:true}});
 assert.equal(m.agentResultWarnings({confidence:null,citations:[],actions:[{type:'comment'}]},c).length,3);
 assert.equal(m.agentResultWarnings({confidence:.9,citations:[{kind:'task',id:1}],actions:[{reason:'Observed delay'}]},c).length,0);
});
test('custom attribute rights are checked and only selected values enter context',async()=>{
 let allow=false;const m=await load('agent-extra-sources.js',{'work-access.js':{fieldAccess:async()=>[{field_code:'secret',can_read:allow}]},'db.js':{rows:async()=>[{code:'secret'},{code:'public'}]}});
 await assert.rejects(()=>m.agentCustomAccess(user,3,['secret']),{status:403});allow=true;await m.agentCustomAccess(user,3,['secret']);
 const task=await m.enrichAgentTask(user,{id:1,project_id:3,version_number:1,custom_values_json:{secret:'S',public:'P'}},{custom_fields:['public']});assert.deepEqual(plain(task.data.custom_values),{public:'P'});assert.equal(task.data.custom_values_json,undefined);assert.equal(task.ref.field_codes[0],'public');
});
test('chat source checks membership, project boundary and edits of referenced messages',async()=>{
 let member=false,body='original';const common=await load('work-common.js');const m=await load('agent-extra-sources.js',{'api-access.js':{apiBackgroundAllowed:async()=>true},'work-common.js':{...common,projectFor:async()=>({id:3})},'db.js':{one:async(sql,p)=>sql.includes('FROM chat_channels')?{id:5,project_id:p[0]===99?4:null}:sql.includes('FROM chat_rooms')?null:member?{user_id:7}:null,rows:async()=>[{id:8,sender_id:7,body,edited_at:null,created_at:'2026-09-22'}]}});
 await assert.rejects(()=>m.agentChatAccess(user,5,3),{status:403});member=true;await m.agentChatAccess(user,5,3);await assert.rejects(()=>m.agentChatAccess(user,99,3),{status:403});
 const ref={kind:'chat',id:5,messages:[{id:8,hash:m.sourceHash({id:8,sender_id:7,body,edited_at:null,created_at:'2026-09-22'})}]};await m.checkExtraAgentRef(user,3,ref);body='edited';await assert.rejects(()=>m.checkExtraAgentRef(user,3,ref),{status:409});
});
test('recording output is hidden after transcription changes or recording access is revoked',async()=>{
 let version='v1',revoked=false;const m=await load('agent-extra-sources.js',{'api-access.js':{apiBackgroundAllowed:async()=>true},'recordings.js':{recordingConferenceAccess:async()=>({id:2,project_id:3}),assertRecording:async()=>{if(revoked)throw Object.assign(Error('Revoked'),{status:403});return {transcript_status:'completed',transcript_revision:version};}}});
 const ref={kind:'recording',id:1,conference_id:2,version:'v1'};await m.checkExtraAgentRef(user,3,ref);version='v2';await assert.rejects(()=>m.checkExtraAgentRef(user,3,ref),{status:409});revoked=true;await assert.rejects(()=>m.checkExtraAgentRef(user,3,ref),{status:403});
});

async function workerFixture({dry=false,gate=false,disabled=false,condition=false,active=false}={}){
 const c=await config({actions:['comment'],mode:'automatic',policy:{require_reasons:gate},...(condition?{trigger:{type:'manual',conditions:{rules:[{path:'metrics.task_count',operator:'greater',value:9}]}}}:{})}),run={id:20,agent_id:2,project_id:3,workspace_id:1,actor_id:7,api_token_id:null,agent_revision:1,status:'queued',config_json:c,trigger_context_json:{dry_run:dry}},agent={id:2,project_id:3,workspace_id:1,enabled:!disabled,revision:1,config_json:c};let calls=0,writes=0;const steps=[];
 const m=await load('agent-runtime.js',{
  'agent-sources.js':{...sourceStubs,collectAgentSources:async()=>({project:{id:3},sources:[{kind:'task',id:10,title:'Task'}],refs:[{kind:'task',id:10,version:1}],meta:{included:1,characters:60}})},
  'agent-actions.js':{assertAgentAction:reject,executeAgentAction:async()=>{writes++;},agentActionPrompt:()=>''},
  'ai-settings.js':{getAiSettings:async()=>({}),chooseAiProfile:()=>({id:profileId,revision:'v1',model:'test',max_input_chars:12000}),aiProfileKey:()=>''},
  'work-ai.js':{reserveWorkAi:async()=>{}},'ai-budget.js':{generateMeteredAi:async()=>{calls++;return {text:JSON.stringify({summary:'Анализ',actions:[{type:'comment',task_id:10,body:'Question'}]}),input_tokens:100,output_tokens:20};}},
  'db.js':{one:async sql=>sql.startsWith('SELECT * FROM ai_agents')?agent:sql.startsWith('SELECT status')?{status:run.status}:run,transaction:async fn=>fn({query:async(sql)=>{
   if(sql.startsWith('SELECT id FROM ai_agent_runs'))return [active?[{id:19}]:[]];if(sql.startsWith("UPDATE ai_agent_runs SET status='running'")){run.status='running';return [{affectedRows:1}];}return [[]];
  }}),rows:async(sql,p)=>{
   if(sql.startsWith('INSERT INTO ai_agent_run_steps'))steps.push({id:p[1],status:p[5]});
   if(sql.startsWith('UPDATE ai_agent_runs SET source_refs_json=')){run.source_refs_json=JSON.parse(p[0]);run.source_meta_json=JSON.parse(p[1]);}
   if(sql.startsWith('UPDATE ai_agent_runs SET status=?')){run.status=p[0];run.result_json=JSON.parse(p[1]);run.source_meta_json=JSON.parse(p[2]);}
   if(sql.startsWith("UPDATE ai_agent_runs SET status='failed'")){run.status='failed';run.error_text=p[0];}
   return {affectedRows:1};
  }}
 });return {m,run,steps,get calls(){return calls;},get writes(){return writes;}};
}
test('dry run executes a paused automatic agent, persists proposals and cannot apply them',async()=>{
 const f=await workerFixture({dry:true,disabled:true});await f.m.processAgentRun(20);assert.equal(f.calls,1);assert.equal(f.run.status,'completed');assert.equal(f.run.result_json.actions.length,1);assert.equal(f.run.source_meta_json.dry_run,true);assert.equal(f.writes,0);assert.deepEqual(f.steps.map(s=>s.status),['running','completed']);
 await assert.rejects(()=>f.m.applyAgentRun(user,20),{status:409});assert.equal(f.writes,0);
});
test('automatic result failing quality policy stays review without applying writes',async()=>{
 const f=await workerFixture({gate:true});await f.m.processAgentRun(20);assert.equal(f.calls,1);assert.equal(f.run.status,'review');assert.equal(f.run.source_meta_json.review_required,true);assert.equal(f.writes,0);await assert.rejects(()=>f.m.applyAgentRun(user,20,{automatic:true}),{status:409});
});
test('unmatched trigger conditions cost zero model calls and a running sibling blocks the queue claim',async()=>{
 const f=await workerFixture({condition:true});await f.m.processAgentRun(20);assert.equal(f.run.status,'completed');assert.equal(f.calls,0);
 const busy=await workerFixture({active:true});await busy.m.processAgentRun(20);assert.equal(busy.run.status,'queued');assert.equal(busy.calls,0);
});
test('request fingerprint rejects reused IDs with changed inputs or test mode',async()=>{
 const c=await config({inputs:[{key:'focus',label:'Фокус',type:'string'}]}),agent={id:2,project_id:3,enabled:false,revision:1,config:c};let previous=null;
 const m=await load('agent-runtime.js',{'agent-sources.js':sourceStubs,'db.js':{transaction:async fn=>fn({query:async(sql,p)=>{if(sql.startsWith('SELECT * FROM ai_agents'))return [[agent]];if(sql.startsWith('SELECT r.id,r.status'))return [previous?[previous]:[]];if(sql.startsWith('SELECT SUM'))return [[{pending:0,reviews:0,today:0}]];if(sql.startsWith('INSERT INTO ai_agent_runs'))return [{insertId:20}];if(sql.startsWith('INSERT INTO ai_agent_run_state'))previous={id:20,status:'queued',context_fingerprint:p[2]};return [{affectedRows:1}];}})}});
 const first=await m.enqueueAgentRun(user,agent,{key:'test',dryRun:true,context:{inputs:{focus:'A'}}});assert.equal(first.id,20);assert.equal((await m.enqueueAgentRun(user,agent,{key:'test',dryRun:true,context:{inputs:{focus:'A'}}})).replayed,true);
 await assert.rejects(()=>m.enqueueAgentRun(user,agent,{key:'test',dryRun:true,context:{inputs:{focus:'B'}}}),{status:409});agent.enabled=true;await assert.rejects(()=>m.enqueueAgentRun(user,agent,{key:'test',context:{inputs:{focus:'A'}}}),{status:409});
});
test('several edits of one task carry forward versions and use the common task gate path',async()=>{
 const common=await load('work-common.js'),seen=[],versions=new Map([[10,1]]);let current=1;
 const m=await load('agent-actions.js',{'work-common.js':{...common,projectFor:async()=>({id:3})},'agent-extra-sources.js':{extraScope:async()=>{},agentKnowledgeAccess:reject,agentChatAccess:reject},'work-tasks.js':{createWorkTask:reject,changeTask:async(u,id,patch,c,opts)=>{seen.push({...opts,patch});assert.equal(opts.version,current);current++;return {task_id:id,version_number:current};}}});
 const db={query:async()=>[[{id:10,project_id:3,version_number:current}]]};await m.executeAgentAction(user,{id:4,project_id:3},{type:'update_task',task_id:10,patch:{priority:'high'}},db,versions);await m.executeAgentAction(user,{id:4,project_id:3},{type:'move_task',task_id:10,stage_id:2},db,versions);assert.equal(versions.get(10),3);assert.equal(seen[1].version,2);assert.equal(seen[1].depth,1);
});
test('new endpoints require correct scopes independent of project permissions',async()=>{
 const m=await load('api-access.js');for(const [path,scope,method='POST']of [['agents/1/test','agents:run'],['agents/runs/1/feedback','agents:run'],['agents/import','agents:write'],['agents/1/restore','agents:write'],['agents/1/export','agents:read','GET'],['agents/analytics','agents:read','GET']]){const req=new Request('https://test/api/work/'+path,{method}),token={api_token_id:1,api_enabled:true,scopes_json:[scope],allowed_scopes_json:[scope]};assert.equal(m.apiRequestError(token,req),null);assert.ok(m.apiRequestError({...token,scopes_json:[]},req));}
});
test('restoring an old version is optimistic, snapshots history, rebinds editor and pauses execution',async()=>{
 const c=await config(),saved=[],agent={id:2,project_id:3,workspace_id:1,revision:4,enabled:1,name:'Current',execution_user_id:5,config_json:c};
 const m=await load('work-agents.js',{'agent-sources.js':sourceStubs,'agent-runtime.js':{getAgent:async()=>({...agent,config:c}),enqueueAgentRun:reject,applyAgentRun:reject,currentRun:reject},'db.js':{one:async()=>({name:'Old',config_json:c}),transaction:async fn=>fn({query:async(sql,p)=>{if(sql.startsWith('SELECT * FROM ai_agents'))return [[agent]];if(sql.startsWith('UPDATE ai_agents SET'))saved.push({update:p});if(sql.startsWith('INSERT IGNORE INTO ai_agent_versions'))saved.push({snapshot:p});return [[]];}})}});
 const req=revision=>new Request('https://test/api/work/agents/2/restore',{method:'POST',body:JSON.stringify({revision,version:1})});const result=await m.agentsApi(req(4),['agents','2','restore'],user);assert.equal((await result.json()).revision,5);assert.equal(saved.filter(x=>x.snapshot).length,2);const update=saved.find(x=>x.update).update;assert.equal(update[0],'Old');assert.equal(update[1],false);assert.equal(update[4],user.id);assert.equal(update[6],null);await assert.rejects(()=>m.agentsApi(req(3),['agents','2','restore'],user),{status:409});
});
