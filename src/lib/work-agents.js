import {designAgent,previewAgentActions} from './agent-workbench.js';
import {agentPartsApi,resolveFlowParts} from './agent-parts.js';
import {agentDebugRun,loadDebugContext,checkReplaySources} from './agent-debug.js';
import {agentEvaluationsApi} from './agent-evaluations.js';
import {decideAgentGate} from './agent-checkpoints.js';
import {agentLifecycleApi,readAgentDraft} from './agent-lifecycle.js';
import {agentIdentityApi,identityActor} from './agent-identities.js';
import {z} from 'zod';
import {one,rows,transaction,parseJson} from './db.js';
import {body,reply,positiveId,WorkError} from './work-common.js';
import {agentSchema,agentConfigSchema} from './agent-schema.js';
import {agentAccess,agentScope,validateAgentConfigAccess,collectAgentSources,checkAgentRefs} from './agent-sources.js';
import {agentCustomFields,agentChatAccess} from './agent-extra-sources.js';
import {agentInputs,agentContextBudget,sourceMetrics,matchesCondition} from './agent-flow.js';
import {nextAgentSchedule,agentSqlDate} from './agent-schedule.js';
import {getAgent,enqueueAgentRun,applyAgentRun,currentRun} from './agent-runtime.js';
import {getAiSettings,chooseAiProfile} from './ai-settings.js';
import {knowledgeAccessMap,knowledgeAccessAtLeast} from './knowledge-access.js';
import {apiBackgroundAllowed} from './api-access.js';
import {recordingConferenceAccess,assertRecording} from './recordings.js';
import {audit} from './audit.js';
const safeAgent=({config_json,execution_api_token_id,...a})=>({...a,enabled:Boolean(a.enabled),config:agentConfigSchema.parse(parseJson(config_json)),uses_api_token:Boolean(execution_api_token_id)});
const rawInputs=z.record(z.union([z.string().max(4000),z.number().finite(),z.boolean()])).default({});
async function versionSnapshot(c,agent,userId){await c.query('INSERT IGNORE INTO ai_agent_versions(agent_id,revision,name,enabled,config_json,saved_by) VALUES(?,?,?,?,?,?)',[agent.id,agent.revision,agent.name,Boolean(agent.enabled),typeof agent.config_json==='string'?agent.config_json:JSON.stringify(agent.config_json),userId]);}
export async function saveAgent(user,input,id=null,{connection=null,executor=user,identityId=null}={}){
 const d=agentSchema.parse(input);await agentAccess(user,d.project_id,'agent.manage',true);await validateAgentConfigAccess(user,d.project_id,d.config,{execute:d.enabled});
 if(executor.id!==user.id)await validateAgentConfigAccess(executor,d.project_id,d.config,{execute:d.enabled});
 if(d.enabled){const settings=await getAiSettings(user.workspace_id);chooseAiProfile(settings,'project',d.config.profile_id);for(const node of d.config.flow.nodes)if(node.type==='analyze')chooseAiProfile(settings,'project',node.profile_id||d.config.profile_id);}
 const next=d.enabled?agentSqlDate(nextAgentSchedule(d.config.trigger)):null;
 const persist=async c=>{
  await c.query('SELECT id FROM projects WHERE id=? FOR UPDATE',[d.project_id]);
  let agentId=id,revision=1;
  if(id){
   const [[current]]=await c.query('SELECT * FROM ai_agents WHERE id=? AND workspace_id=? FOR UPDATE',[id,user.workspace_id]);
   if(!current||Number(current.project_id)!==d.project_id)throw new WorkError(403,'Агент другого проекта или недоступен');
   if(current.revision!==d.revision)throw new WorkError(409,'Агент изменён другим пользователем. Обновите страницу');
   await versionSnapshot(c,current,current.execution_user_id);revision=current.revision+1;
   await c.query('UPDATE ai_agents SET name=?,enabled=?,config_json=?,revision=?,execution_user_id=?,execution_api_token_id=?,next_run_at=?,last_error=NULL WHERE id=?',[d.name,d.enabled,JSON.stringify(d.config),revision,executor.id,executor.api_token_id||null,next,id]);
  }else{
   const [[count]]=await c.query('SELECT COUNT(*) AS total FROM ai_agents WHERE project_id=?',[d.project_id]);if(Number(count.total)>=100)throw new WorkError(422,'В проекте можно создать до 100 агентов');
   const [created]=await c.query('INSERT INTO ai_agents(workspace_id,project_id,name,enabled,config_json,execution_user_id,execution_api_token_id,next_run_at,created_by) VALUES(?,?,?,?,?,?,?,?,?)',[user.workspace_id,d.project_id,d.name,d.enabled,JSON.stringify(d.config),executor.id,executor.api_token_id||null,next,user.id]);agentId=created.insertId;
  }
  await c.query('INSERT INTO ai_agent_deployments(agent_id,published,identity_id,published_by,published_at) VALUES(?,TRUE,?,?,CURRENT_TIMESTAMP) ON DUPLICATE KEY UPDATE published=TRUE,identity_id=VALUES(identity_id),published_by=VALUES(published_by),published_at=CURRENT_TIMESTAMP',[agentId,identityId,user.id]);
  await versionSnapshot(c,{id:agentId,revision,name:d.name,enabled:d.enabled,config_json:d.config},user.id);
  await c.query("UPDATE ai_agent_runs SET status='cancelled',error_text='Конфигурация агента изменена',completed_at=CURRENT_TIMESTAMP WHERE agent_id=? AND status IN ('queued','running','review') AND agent_revision<>?",[agentId,revision]);return {id:agentId,revision};
 };return connection?persist(connection):transaction(persist);
}
async function runFor(user,id){const run=await one('SELECT * FROM ai_agent_runs WHERE id=? AND workspace_id=?',[positiveId.parse(id),user.workspace_id]);if(!run)throw new WorkError(404,'Запуск не найден');await agentAccess(user,run.project_id);return run;}
// Обрабатывает настройки и историю агентов, включая разбор входов и безопасный повтор запуска.
export async function agentsApi(request,path,user){
 const method=request.method,params=new URL(request.url).searchParams;
 if(path[1]==='parts')return agentPartsApi(request,path,user);
 if(path[1]==='design'&&method==='POST')return designAgent(request,user);
 if(path[2]==='evaluations')return agentEvaluationsApi(request,path,user,{getAgent});
 if(path[1]==='identities')return agentIdentityApi(request,path,user);
 if(path[1]==='drafts'||['draft','publish'].includes(path[2]))return agentLifecycleApi(request,path,user,{getAgent,saveAgent});
 if(method==='GET'&&path[1]==='options'){
  const project=await agentAccess(user,positiveId.parse(params.get('project_id'))),settings=await getAiSettings(user.workspace_id);
  const stages=await rows('SELECT id,name FROM workflow_stages WHERE workflow_id=? ORDER BY position',[project.workflow_id]);
  let articles=[],conferences=[],spaces=[],channels=[],recordings=[],fields=[];
  if(await apiBackgroundAllowed(user,user.api_token_id,'knowledge:read')){
   const all=await rows('SELECT * FROM knowledge_spaces WHERE workspace_id=?',[user.workspace_id]),access=await knowledgeAccessMap(user,all);
   spaces=all.filter(s=>knowledgeAccessAtLeast(access.get(Number(s.id))||'none','view')).map(s=>({id:s.id,name:s.name,can_edit:knowledgeAccessAtLeast(access.get(Number(s.id))||'none','edit')}));
   if(spaces.length)articles=await rows(`SELECT a.id,a.title,a.space_id,s.name AS space_name FROM knowledge_articles a JOIN knowledge_spaces s ON s.id=a.space_id WHERE a.status='published' AND a.space_id IN (${spaces.map(()=>'?')}) ORDER BY a.updated_at DESC LIMIT 200`,spaces.map(s=>s.id));
  }
  if(await apiBackgroundAllowed(user,user.api_token_id,'conference:read')){
   const list=await rows('SELECT id,title FROM conferences WHERE project_id=? AND workspace_id=? ORDER BY scheduled_start DESC LIMIT 100',[project.id,user.workspace_id]);
   for(const m of list)try{await recordingConferenceAccess(user,m.id,'ai.conference.summarize');conferences.push(m);}catch(e){if(![403,404].includes(e.status))throw e;}
   const listRecords=await rows("SELECT r.id,r.conference_id,r.created_at,c.title FROM conference_recordings r JOIN conferences c ON c.id=r.conference_id WHERE r.workspace_id=? AND c.project_id=? AND r.deleted_at IS NULL AND r.transcript_status='completed' ORDER BY r.id DESC LIMIT 100",[user.workspace_id,project.id]);
   for(const r of listRecords)try{if(!conferences.some(c=>Number(c.id)===Number(r.conference_id)))await recordingConferenceAccess(user,r.conference_id,'ai.conference.summarize');await assertRecording(user,r.conference_id,r.id);recordings.push({...r,title:`${r.title} · запись #${r.id}`});}catch(e){if(![403,404].includes(e.status))throw e;}
  }
  if(await apiBackgroundAllowed(user,user.api_token_id,'chat:read')){
   const all=await rows('SELECT id,name FROM chat_channels WHERE workspace_id=? AND (project_id=? OR project_id IS NULL) ORDER BY updated_at DESC LIMIT 200',[user.workspace_id,project.id]);for(const c of all)try{await agentChatAccess(user,c.id,project.id);channels.push({...c,title:c.name});}catch(e){if(![403,404].includes(e.status))throw e;}
  }
  if(await apiBackgroundAllowed(user,user.api_token_id,'tasks:read'))fields=await agentCustomFields(user,project.id);
  const identities=await rows('SELECT id,name,policy_json FROM ai_agent_identities WHERE workspace_id=? AND enabled=TRUE',[user.workspace_id]);
  return reply({identities:identities.filter(i=>parseJson(i.policy_json,{}).projects?.some(p=>Number(p.id)===Number(project.id))).map(({id,name})=>({id,name})),stages,articles,conferences,recordings,channels,spaces,fields,ai_enabled:settings.enabled,profiles:settings.profiles.filter(p=>p.enabled).map(({id,name,model,max_input_chars})=>({id,name,model,max_input_chars}))});
 }
 if(method==='GET'&&path[1]==='analytics'){
  const project=await agentAccess(user,positiveId.parse(params.get('project_id'))),days=z.coerce.number().int().min(1).max(90).parse(params.get('days')||30);
  const summary=await rows("SELECT r.status,COUNT(*) AS runs,SUM(COALESCE(r.input_tokens,0)+COALESCE(r.output_tokens,0)) AS tokens,AVG(TIMESTAMPDIFF(SECOND,r.started_at,r.completed_at)) AS avg_seconds FROM ai_agent_runs r WHERE r.project_id=? AND r.created_at>=DATE_SUB(CURRENT_TIMESTAMP,INTERVAL ? DAY) GROUP BY r.status",[project.id,days]);
  const agents=await rows("SELECT a.id,a.name,COUNT(r.id) AS runs,SUM(r.status='completed') AS completed,SUM(r.status='failed') AS failed,SUM(COALESCE(r.input_tokens,0)+COALESCE(r.output_tokens,0)) AS tokens FROM ai_agents a LEFT JOIN ai_agent_runs r ON r.agent_id=a.id AND r.created_at>=DATE_SUB(CURRENT_TIMESTAMP,INTERVAL ? DAY) WHERE a.project_id=? GROUP BY a.id,a.name ORDER BY runs DESC",[days,project.id]);
  return reply({days,summary,agents});
 }
 if(method==='GET'&&path.length===1){const project=await agentAccess(user,positiveId.parse(params.get('project_id')));return reply(await rows('SELECT a.*,u.display_name AS execution_user_name,COALESCE(d.published,TRUE) AS published,d.identity_id,dr.revision AS draft_revision FROM ai_agents a JOIN users u ON u.id=a.execution_user_id LEFT JOIN ai_agent_deployments d ON d.agent_id=a.id LEFT JOIN ai_agent_drafts dr ON dr.agent_id=a.id WHERE a.workspace_id=? AND a.project_id=? ORDER BY a.id DESC',[user.workspace_id,project.id]).then(items=>items.map(safeAgent)));}
 if(method==='POST'&&path[1]==='preview'){
  const d=agentSchema.extend({preview_task_id:positiveId.optional(),inputs:rawInputs}).parse(await body(request));await agentAccess(user,d.project_id,'agent.run');await agentScope(user,'agents:run');
  const values=agentInputs(d.config.inputs,d.inputs),settings=await getAiSettings(user.workspace_id),profiles=[chooseAiProfile(settings,'project',d.config.profile_id),...d.config.flow.nodes.filter(n=>n.type==='analyze').map(n=>chooseAiProfile(settings,'project',n.profile_id||d.config.profile_id))],budget=agentContextBudget(d.config,profiles,values);
  if(budget<1000)throw new WorkError(422,'Лимит контекста недостаточен для сценария');
  const context=await collectAgentSources(user,d.project_id,d.config,{task_id:d.preview_task_id,inputs:values},budget,{semantic:false}),metrics=sourceMetrics(context.sources);
  return reply({...context,metrics,conditions_match:matchesCondition(d.config.trigger.conditions,{metrics,inputs:values,trigger:{task_id:d.preview_task_id}})});
 }
 if(method==='POST'&&path[1]==='import'){
  const d=z.object({project_id:positiveId,definition:z.object({format:z.literal('kontur.agent.v2'),name:z.string(),config:agentConfigSchema}).strict()}).strict().parse(await body(request));
  const saved=await saveAgent(user,{project_id:d.project_id,name:d.definition.name,config:d.definition.config,enabled:false});await audit(user,'agent.imported','ai_agent',saved.id);return reply(saved,201);
 }
 if(method==='PATCH'&&path.length===2){
  const agent=await getAgent(user,positiveId.parse(path[1]),'agent.manage'),d=z.object({enabled:z.literal(false),revision:positiveId}).strict().parse(await body(request));
  await transaction(async c=>{const [[current]]=await c.query('SELECT * FROM ai_agents WHERE id=? FOR UPDATE',[agent.id]);if(current.revision!==d.revision)throw new WorkError(409,'Агент уже изменён');await versionSnapshot(c,current,current.execution_user_id);await c.query('UPDATE ai_agents SET enabled=FALSE,revision=revision+1,next_run_at=NULL WHERE id=?',[agent.id]);await versionSnapshot(c,{...current,enabled:false,revision:current.revision+1},user.id);await c.query("UPDATE ai_agent_runs SET status='cancelled',completed_at=CURRENT_TIMESTAMP WHERE agent_id=? AND status IN ('queued','running','review')",[agent.id]);});await audit(user,'agent.paused','ai_agent',agent.id);return reply({ok:true});
 }
 if((method==='POST'&&path.length===1)||(method==='PUT'&&path.length===2)){
  const saved=await saveAgent(user,await body(request),path[1]?positiveId.parse(path[1]):null);await audit(user,'agent.saved','ai_agent',saved.id);return reply(saved,method==='POST'?201:200);
 }
 if(path[1]==='runs'&&path[2]){
  const run=await runFor(user,path[2]);
  if(method==='GET'&&path[3]==='debug')return reply(await agentDebugRun(user,run));
  if(method==='POST'&&path[3]==='replay'){
   await agentAccess(user,run.project_id,'agent.manage');await agentScope(user,'agents:run');const data=z.object({request_id:z.string().uuid(),draft_revision:positiveId.optional()}).strict().parse(await body(request)),agent=await getAgent(user,run.agent_id,'agent.run');
   let selected=agent,identityId=agent.identity_id;if(data.draft_revision){const draft=await readAgentDraft(agent);if(draft.draft_revision!==data.draft_revision)throw new WorkError(409,'Черновик изменился');selected={...agent,config:draft.config};identityId=draft.identity_id;}
   checkReplaySources(agentConfigSchema.parse(parseJson(run.config_json)),selected.config);await loadDebugContext(user,run,{versions:true});await validateAgentConfigAccess(user,run.project_id,selected.config,{execute:true});const actor=identityId?await identityActor(user,identityId,run.project_id):user;await loadDebugContext(actor,run,{versions:true});
   const old=parseJson(run.trigger_context_json,{}),context={inputs:old.inputs||{},task_id:old.task_id||null,event_type:old.event_type||null,run_id:old.run_id||null,replay_run_id:run.id,requested_by:user.id,requester_api_token_id:user.api_token_id||null,...(data.draft_revision?{draft_revision:data.draft_revision}:{})};
   const queued=await enqueueAgentRun(actor,selected,{key:`replay:${user.id}:${data.request_id}`,context,dryRun:true});await audit(user,'agent.replayed','ai_agent_run',queued.id,{from:run.id});return reply(queued,202);
  }
  if(method==='GET'&&path[3]==='preview')return reply(await previewAgentActions(user,run));
  if(method==='GET'){
   await checkAgentRefs(user,run.project_id,parseJson(run.source_refs_json,[]));
   const {api_token_id,config_json,trigger_key,trigger_context_json,source_refs_json,source_meta_json,result_json,applied_json,...publicRun}=run;
   const steps=await rows('SELECT node_id,name,node_type,status,input_count,output_json,duration_ms,error_text,input_tokens,output_tokens FROM ai_agent_run_steps WHERE run_id=? ORDER BY position',[run.id]);
   const checkpoint=await one("SELECT node_id,revision,status,reviewers_json,expires_at,decided_by,decision_note FROM ai_agent_checkpoints WHERE run_id=?",[run.id]);
   const output={...publicRun,flow:parseJson(config_json,{}).flow||{nodes:[]},checkpoint:checkpoint?{...checkpoint,reviewer_ids:parseJson(checkpoint.reviewers_json,[]),reviewers_json:undefined}:null,refs:parseJson(source_refs_json,[]),meta:parseJson(source_meta_json,{}),result:parseJson(result_json,null),applied:parseJson(applied_json,[]),steps:steps.map(({output_json,...s})=>({...s,output:parseJson(output_json,null)})),feedback:await one('SELECT rating,note FROM ai_agent_run_feedback WHERE run_id=? AND user_id=?',[run.id,user.id])};
   if(output.flow.nodes.some(n=>n.type==='part'))output.flow=await resolveFlowParts(user,run.project_id,output.flow);
   if(path[3]==='export')return new Response(JSON.stringify(output,null,2),{headers:{'Content-Type':'application/json; charset=utf-8','Content-Disposition':`attachment; filename="agent-run-${run.id}.json"`,'Cache-Control':'no-store'}});
   if(path.length===3)return reply(output);
  }
  if(method==='POST'&&path[3]==='gate'){const d=z.object({node_id:z.string().max(40),revision:positiveId,decision:z.enum(['approve','reject']),note:z.string().max(2000).default('')}).strict().parse(await body(request));const result=await decideAgentGate(user,run,d,currentRun);await audit(user,'agent.gate.decided','ai_agent_run',run.id,{node_id:d.node_id,decision:d.decision});return reply(result);}
  if(method==='POST'&&path[3]==='feedback'){
   await agentAccess(user,run.project_id,'agent.run');await checkAgentRefs(user,run.project_id,parseJson(run.source_refs_json,[]));const d=z.object({rating:z.number().int().min(1).max(5),note:z.string().max(2000).default('')}).strict().parse(await body(request));if(!['completed','review','rejected'].includes(run.status))throw new WorkError(409,'Оценивать можно готовый результат');await rows('INSERT INTO ai_agent_run_feedback(run_id,user_id,rating,note) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE rating=VALUES(rating),note=VALUES(note)',[run.id,user.id,d.rating,d.note]);return reply({ok:true});
  }
  if(method==='POST'&&path[3]==='cancel'){
   await agentAccess(user,run.project_id,'agent.run');if(Number(run.actor_id)!==Number(user.id))await agentAccess(user,run.project_id,'agent.manage');await rows("UPDATE ai_agent_runs SET status='cancelled',completed_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('queued','running','review')",[run.id]);await audit(user,'agent.cancelled','ai_agent_run',run.id);return reply({ok:true});
  }
  if(method==='POST'&&path[3]==='review'){
   const d=z.object({decision:z.enum(['approve','reject']),indices:z.array(z.number().int().min(0).max(19)).min(1).max(20).optional()}).strict().parse(await body(request));const result=await applyAgentRun(user,run.id,d);await audit(user,'agent.reviewed','ai_agent_run',run.id,{decision:d.decision});return reply(result);
  }
 }
 if(path[1]&&path[1]!=='runs'){
  const agent=await getAgent(user,positiveId.parse(path[1]));
  if(method==='GET'&&path.length===2)return reply(safeAgent(agent));
  if(method==='GET'&&path[2]==='export'){await agentAccess(user,agent.project_id,'agent.manage');return reply({format:'kontur.agent.v2',name:agent.name,config:agent.config});}
  if(method==='GET'&&path[2]==='versions'){await agentAccess(user,agent.project_id,'agent.manage');return reply(await rows('SELECT v.revision,v.name,v.enabled,v.created_at,v.config_json,u.display_name AS saved_by FROM ai_agent_versions v JOIN users u ON u.id=v.saved_by WHERE v.agent_id=? ORDER BY v.revision DESC LIMIT 100',[agent.id]).then(list=>list.map(({config_json,...v})=>({...v,config:parseJson(config_json)}))));}
  if(method==='POST'&&path[2]==='restore'){
   await agentAccess(user,agent.project_id,'agent.manage');const d=z.object({revision:positiveId,version:positiveId}).strict().parse(await body(request)),old=await one('SELECT name,config_json FROM ai_agent_versions WHERE agent_id=? AND revision=?',[agent.id,d.version]);if(!old)throw new WorkError(404,'Версия не найдена');const saved=await saveAgent(user,{project_id:agent.project_id,name:old.name,config:parseJson(old.config_json),enabled:false,revision:d.revision},agent.id);await audit(user,'agent.restored','ai_agent',agent.id,{from:d.version});return reply(saved);
  }
  if(method==='GET'&&path[2]==='runs'){
   const offset=z.coerce.number().int().min(0).max(100000).parse(params.get('offset')||0),status=params.get('status')||'';if(status&&!['queued','running','review','completed','failed','cancelled','rejected'].includes(status))throw new WorkError(422,'Неизвестный статус');
   return reply(await rows(`SELECT r.id,r.status,r.trigger_type,r.created_at,r.completed_at,r.error_text,r.model,r.actor_id,u.display_name AS actor_name,COALESCE(s.dry_run,FALSE) AS dry_run FROM ai_agent_runs r JOIN users u ON u.id=r.actor_id LEFT JOIN ai_agent_run_state s ON s.run_id=r.id WHERE r.agent_id=? ${status?'AND r.status=?':''} ORDER BY r.id DESC LIMIT 50 OFFSET ?`,[agent.id,...(status?[status]:[]),offset]));
  }
  if(method==='POST'&&['run','test'].includes(path[2])){
   const d=z.object({request_id:z.string().uuid(),task_id:positiveId.optional(),inputs:rawInputs,draft_revision:positiveId.optional()}).strict().parse(await body(request));
   if(d.draft_revision&&path[2]!=='test')throw new WorkError(422,'Черновик можно запускать только в тестовом режиме');
   let selected=agent,identityId=agent.identity_id;
   if(d.draft_revision){await agentAccess(user,agent.project_id,'agent.manage');const draft=await readAgentDraft(agent);if(draft.draft_revision!==d.draft_revision)throw new WorkError(409,'Черновик изменён');selected={...agent,config:draft.config};identityId=draft.identity_id;}
   await validateAgentConfigAccess(user,agent.project_id,selected.config,{execute:true});
   const actor=identityId?await identityActor(user,identityId,agent.project_id):user;
   const result=await enqueueAgentRun(actor,selected,{key:`manual:${user.id}:${d.request_id}`,context:{task_id:d.task_id||null,inputs:d.inputs,requested_by:user.id,requester_api_token_id:user.api_token_id||null,...(d.draft_revision?{draft_revision:d.draft_revision}:{} )},dryRun:path[2]==='test'});await audit(user,path[2]==='test'?'agent.tested':'agent.queued','ai_agent_run',result.id);return reply(result,202);
  }
 }
 throw new WorkError(404,'Метод конструктора агентов не найден');
}
