import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { conditionsMatch, traceFlow, automationSchema } from "../src/lib/automation-flow.js";
import { capacityDays, dateRange, portfolioSchedule } from "../src/lib/planning-math.js";
const parseJson = (value, fallback = {}) => typeof value === "string" ? JSON.parse(value) : value ?? fallback;
const fail = async () => { throw new Error("Unexpected infrastructure operation"); };
async function load(name, overrides = {}, env = {}, globals = {}) {
  const context = vm.createContext({ console, Buffer, URL, URLSearchParams, Request, Response, Headers, FormData, Blob, TextEncoder, TextDecoder, ReadableStream, AbortSignal, AbortController, Date, setTimeout, clearTimeout, setInterval, clearInterval, process: { env }, fetch: fail, ...globals });
  const modules = new Map();
  const stubs = { "db.js": { one: fail, rows: fail, transaction: fail, db: { query: fail }, parseJson }, "audit.js": { audit: async () => {} }, ...overrides };
  stubs["db.js"] = { one: fail, rows: fail, transaction: fail, db: { query: fail }, parseJson, ...overrides["db.js"] };
  function synthetic(values, identifier) { return new vm.SyntheticModule(Object.keys(values), function () { for (const [key,value] of Object.entries(values)) this.setExport(key,value); }, { context, identifier }); }
  async function moduleFor(identifier) {
    if (modules.has(identifier)) return modules.get(identifier);
    const base = identifier.split("/").at(-1);
    let module;
    if (stubs[identifier] || stubs[base]) module = synthetic(stubs[identifier] || stubs[base], identifier);
    else if (!identifier.startsWith("file:")) module = synthetic(await import(identifier), identifier);
    else module = new vm.SourceTextModule(await fs.readFile(new URL(identifier), "utf8"), { context, identifier });
    modules.set(identifier, module); return module;
  }
  const root = await moduleFor(new URL(`../src/lib/${name}`, import.meta.url).href);
  await root.link((specifier, referencing) => moduleFor(specifier.startsWith(".") ? new URL(specifier.endsWith(".js") ? specifier : `${specifier}.js`, referencing.identifier).href : specifier));
  await root.evaluate(); return root.namespace;
}
test('automation chooses one branch, AND/OR conditions and dry-run does not mutate context',()=>{
  const context={priority:'high',custom_values:{customer:'A'},progress:25};
  const group={mode:'any',conditions:[{field:'priority',operator:'equals',value:'low'},{field:'custom_values.customer',operator:'equals',value:'A'}]};
  assert.equal(conditionsMatch(group,context),true);assert.equal(conditionsMatch({...group,mode:'all'},context),false);
  const flow=traceFlow([{type:'branch',condition:group,then:[{type:'set_field',field:'progress',value:100}],else:[{type:'notify_user',userId:3}]}],context);
  assert.equal(flow.length,2);assert.equal(flow[1].path,'0.then.0');assert.equal(flow[1].action.type,'set_field');assert.equal(context.progress,25);
});
test('automation rejects unknown actions and excessive depth',()=>{
  const base={name:'Правило',trigger_type:'scheduled',actions:[{type:'exec_shell',command:'invalid'}]};assert.equal(automationSchema.safeParse(base).success,false);
  let action={type:'notify_assignee',title:'Напоминание'};for(let i=0;i<7;i++)action={type:'branch',condition:{mode:'all',conditions:[]},then:[action],else:[]};
  assert.equal(automationSchema.safeParse({...base,actions:[action]}).success,false);
});
test('capacity combines projects, part time, overlapping leave and non-working days',()=>{
  const dates=dateRange('2026-09-07','2026-09-13');
  const result=capacityDays(2,dates,[0,4,4,4,4,4,0],[{user_id:2,start_date:'2026-09-08',end_date:'2026-09-08',unavailable_percent:50},{user_id:null,start_date:'2026-09-09',end_date:'2026-09-09',unavailable_percent:100}],[{user_id:2,start_date:dates[0],end_date:dates.at(-1),hours_per_day:3},{user_id:2,start_date:dates[0],end_date:dates.at(-1),hours_per_day:2}]);
  assert.deepEqual(result.slice(0,3).map(x=>[x.available,x.planned,x.overload]),[[4,5,1],[2,5,3],[0,5,5]]);assert.equal(result[6].planned,0);
  assert.throws(()=>dateRange('2026-10-01','2026-09-01'));
});
test('portfolio propagates cross-project shifts and computes slack from final finish',()=>{
  const tasks=[{id:1,project_id:1,start_date:'2026-09-01',due_date:'2026-09-03'},{id:2,project_id:2,start_date:'2026-09-02',due_date:'2026-09-04'},{id:3,project_id:1,start_date:'2026-09-01',due_date:'2026-09-01'}];
  const result=portfolioSchedule(tasks,[{task_id:2,depends_on_task_id:1}],{1:2});
  assert.equal(result.tasks.find(t=>t.id===2).start_date,'2026-09-06');assert.equal(result.tasks.find(t=>t.id===2).due_date,'2026-09-08');assert.equal(result.tasks.find(t=>t.id===3).critical,false);assert.equal(result.tasks.find(t=>t.id===1).critical,true);assert.equal(tasks[0].start_date,'2026-09-01');
  assert.equal(portfolioSchedule(tasks,[{task_id:2,depends_on_task_id:1},{task_id:1,depends_on_task_id:2}]).cycle,true);
});
test('approval order, substitutes and terminal decisions are enforced',async()=>{
  const module=await load('work-planning.js');const steps=[{id:1,position:0,reviewer_id:2,substitute_id:4,decision:'pending'},{id:2,position:1,reviewer_id:3,decision:'pending'}],request={status:'pending',mode:'sequential'};
  assert.equal(module.canDecideApproval(request,steps,steps[1],3),false);assert.equal(module.canDecideApproval(request,steps,steps[0],4),true);assert.equal(module.canDecideApproval(request,steps,steps[0],9),false);
  assert.equal(module.canDecideApproval({...request,mode:'parallel'},steps,steps[1],3),true);assert.equal(module.canDecideApproval({...request,status:'cancelled'},steps,steps[0],2),false);
  assert.equal(module.approvalOutcome('parallel',steps.map(s=>({...s,decision:'approved'}))),'approved');assert.equal(module.approvalOutcome('parallel',[...steps,{decision:'rejected'}]),'rejected');
});
test('restricted custom fields disappear from current values and JSON without changing source',async()=>{
  const module=await load('work-access.js');const task={custom_values:{cost:123,team:'A'},custom_values_json:'{"cost":123,"team":"A"}'};
  const safe=module.redactFields(task,[{field_code:'cost',can_read:false,can_edit:false}]);assert.equal(safe.custom_values.cost,undefined);assert.equal(JSON.parse(safe.custom_values_json).cost,undefined);assert.equal(safe.custom_values.team,'A');assert.equal(task.custom_values.cost,123);
});
test('field policy applies recursively to historical changes',async()=>{
  const db={parseJson,rows:async(sql)=>sql.includes('SELECT DISTINCT f.project_id')?[{project_id:7}]:sql.includes('FROM task_field_access')?[{field_code:'cost',readers_json:[],editors_json:[]}]:sql.includes('SELECT id,project_id FROM tasks')?[{id:1,project_id:7}]:[],one:fail};
  const module=await load('work-access.js',{'db.js':db,'permissions.js':{projectPermissionSet:async()=>new Set(),workspacePermissionSet:async()=>new Set(),PROJECT_MEMBERSHIP_DEFAULTS:{}}});
  const result=await module.sanitizeWorkResponse({id:2,workspace_id:1,global_role:'member'},{history:[{task_id:1,changes_json:'{"custom_values":{"cost":321,"team":"B"}}'}]});assert.equal(result.history[0].changes_json.custom_values.cost,undefined);assert.equal(result.history[0].changes_json.custom_values.team,'B');
});
test('optimistic task updates reject stale versions before any write',async()=>{
  let writes=0;const module=await load('work-tasks.js',{'work-access.js':{assertFieldEdits:async()=>{}},'permissions.js':{projectPermissionSet:async()=>new Set(['task.edit']),workspacePermissionSet:async()=>new Set()},'db.js':{parseJson,one:async()=>({id:7,workspace_id:1,status:'active'}),rows:fail}});
  const c={query:async sql=>{if(sql.startsWith('SELECT * FROM tasks'))return [[{id:1,project_id:7,version_number:3}]];writes++;return [{affectedRows:1}];}};
  await assert.rejects(module.changeTask({id:2,workspace_id:1},1,{priority:'high'},c,{version:2}),e=>e.status===409);assert.equal(writes,0);
});
test('gate binds the approval to the exact task version and blocks content changes during transition',async()=>{
  let approved=false;const module=await load('work-tasks.js',{'work-access.js':{assertFieldEdits:async()=>{}},'db.js':{parseJson,rows:async(sql,args)=>{if(sql.includes('approval_gates'))return [{required_fields_json:['assignee_id']}];if(sql.includes("status='approved'")){assert.equal(args[1],3);return approved?[{id:5}]:[];}return [];}}});
  const task={id:1,project_id:7,stage_id:1,version_number:3,assignee_id:2,title:'Исходное название'};
  await assert.rejects(module.assertTaskGates({id:2},task,{stage_id:2}),e=>e.status===409);approved=true;
  await module.assertTaskGates({id:2},task,{stage_id:2});await assert.rejects(module.assertTaskGates({id:2},task,{stage_id:2,title:'Изменено после проверки'}),e=>e.status===409);
});
test('repeated offline operation returns the stored result without another comment',async()=>{
  const stored={comment_id:5};let mutations=0;const payload={operation_id:crypto.randomUUID(),kind:'comment.create',task_id:1,data:{body:'Комментарий'}};const fingerprint=crypto.createHash('sha256').update(JSON.stringify({data:payload.data,kind:payload.kind,operation_id:payload.operation_id,task_id:payload.task_id})).digest('hex');
  const module=await load('work-personal.js',{'db.js':{parseJson,rows:fail,one:fail,transaction:async work=>work({query:async sql=>{if(sql.includes('SELECT id FROM users'))return [[{id:2}]];if(sql.includes('SELECT result_json,request_hash FROM offline_operations'))return [[{result_json:stored,request_hash:fingerprint}]];mutations++;throw new Error(sql);}})}});
  const request=new Request('http://test/api/work/offline',{method:'POST',body:JSON.stringify(payload)});
  assert.deepEqual(await (await module.personalApi(request,['offline'],{id:2})).json(),stored);assert.equal(mutations,0);
  await assert.rejects(module.personalApi(new Request('http://test/api/work/offline',{method:'POST',body:JSON.stringify({...payload,data:{body:'Другое сообщение'}})}),['offline'],{id:2}),e=>e.status===409);
});
test('expired recording cannot be read even before S3 cleanup',async()=>{
  const module=await load('recordings.js',{'db.js':{parseJson,rows:fail,transaction:fail,one:async sql=>sql.includes('conference_recordings')?{id:1,retained_until:'2000-01-01'}:sql.includes('conference_participants')?{user_id:2}:{id:10,project_id:7,created_by:2}},'permissions.js':{hasProjectPermission:async()=>true,projectPermissionSet:async()=>new Set()}});
  await assert.rejects(module.assertRecording({id:2,workspace_id:1},10,1),e=>e.status===404);
});
test('CSV parser preserves multiline and escaped quotes and rejects malformed records',async()=>{
  const module=await load('work-import.js');const parsed=module.parseWorkCsv('\ufeffKey,Summary,Description\r\nA-1,"Тест, пример","Строка 1\nСтрока ""2"""');
  assert.equal(parsed.records[0].Summary,'Тест, пример');assert.equal(parsed.records[0].Description,'Строка 1\nСтрока "2"');assert.throws(()=>module.parseWorkCsv('a,b\n"broken'));
  const normalized=module.normalizeImport('csv','Key,Summary,Description\nA-1,Task,Private',{description:''});assert.equal(normalized.records[0].description,'');
});
test('Jira structured descriptions and custom mapping normalize predictably',async()=>{
  const module=await load('work-import.js');const result=module.normalizeImport('jira_json',JSON.stringify({issues:[{key:'OLD-1',fields:{summary:'Задача',description:{content:[{content:[{text:'Описание'}]}]},status:{name:'Готово'}}}]}));
  assert.equal(result.records[0].description,'Описание');assert.equal(result.records[0].key,'OLD-1');assert.equal(result.records[0].status,'Готово');
});
test('GitHub and GitLab reject tampered webhook deliveries',async()=>{
  const module=await load('work-development.js');const secret="It's a Secret to Everybody",raw='Hello, World!';const signature=`sha256=${crypto.createHmac('sha256',secret).update(raw).digest('hex')}`;
  assert.equal(module.verifyDevelopmentSignature('github',secret,raw,new Headers({'x-hub-signature-256':signature})),true);assert.equal(module.verifyDevelopmentSignature('github',secret,raw+'!',new Headers({'x-hub-signature-256':signature})),false);
  assert.equal(module.verifyDevelopmentSignature('gitlab','secret',raw,new Headers({'x-gitlab-token':'secret'})),true);assert.equal(module.verifyDevelopmentSignature('gitlab','secret',raw,new Headers({'x-gitlab-token':'wrong'})),false);
});
test('development payloads link merge requests, branch names and build status',async()=>{
  const module=await load('work-development.js');const events=module.developmentEntries('github',{ref:'refs/heads/NOVA-1-feature',commits:[{id:'sha',message:'NOVA-1 Исправление',url:'https://git/repo/commit/sha'}],workflow_run:{id:42,name:'CI',head_branch:'NOVA-1-feature',status:'completed',conclusion:'success'}});
  assert.deepEqual(Array.from(events,x=>x.kind),['commit','branch','pipeline']);assert.equal(events[2].state,'success');
});
test('quiet hours cross midnight in the selected browser timezone',async()=>{
  const module=await load('work-personal.js');const p={timezone:'Europe/Moscow',quiet_start:'22:00',quiet_end:'08:00'};
  assert.equal(module.localNotificationTime(p,new Date('2026-09-09T20:00:00Z')).quiet,true);assert.equal(module.localNotificationTime(p,new Date('2026-09-10T04:00:00Z')).quiet,true);assert.equal(module.localNotificationTime(p,new Date('2026-09-10T05:00:00Z')).quiet,false);
});
test('AI search token needs all source scopes; accepting an action needs task write',async()=>{
  const module=await load('api-access.js');const token={api_token_id:1,api_enabled:true,scopes_json:['ai:write'],allowed_scopes_json:['ai:write','tasks:write','tasks:read','knowledge:read','conference:read']};
  const search=new Request('http://test/api/work/ai-search',{method:'POST'});assert.match(module.apiRequestError(token,search),/tasks:read/);
  assert.equal(module.apiRequestError({...token,scopes_json:token.allowed_scopes_json},search),null);
  assert.match(module.apiRequestError(token,new Request('http://test/api/work/meeting-actions/10/1',{method:'PATCH'})),/tasks:write/);
});
test('AI action parser requires valid dates and explicit structured output',async()=>{
  const module=await load('work-ai.js');const result=module.parseActionSuggestions('[{"title":"Подготовить план","source_text":"Нужен план"}]');assert.equal(result[0].assignee_id,null);assert.equal(result[0].due_date,null);
  assert.throws(()=>module.parseActionSuggestions('[{"title":"План","due_date":"2026-02-30"}]'));assert.throws(()=>module.parseActionSuggestions('Готово!'));
});
test('concurrent edits to the same knowledge block reject stale revisions before mutation',async()=>{
  const article={id:4,space_id:7,status:'draft',body:'Первый текст',version_number:3};let writes=0;
  const module=await load('work-knowledge.js',{'knowledge-access.js':{knowledgeSpaceAccess:async()=>({level:'edit'}),knowledgeAccessAtLeast:(actual,required)=>actual==='edit'||required==='view'},'db.js':{one:async sql=>sql.includes('FROM knowledge_crdt')?null:article,transaction:async work=>work({query:async sql=>{if(sql.startsWith('SELECT * FROM knowledge_articles'))return [[article]];if(sql.startsWith('SELECT * FROM knowledge_blocks'))return [[{id:'dad3c9e6-dfa3-45cd-9473-a591623b659c',revision:2,body:'Правка коллеги'}]];writes++;throw new Error(sql);}})}});
  const request=new Request('http://test/api/work/knowledge/4/blocks/dad3c9e6-dfa3-45cd-9473-a591623b659c',{method:'PATCH',body:JSON.stringify({revision:1,body:'Моя правка'})});
  await assert.rejects(module.knowledgeWorkApi(request,['knowledge','4','blocks','dad3c9e6-dfa3-45cd-9473-a591623b659c'],{id:2,workspace_id:1}),e=>e.status===409&&e.details.block.body==='Правка коллеги');assert.equal(writes,0);
});
test('meeting action quota selects the conference model and rejects exhausted combined usage',async()=>{
  let writes=0;const selected=[];const settings={daily_user_limit:10};
  const module=await load('work-ai.js',{'ai-settings.js':{getAiSettings:async()=>settings,chooseAiProfile:(_settings,purpose)=>{selected.push(purpose);return {};},aiProfileKey:()=>''},'db.js':{transaction:async work=>work({query:async sql=>{if(sql.startsWith('SELECT id FROM workspaces'))return [[{id:1}]];if(sql.includes('FROM work_ai_requests'))return [[{total:10}]];writes++;throw new Error(sql);}})}});
  await assert.rejects(module.reserveWorkAi({id:2,workspace_id:1},'meeting_actions'),e=>e.status===429);assert.deepEqual(selected,['conference']);assert.equal(writes,0);
});
