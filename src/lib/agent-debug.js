import {one,rows,parseJson} from './db.js';
import {encryptSecret,decryptSecret} from './crypto.js';
import {WorkError} from './work-common.js';
import {agentAccess,checkAgentRefs} from './agent-sources.js';
// Кодирует вход шага; очень большой вход помечается явно, не обрезая JSON посреди значения.
export function encodeStepInput(value){const json=JSON.stringify(value);return encryptSecret(json.length>256000?JSON.stringify({truncated:true,source_ids:value.source_ids,metrics:value.metrics}):json);}
// Сохраняет исходную выборку зашифрованной, отдельно от обычного журнала выполнения.
export async function saveDebugContext(run,context){const json=JSON.stringify(context);if(json.length>1500000)return false;await rows('INSERT INTO ai_agent_debug_contexts(run_id,context_encrypted) VALUES(?,?) ON DUPLICATE KEY UPDATE run_id=VALUES(run_id)',[run.id,encryptSecret(json)]);return true;}
// Читает прежние входы только после повторной проверки каждого источника и рабочей области.
export async function loadDebugContext(user,run,{versions=false}={}){
 if(Number(user.workspace_id)!==Number(run.workspace_id))throw new WorkError(404,'Запуск не найден');
 const saved=await one('SELECT context_encrypted FROM ai_agent_debug_contexts WHERE run_id=?',[run.id]);if(!saved)throw new WorkError(409,'Входные данные этого запуска не сохранены. Выполните новый тест');
 let context;try{context=JSON.parse(decryptSecret(saved.context_encrypted));}catch{throw new WorkError(409,'Не удалось прочитать сохранённый контекст');}
 await checkAgentRefs(user,run.project_id,context.refs,{versions});return context;
}
// Не позволяет повтору использовать изменённый набор источников или отключить маскирование старых данных.
export function checkReplaySources(previous,next){if(JSON.stringify(previous.sources)!==JSON.stringify(next.sources)||Boolean(previous.policy?.redact_emails)!==Boolean(next.policy?.redact_emails))throw new WorkError(409,'Источники или маскирование изменились. Выполните новый тест с актуальной выборкой');}
// Проверяет сохранённый источник повторного запуска перед каждым обращением к модели.
export async function replayContext(user,run,id){const original=await one('SELECT * FROM ai_agent_runs WHERE id=? AND workspace_id=? AND agent_id=?',[id,run.workspace_id,run.agent_id]);if(!original||!parseJson(run.trigger_context_json,{}).dry_run)throw new WorkError(403,'Повтор доступен только как тест этого агента');checkReplaySources(parseJson(original.config_json),parseJson(run.config_json));return loadDebugContext(user,original,{versions:true});}
// Отдаёт подробный разбор редактору, сохраняя авторизацию исторических данных.
export async function agentDebugRun(user,run){await agentAccess(user,run.project_id,'agent.manage');const context=await loadDebugContext(user,run),steps=await rows('SELECT node_id,input_encrypted,input_tokens,output_tokens FROM ai_agent_run_steps WHERE run_id=? ORDER BY position',[run.id]),trigger=parseJson(run.trigger_context_json,{});return {context,config:parseJson(run.config_json),inputs:trigger.inputs||{},steps:steps.map(({input_encrypted,...step})=>({...step,input:input_encrypted?parseJson(decryptSecret(input_encrypted),null):null}))};}
