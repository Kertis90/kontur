import {z} from 'zod';
import {one,rows,transaction,parseJson} from './db.js';
import {encryptSecret,decryptSecret} from './crypto.js';
import {body,reply,positiveId,WorkError} from './work-common.js';
import {agentAccess,agentScope,agentActor,validateAgentConfigAccess,collectAgentSources,checkAgentRefs} from './agent-sources.js';
import {agentConfigSchema} from './agent-schema.js';
import {agentInputs,agentContextBudget} from './agent-flow.js';
import {getAiSettings,chooseAiProfile} from './ai-settings.js';
import {AGENT_ACTION_CATALOG} from './agent-catalog.js';
import {audit} from './audit.js';
const actionType=z.enum(AGENT_ACTION_CATALOG.map(a=>a.key));
export const evaluationCaseSchema=z.object({
 key:z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/),name:z.string().trim().min(1).max(160),
 task_id:positiveId.nullable().default(null),inputs:z.record(z.union([z.string().max(4000),z.number().finite(),z.boolean()])).default({}),
 expected:z.object({summary_contains:z.array(z.string().trim().min(1).max(300)).max(20).default([]),summary_excludes:z.array(z.string().trim().min(1).max(300)).max(20).default([]),required_actions:z.array(actionType).max(8).default([]),forbidden_actions:z.array(actionType).max(8).default([]),max_actions:z.number().int().min(0).max(20).default(20),min_confidence:z.number().min(0).max(1).default(0),require_citations:z.boolean().default(false)}).strict().default({}),
}).strict();
const suiteSchema=z.object({name:z.string().trim().min(2).max(160),cases:z.array(evaluationCaseSchema).min(1).max(10).refine(c=>new Set(c.map(i=>i.key)).size===c.length,'Ключи примеров повторяются'),revision:positiveId.optional()}).strict();
export function scoreAgentEvaluation(result,expected){
 const normalized=String(result.summary||'').toLocaleLowerCase('ru'),checks=[];
 for(const text of expected.summary_contains)checks.push({name:`Вывод содержит «${text}»`,pass:normalized.includes(text.toLocaleLowerCase('ru'))});
 for(const text of expected.summary_excludes)checks.push({name:`Вывод не содержит «${text}»`,pass:!normalized.includes(text.toLocaleLowerCase('ru'))});
 for(const type of expected.required_actions)checks.push({name:`Есть действие ${type}`,pass:result.actions?.some(a=>a.type===type)||false});
 for(const type of expected.forbidden_actions)checks.push({name:`Нет действия ${type}`,pass:!result.actions?.some(a=>a.type===type)});
 checks.push({name:`Не больше ${expected.max_actions} действий`,pass:(result.actions?.length||0)<=expected.max_actions});
 if(expected.min_confidence>0)checks.push({name:'Заданная самооценка уверенности',pass:typeof result.confidence==='number'&&result.confidence>=expected.min_confidence});
 if(expected.require_citations)checks.push({name:'Есть ссылки на источники',pass:Boolean(result.citations?.length)});
 return {passed:checks.filter(c=>c.pass).length,total:checks.length,percent:Math.round(100*checks.filter(c=>c.pass).length/checks.length),checks};
}

export async function evaluationContext(user,run,itemId){
 const item=await one('SELECT i.*,b.status AS batch_status,b.user_id,b.api_token_id,b.agent_id,a.workspace_id FROM ai_agent_eval_items i JOIN ai_agent_eval_batches b ON b.id=i.batch_id JOIN ai_agents a ON a.id=b.agent_id WHERE i.id=?',[itemId]);
 if(!item||Number(item.workspace_id)!==Number(run.workspace_id)||Number(item.agent_id)!==Number(run.agent_id)||Number(item.user_id)!==Number(user.id)||Number(item.api_token_id||0)!==Number(run.api_token_id||0)||!['running'].includes(item.batch_status)||!['queueing','running'].includes(item.status)||(item.run_id&&Number(item.run_id)!==Number(run.id)))throw new WorkError(409,'Тестовый пакет остановлен или недоступен');
 if(JSON.stringify(parseJson(item.config_json))!==JSON.stringify(parseJson(run.config_json)))throw new WorkError(409,'Конфигурация теста не совпадает');
 const context=JSON.parse(decryptSecret(item.context_encrypted));await checkAgentRefs(user,run.project_id,context.refs,{versions:true});return context;
}

