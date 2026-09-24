import {searchSemantic} from './work-semantic.js';
import {resolveFlowParts,checkExpandedFlow} from './agent-parts.js';
import {semanticHash} from './semantic-vectors.js';
import {renderAgentTemplate} from './agent-flow.js';
import {assertIdentityConfiguration,assertIdentityRefs} from './agent-identity-policy.js';
import {agentCustomAccess,validateExtraAgentAccess,enrichAgentTask,checkExtraTaskRef,collectExtraAgentSources,checkExtraAgentRef,redactAgentEmails} from './agent-extra-sources.js';
import {one,rows,parseJson} from './db.js';
import {WorkError,projectFor} from './work-common.js';
import {projectPermissionSet} from './permissions.js';
import {apiBackgroundAllowed} from './api-access.js';
import {knowledgeSpaceAccess,knowledgeAccessAtLeast} from './knowledge-access.js';
import {recordingConferenceAccess} from './recordings.js';
import {agentSourceScopes} from './agent-schema.js';
export async function agentAccess(user,projectId,permission='agent.view',write=false){
 const project=await projectFor(user,projectId),rights=await projectPermissionSet(user,project);
 if(!rights.has(permission))throw new WorkError(403,'Нет разрешения: '+permission);
 if(write&&project.status!=='active')throw new WorkError(409,'Проект находится в архиве');return project;
}
export async function agentScope(user,scope){if(!await apiBackgroundAllowed(user,user.api_token_id,scope))throw new WorkError(403,'Доступ API отозван или отсутствует scope '+scope);}
export async function agentActor(id,workspaceId,tokenId){const user=await one("SELECT * FROM users WHERE id=? AND workspace_id=? AND status='active'",[id,workspaceId]);if(!user)throw new WorkError(403,'Пользователь агента отключён');return {...user,api_token_id:tokenId||null};}
async function qualityAccess(user,projectId){const rights=await projectPermissionSet(user,projectId);if(!['qa.view','qa.manage','qa.execute'].some(p=>rights.has(p)))throw new WorkError(403,'Нет доступа к результатам тестирования');}
async function articleAccess(user,id){
 const article=await one('SELECT id,space_id,title,body,status,version_number FROM knowledge_articles WHERE id=?',[id]);
 if(!article||article.status==='archived')throw new WorkError(403,'Статья недоступна');
 const access=await knowledgeSpaceAccess(user,article.space_id);
 if(!knowledgeAccessAtLeast(access.level,article.status==='published'?'view':'edit'))throw new WorkError(403,'Нет доступа к пространству базы знаний');return article;
}
// Проверяет права и лимиты всего сценария, включая закреплённые общие части.
export async function validateAgentConfigAccess(user,projectId,config,{execute=false}={}){
 if(config.flow.nodes.some(n=>n.type==='part')){const flow=await resolveFlowParts(user,projectId,config.flow);checkExpandedFlow(config,flow);config={...config,flow};}
 await assertIdentityConfiguration(user,projectId,config);
 const project=await projectFor(user,projectId);const rights=await projectPermissionSet(user,project);
 for(const scope of agentSourceScopes(config))await agentScope(user,scope);
 if(config.sources.quality.enabled)await qualityAccess(user,projectId);
 for(const id of config.sources.tasks.stage_ids){if(!await one('SELECT id FROM workflow_stages WHERE id=? AND workflow_id=?',[id,project.workflow_id]))throw new WorkError(422,'Этап не принадлежит проекту');}
 for(const id of config.sources.article_ids)await articleAccess(user,id);
 for(const id of config.sources.conference_ids){const meeting=await recordingConferenceAccess(user,id,'ai.conference.summarize');if(Number(meeting.project_id)!==Number(projectId))throw new WorkError(422,'Встреча относится к другому проекту');}
 if(config.mode==='automatic'&&!rights.has('agent.automate'))throw new WorkError(403,'Нет права автоматического выполнения');
 await validateExtraAgentAccess(user,project,config);
 if(execute){await agentAccess(user,projectId,'agent.run',true);await agentScope(user,'agents:run');await agentScope(user,'ai:write');}
 return project;
}
export async function collectAgentSources(user,projectId,config,trigger={},maxChars=20000,{semantic=true}={}){
 const project=await validateAgentConfigAccess(user,projectId,config);
 const sources=[],refs=[],meta={included:0,omitted:0,characters:0,counts:{}},add=(record,ref)=>{
  if(config.policy?.redact_emails)record=redactAgentEmails(record);
  const size=JSON.stringify(record).length+2;
  if(meta.characters+size>maxChars){meta.omitted++;return;}
  const texts=[];const extract=value=>{if(typeof value==='string')texts.push(value);else if(Array.isArray(value))value.forEach(extract);else if(value&&typeof value==='object')Object.values(value).forEach(extract);};extract(record);ref={...ref,evidence:texts.join('\n').slice(0,24000)};
  sources.push(record);refs.push(ref);meta.characters+=size;meta.included++;meta.counts[ref.kind]=(meta.counts[ref.kind]||0)+1;
 };
 // Explicitly selected fields only: credentials and binary attachments are never collected.
 const opts=config.sources.tasks;
 if(opts.enabled){
  let where='t.project_id=?',params=[projectId];
  if(opts.event_task_only){where+=' AND t.id=?';params.push(Number(trigger.task_id)||0);}
  if(opts.priorities.length){where+=` AND t.priority IN (${opts.priorities.map(()=>'?')})`;params.push(...opts.priorities);}
  if(opts.stage_ids.length){where+=` AND t.stage_id IN (${opts.stage_ids.map(()=>'?')})`;params.push(...opts.stage_ids);}
  if(opts.assignee_ids?.length){where+=` AND t.assignee_id IN (${opts.assignee_ids.map(()=>'?')})`;params.push(...opts.assignee_ids);}
  if(opts.updated_days){where+=' AND t.updated_at>=DATE_SUB(CURRENT_TIMESTAMP,INTERVAL ? DAY)';params.push(opts.updated_days);}
  if(opts.query){where+=' AND (t.title LIKE ? OR t.description LIKE ?)';const term=`%${opts.query.replace(/[\\%_]/g,'\\$&')}%`;params.push(term,term);}
  if(opts.only_overdue)where+=' AND t.due_date<UTC_DATE() AND s.is_done=FALSE';
  const columns=[...new Set(['id','version_number',...opts.fields,...(opts.custom_fields?.length?['custom_values_json']:[])])];
  const list=await rows(`SELECT ${columns.map(k=>k==='description'?'LEFT(t.description,4000) AS description':`t.${k}`).join(',')}${opts.fields.includes('due_date')?',s.is_done':''} FROM tasks t JOIN workflow_stages s ON s.id=t.stage_id WHERE ${where} ORDER BY t.updated_at DESC,t.id DESC LIMIT ?`,[...params,opts.limit+1]);
  if(list.length>opts.limit)meta.omitted++;
  for(const item of list.slice(0,opts.limit)){const enriched=await enrichAgentTask(user,{...item,project_id:projectId},opts);add({kind:'task',...enriched.data},enriched.ref);}
 }
 if(config.sources.quality.enabled){
  const list=await rows("SELECT r.id,r.title,r.completed_at FROM quality_runs r JOIN quality_plans p ON p.id=r.plan_id WHERE p.project_id=? AND r.status='completed' AND (? IS NULL OR r.id=?) ORDER BY r.id DESC LIMIT ?",[projectId,trigger.run_id||null,trigger.run_id||null,config.sources.quality.limit+1]);
  if(list.length>config.sources.quality.limit)meta.omitted++;
  for(const run of list.slice(0,config.sources.quality.limit)){
   const results=await rows(`SELECT i.case_id,i.result,LEFT(i.notes,3000) AS notes,JSON_UNQUOTE(JSON_EXTRACT(i.snapshot_json,'$.title')) AS title FROM quality_run_items i WHERE i.run_id=? ${config.sources.quality.only_failed?"AND i.result IN ('failed','blocked')":''} ORDER BY i.case_id LIMIT 21`,[run.id]);
   if(results.length>20)meta.omitted++;
   const allure=await one('SELECT summary_json,results_json FROM allure_imports WHERE run_id=?',[run.id]);
   const extra=allure?{allure_summary:parseJson(allure.summary_json,{}),flaky_tests:parseJson(allure.results_json,[]).filter(r=>r.flaky).slice(0,20).map(r=>({case_id:r.case_id,name:r.name,retries:r.retries,attempt_statuses:r.attempt_statuses}))}:{};
   add({kind:'quality',...run,...extra,results:results.slice(0,20)},{kind:'quality',id:run.id,project_id:projectId});
  }
 }
 const articleIds=new Set(config.sources.article_ids);
 if(config.sources.knowledge?.space_ids.length){const opts=config.sources.knowledge,term=`%${opts.query.replace(/[\\%_]/g,'\\$&')}%`;const found=await rows(`SELECT id FROM knowledge_articles WHERE status='published' AND space_id IN (${opts.space_ids.map(()=>'?')}) AND (title LIKE ? OR body LIKE ?) ORDER BY updated_at DESC LIMIT ?`,[...opts.space_ids,term,term,opts.limit]);for(const article of found)articleIds.add(article.id);}
 if(config.sources.semantic?.enabled){
  if(!semantic)meta.semantic_pending=true;
  else{const opts=config.sources.semantic,query=renderAgentTemplate(opts.query,{inputs:trigger.inputs||{},trigger}).slice(0,2000),result=await searchSemantic(user,{query,kinds:['knowledge']},{spaceIds:opts.space_ids,limit:opts.limit});
   meta.semantic_approximate=true;
   for(const found of result.results.filter(r=>r.score>=opts.min_score)){const a=await articleAccess(user,found.id);if(!opts.space_ids.includes(Number(a.space_id))||semanticHash(`${a.title}\n${a.body||''}`.slice(0,128000))!==found.content_hash)continue;
    add({kind:'article',id:a.id,title:a.title,body:found.snippet,fragment_start:found.fragment_start,similarity:found.score},{kind:'article',id:a.id,space_id:a.space_id,version:a.version_number,semantic:true,fragment_start:found.fragment_start});articleIds.delete(a.id);
   }
  }
 }
 for(const id of articleIds){const a=await articleAccess(user,id);add({kind:'article',id:a.id,title:a.title,body:a.body.slice(0,6000)},{kind:'article',id:a.id,space_id:a.space_id,version:a.version_number});if(a.body.length>6000)meta.omitted++;}
 for(const id of config.sources.conference_ids){
  const m=await recordingConferenceAccess(user,id,'ai.conference.summarize');
  if(Number(m.project_id)!==Number(projectId))throw new WorkError(403,'Встреча недоступна в проекте');
  const chat=await rows('SELECT id,revision,sender_id,message_type,body,created_at FROM conference_messages WHERE conference_id=? AND deleted_at IS NULL ORDER BY id DESC LIMIT 51',[id]);
  if(chat.length>50)meta.omitted++;
  const messages=chat.slice(0,50).reverse();
  add({kind:'conference',id:m.id,title:m.title,date:m.scheduled_start,messages},{kind:'conference',id:m.id,project_id:projectId,messages:messages.map(({id,revision})=>({id,revision}))});
 }
 await collectExtraAgentSources(user,projectId,config,add,meta);
 return {project:{id:project.id,name:project.name},sources,refs,meta};
}
export async function checkAgentRefs(user,projectId,refs,{versions=false}={}){
 await projectFor(user,projectId);await assertIdentityRefs(user,refs);
 const fields=[...new Set(refs.filter(r=>r.kind==='task').flatMap(r=>r.field_codes||[]))];
 await agentCustomAccess(user,projectId,fields);
 for(const ref of refs){
  if(ref.kind==='task'){
   await agentScope(user,'tasks:read');const task=await one('SELECT id,project_id,version_number FROM tasks WHERE id=?',[ref.id]);
   if(!task||Number(task.project_id)!==Number(projectId))throw new WorkError(403,'Исходная задача недоступна');
   await checkExtraTaskRef(user,projectId,ref,{versions,customChecked:true});
   if(versions&&Number(task.version_number)!==Number(ref.version))throw new WorkError(409,'Задача изменилась; запустите агента заново');
  }else if(ref.kind==='quality'){
   await agentScope(user,'quality:read');await qualityAccess(user,projectId);
   if(!await one("SELECT r.id FROM quality_runs r JOIN quality_plans p ON p.id=r.plan_id WHERE r.id=? AND p.project_id=? AND r.status='completed'",[ref.id,projectId]))throw new WorkError(403,'Прогон недоступен');
  }else if(ref.kind==='article'){
   await agentScope(user,'knowledge:read');const a=await articleAccess(user,ref.id);
   // Moving an article or editing a formerly public article can change its confidentiality.
   if(Number(a.space_id)!==Number(ref.space_id)||Number(a.version_number)!==Number(ref.version))throw new WorkError(409,'Источник базы знаний изменён; прежний результат скрыт');
  }else if(ref.kind==='conference'){
   await agentScope(user,'conference:read');const meeting=await recordingConferenceAccess(user,ref.id,'ai.conference.summarize');
   if(Number(meeting.project_id)!==Number(projectId))throw new WorkError(403,'Встреча недоступна');
   if(ref.messages.length){const current=await rows(`SELECT id,revision FROM conference_messages WHERE conference_id=? AND deleted_at IS NULL AND id IN (${ref.messages.map(()=>'?')})`,[ref.id,...ref.messages.map(m=>m.id)]);
    if(current.length!==ref.messages.length||ref.messages.some(m=>!current.some(c=>Number(c.id)===Number(m.id)&&c.revision===m.revision)))throw new WorkError(409,'Сообщения встречи изменены; прежний результат скрыт');}
  }else await checkExtraAgentRef(user,projectId,ref,{versions});
 }
}