export async function agentEvaluationsApi(request,path,user,{getAgent}){
 const agent=await getAgent(user,positiveId.parse(path[1]),'agent.manage');await agentScope(user,'agents:read');
 const method=request.method;
 if(method==='GET'&&path.length===3){
  const suites=await rows('SELECT * FROM ai_agent_eval_suites WHERE agent_id=? ORDER BY id DESC',[agent.id]);
  const batches=await rows('SELECT id,name,status,created_at FROM ai_agent_eval_batches WHERE agent_id=? ORDER BY id DESC LIMIT 30',[agent.id]);
  return reply({suites:suites.map(({cases_json,...s})=>({...s,cases:parseJson(cases_json,[])})),batches});
 }
 if(['POST','PUT'].includes(method)&&path[3]==='suites'){
  await agentScope(user,'agents:write');const d=suiteSchema.parse(await body(request)),id=path[4]?positiveId.parse(path[4]):null;
  if(method==='PUT'&&!id)throw new WorkError(422,'Укажите набор');
  const saved=await transaction(async c=>{await c.query('SELECT id FROM ai_agents WHERE id=? FOR UPDATE',[agent.id]);
   if(id){const [result]=await c.query('UPDATE ai_agent_eval_suites SET name=?,cases_json=?,revision=revision+1 WHERE id=? AND agent_id=? AND revision=?',[d.name,JSON.stringify(d.cases),id,agent.id,d.revision||0]);if(!result.affectedRows)throw new WorkError(409,'Набор уже изменён');return id;}
   const [[count]]=await c.query('SELECT COUNT(*) AS total FROM ai_agent_eval_suites WHERE agent_id=?',[agent.id]);if(Number(count.total)>=20)throw new WorkError(422,'Не более 20 наборов на агента');
   const [result]=await c.query('INSERT INTO ai_agent_eval_suites(agent_id,name,cases_json,created_by) VALUES(?,?,?,?)',[agent.id,d.name,JSON.stringify(d.cases),user.id]);return result.insertId;
  });return reply({id:saved},id?200:201);
 }
 if(method==='POST'&&path[3]==='batches'&&path.length===4){
  await agentAccess(user,agent.project_id,'agent.run',true);await agentScope(user,'agents:run');
  const d=z.object({suite_id:positiveId,suite_revision:positiveId,variants:z.array(z.object({name:z.string().trim().min(1).max(160),version:z.union([z.literal('published'),z.literal('draft'),positiveId]),profile_id:z.string().uuid().optional()}).strict()).min(1).max(2).refine(v=>new Set(v.map(i=>i.name)).size===v.length,'Имена вариантов повторяются')}).strict().parse(await body(request));
  const suite=await one('SELECT * FROM ai_agent_eval_suites WHERE id=? AND agent_id=?',[d.suite_id,agent.id]);if(!suite||suite.revision!==d.suite_revision)throw new WorkError(409,'Набор изменён или недоступен');
  const cases=z.array(evaluationCaseSchema).parse(parseJson(suite.cases_json)),settings=await getAiSettings(user.workspace_id),variants=[];
  for(const variant of d.variants){
   let config=agent.config;
   if(variant.version==='draft'){const draft=await one('SELECT config_json FROM ai_agent_drafts WHERE agent_id=?',[agent.id]);if(!draft)throw new WorkError(409,'Сохраните черновик перед сравнением');config=parseJson(draft.config_json);}
   else if(variant.version!=='published'){const old=await one('SELECT config_json FROM ai_agent_versions WHERE agent_id=? AND revision=?',[agent.id,variant.version]);if(!old)throw new WorkError(404,'Версия не найдена');config=parseJson(old.config_json);}
   config=agentConfigSchema.parse({...config,...(variant.profile_id?{profile_id:variant.profile_id}:{})});await validateAgentConfigAccess(user,agent.project_id,config,{execute:true});
   variants.push({...variant,config,profiles:[chooseAiProfile(settings,'project',config.profile_id),...config.flow.nodes.filter(n=>n.type==='analyze').map(n=>chooseAiProfile(settings,'project',n.profile_id||config.profile_id))]});
  }
  // Freeze one dataset for each case so both variants receive the same records.
  // Semantic lookups can consume embedding tokens; no generated action is applied.
  const items=[];
  for(const test of cases){
   const budget=Math.min(...variants.map(v=>agentContextBudget(v.config,v.profiles,agentInputs(v.config.inputs,test.inputs))));if(budget<1000)throw new WorkError(422,'Контекст теста не помещается в профиль');
   const context=await collectAgentSources(user,agent.project_id,variants[0].config,{task_id:test.task_id,inputs:test.inputs},budget);
   if(!context.sources.length)throw new WorkError(422,`Нет источников для примера «${test.name}»`);
   const encrypted=encryptSecret(JSON.stringify(context));if(encrypted.length>2000000)throw new WorkError(422,'Выборка слишком велика');
   for(const variant of variants)items.push({variant,test,context,encrypted});
  }
  const id=await transaction(async c=>{
   const [[current]]=await c.query('SELECT revision FROM ai_agents WHERE id=? FOR UPDATE',[agent.id]);if(current.revision!==agent.revision)throw new WorkError(409,'Агент изменился во время подготовки');
   const [[count]]=await c.query("SELECT COUNT(*) AS total FROM ai_agent_eval_batches WHERE agent_id=? AND status='running'",[agent.id]);if(Number(count.total)>=3)throw new WorkError(429,'У агента уже три активных пакета');
   const [batch]=await c.query('INSERT INTO ai_agent_eval_batches(suite_id,suite_revision,agent_id,user_id,api_token_id,name) VALUES(?,?,?,?,?,?)',[suite.id,suite.revision,agent.id,user.id,user.api_token_id||null,suite.name]);
   for(const i of items)await c.query('INSERT INTO ai_agent_eval_items(batch_id,case_key,variant,config_json,case_json,context_encrypted,source_refs_json) VALUES(?,?,?,?,?,?,?)',[batch.insertId,i.test.key,i.variant.name,JSON.stringify(i.variant.config),JSON.stringify({...i.test,agent_revision:agent.revision}),i.encrypted,JSON.stringify(i.context.refs)]);
   return batch.insertId;
  });await audit(user,'agent.evaluation.created','ai_agent',agent.id,{batch_id:id,cases:cases.length,variants:variants.length});return reply({id},201);
 }
 if(path[3]==='batches'&&path[4]){
  const batch=await one('SELECT * FROM ai_agent_eval_batches WHERE id=? AND agent_id=?',[positiveId.parse(path[4]),agent.id]);if(!batch)throw new WorkError(404,'Пакет не найден');
  const items=await rows('SELECT i.*,r.status AS run_status,r.input_tokens,r.output_tokens,r.started_at,r.completed_at,r.result_json FROM ai_agent_eval_items i LEFT JOIN ai_agent_runs r ON r.id=i.run_id WHERE i.batch_id=? ORDER BY i.id',[batch.id]);
  if(method==='GET'){
   for(const item of items)await checkAgentRefs(user,agent.project_id,parseJson(item.source_refs_json,[]));
   return reply({id:batch.id,name:batch.name,status:batch.status,items:items.map(i=>({id:i.id,case_key:i.case_key,name:parseJson(i.case_json,{}).name,variant:i.variant,status:i.status,run_id:i.run_id,score:parseJson(i.score_json,null),input_tokens:i.input_tokens,output_tokens:i.output_tokens,started_at:i.started_at,completed_at:i.completed_at,error:i.error_text,result:parseJson(i.result_json,null)}))});
  }
  if(method==='POST'&&path[5]==='cancel'){
   await agentScope(user,'agents:run');await transaction(async c=>{await c.query("UPDATE ai_agent_eval_batches SET status='cancelled',completed_at=CURRENT_TIMESTAMP WHERE id=? AND status='running'",[batch.id]);await c.query("UPDATE ai_agent_runs r JOIN ai_agent_eval_items i ON i.run_id=r.id SET r.status='cancelled',r.completed_at=CURRENT_TIMESTAMP WHERE i.batch_id=? AND r.status IN ('queued','running')",[batch.id]);await c.query("UPDATE ai_agent_eval_items SET status='cancelled' WHERE batch_id=? AND status IN ('pending','queueing','running')",[batch.id]);});return reply({ok:true});
  }
 }
 throw new WorkError(404,'Метод лаборатории не найден');
}

export async function pollAgentEvaluations({getAgent,enqueueAgentRun}){
 const work=await rows("SELECT i.*,b.agent_id,b.user_id,b.api_token_id,a.workspace_id FROM ai_agent_eval_items i JOIN ai_agent_eval_batches b ON b.id=i.batch_id JOIN ai_agents a ON a.id=b.agent_id WHERE b.status='running' AND i.status IN ('pending','queueing','running') ORDER BY i.id LIMIT 30");
 for(const item of work)try{
  if(item.run_id){
   const run=await one('SELECT * FROM ai_agent_runs WHERE id=?',[item.run_id]);if(!run||['queued','running'].includes(run.status))continue;
   const {agent_revision,...testCase}=parseJson(item.case_json);const expected=evaluationCaseSchema.parse(testCase);
   const score=run.status==='completed'?scoreAgentEvaluation(parseJson(run.result_json,{}),expected.expected):null;
   await rows("UPDATE ai_agent_eval_items SET status=?,score_json=?,error_text=? WHERE id=? AND status='running'",[run.status==='completed'?'completed':'failed',score?JSON.stringify(score):null,run.error_text||null,item.id]);continue;
  }
  const actor=await agentActor(item.user_id,item.workspace_id,item.api_token_id),agent=await getAgent(actor,item.agent_id,'agent.run'),test=parseJson(item.case_json),config=agentConfigSchema.parse(parseJson(item.config_json));
  if(agent.revision!==test.agent_revision)throw new WorkError(409,'Агент опубликован заново; повторите пакет');
  await checkAgentRefs(actor,agent.project_id,parseJson(item.source_refs_json,[]),{versions:true});
  await rows("UPDATE ai_agent_eval_items SET status='queueing' WHERE id=? AND status='pending'",[item.id]);
  let queued;try{queued=await enqueueAgentRun(actor,{...agent,config},{type:'manual',key:`evaluation:${item.id}`,context:{inputs:test.inputs,task_id:test.task_id,evaluation_item_id:item.id},dryRun:true});}catch(e){if(e.status===409&&e.message==='Очередь агента заполнена')continue;throw e;}
  await rows("UPDATE ai_agent_eval_items SET status='running',run_id=? WHERE id=? AND status='queueing'",[queued.id,item.id]);
 }catch(e){await rows("UPDATE ai_agent_eval_items SET status='failed',error_text=? WHERE id=? AND status IN ('pending','queueing','running')",[e.status?e.message.slice(0,1000):'Ошибка выполнения теста',item.id]);}
 await rows("UPDATE ai_agent_eval_batches b SET b.status='completed',b.completed_at=CURRENT_TIMESTAMP WHERE b.status='running' AND NOT EXISTS(SELECT 1 FROM ai_agent_eval_items i WHERE i.batch_id=b.id AND i.status IN ('pending','queueing','running'))");
}
