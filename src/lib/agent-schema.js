import {z} from 'zod';
import {WorkError,positiveId,dateOnly} from './work-common.js';
import {flowSchema,inputsSchema,conditionSchema} from './agent-flow.js';
import {validAgentTimezone} from './agent-schedule.js';
import {AGENT_ACTION_CATALOG,AGENT_EVENT_LABELS,AGENT_FIELD_LABELS} from './agent-catalog.js';
export const AGENT_EVENTS=Object.keys(AGENT_EVENT_LABELS),AGENT_FIELDS=Object.keys(AGENT_FIELD_LABELS);
const ids=(max=20)=>z.array(positiveId).max(max).default([]);
const fieldCode=z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,119}$/).refine(v=>!['constructor','prototype','__proto__'].includes(v));
export const EDITABLE_AGENT_FIELDS=['title','description','priority','start_date','due_date','progress','estimate_minutes'];
export const agentConfigSchema=z.object({
 profile_id:z.string().uuid(),instructions:z.string().trim().min(10).max(8000),
 trigger:z.object({type:z.enum(['manual','event','schedule']),events:z.array(z.enum(AGENT_EVENTS)).max(AGENT_EVENTS.length).default([]),interval_minutes:z.number().int().min(15).max(10080).default(1440),only_failed_allure:z.boolean().default(true),
  schedule:z.object({mode:z.enum(['interval','daily','weekly']).default('interval'),time:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default('09:00'),timezone:z.string().max(100).refine(validAgentTimezone,'Неизвестный часовой пояс').default('UTC'),weekdays:z.array(z.number().int().min(0).max(6)).min(1).max(7).default([1,2,3,4,5])}).strict().default({}),
  conditions:conditionSchema.default({})
 }).strict(),
 sources:z.object({
  tasks:z.object({enabled:z.boolean().default(true),limit:z.number().int().min(1).max(100).default(30),fields:z.array(z.enum(AGENT_FIELDS)).min(1).max(AGENT_FIELDS.length).default(['title','priority','due_date','stage_id']),priorities:z.array(z.enum(['critical','high','medium','low'])).max(4).default([]),stage_ids:ids(30),only_overdue:z.boolean().default(false),event_task_only:z.boolean().default(false),custom_fields:z.array(fieldCode).max(20).default([]),include_comments:z.boolean().default(false),include_checklist:z.boolean().default(false),assignee_ids:ids(50),updated_days:z.number().int().min(0).max(365).default(0),query:z.string().max(200).default('')}).strict(),
  quality:z.object({enabled:z.boolean().default(false),limit:z.number().int().min(1).max(10).default(3),only_failed:z.boolean().default(true)}).strict(),
  article_ids:ids(10),conference_ids:ids(5),chat_channel_ids:ids(5),recording_ids:ids(5),planning:z.boolean().default(false),objectives:z.boolean().default(false),
  semantic:z.object({enabled:z.boolean().default(false),query:z.string().max(2000).default(''),space_ids:ids(10),limit:z.number().int().min(1).max(10).default(5),min_score:z.number().min(0.1).max(1).default(0.2)}).strict().default({}),
  knowledge:z.object({space_ids:ids(10),query:z.string().max(200).default(''),limit:z.number().int().min(1).max(20).default(10)}).strict().default({})
 }).strict(),
 actions:z.array(z.enum(AGENT_ACTION_CATALOG.map(a=>a.key))).max(8).default([]),mode:z.enum(['review','automatic']).default('review'),
 max_actions:z.number().int().min(1).max(20).default(3),daily_limit:z.number().int().min(1).max(100).default(5),queue_limit:z.number().int().min(1).max(20).default(1),cooldown_minutes:z.number().int().min(0).max(1440).default(0),
 inputs:inputsSchema,flow:flowSchema.default({}),policy:z.object({
  allowed_stage_ids:ids(30),allowed_assignee_ids:ids(50),article_space_ids:ids(10),chat_channel_ids:ids(5),
  editable_fields:z.array(z.enum(EDITABLE_AGENT_FIELDS)).max(7).default(['priority','due_date','progress']),
  min_confidence:z.number().min(0).max(1).default(0),require_citations:z.boolean().default(false),require_reasons:z.boolean().default(false),redact_emails:z.boolean().default(false)
 }).strict().default({})
}).strict().superRefine((v,ctx)=>{
 const issue=(message,path=[])=>ctx.addIssue({code:'custom',message,path});
 if(v.sources.semantic.enabled&&(!v.sources.semantic.space_ids.length||v.sources.semantic.query.trim().length<2))issue('Для поиска по смыслу выберите пространства и задайте запрос',['sources','semantic']);
 if(v.trigger.type==='event'&&!v.trigger.events.length)issue('Выберите события',['trigger','events']);
 if(!v.sources.tasks.enabled&&!v.sources.quality.enabled&&!v.sources.article_ids.length&&!v.sources.conference_ids.length&&!v.sources.chat_channel_ids.length&&!v.sources.recording_ids.length&&!v.sources.planning&&!v.sources.objectives&&!v.sources.knowledge.space_ids.length&&!v.sources.semantic.enabled)issue('Выберите хотя бы один источник',['sources']);
 if(v.actions.some(a=>['comment','update_task','move_task','assign_task','checklist_item'].includes(a))&&!v.sources.tasks.enabled)issue('Действия над задачами требуют источника «Задачи»',['actions']);
 for(const [action,field]of [['move_task','allowed_stage_ids'],['assign_task','allowed_assignee_ids'],['create_article','article_space_ids'],['chat_message','chat_channel_ids'],['update_task','editable_fields']])if(v.actions.includes(action)&&!v.policy[field].length)issue('Настройте допустимые цели для действия '+action,['policy',field]);
 if(v.trigger.type!=='manual'&&v.inputs.some(i=>i.required&&(i.default===undefined||i.default==='')))issue('Автоматическим триггерам нужны значения обязательных параметров по умолчанию',['inputs']);
 if(new Set(v.actions).size!==v.actions.length)issue('Действия не должны повторяться',['actions']);
 if(v.flow.nodes.filter(n=>['analyze','action'].includes(n.type)).length+1>v.flow.max_calls)issue('Лимит вызовов должен покрывать анализ, действия и итоговый ответ',['flow','max_calls']);
 for(const [index,node] of v.flow.nodes.entries())if(node.type==='action'&&!v.actions.includes(node.action))issue('Разрешите выбранное действие в настройках агента',['flow','nodes',index,'action']);
});
export const agentSchema=z.object({project_id:positiveId,name:z.string().trim().min(2).max(160),enabled:z.boolean().default(false),revision:positiveId.optional(),config:agentConfigSchema}).strict();
export function agentSourceScopes(config){const s=config.sources;return [...new Set([...(s.tasks.enabled?['tasks:read']:[]),...(s.quality.enabled?['quality:read']:[]),...(s.article_ids.length||s.knowledge?.space_ids.length||s.semantic?.enabled?['knowledge:read']:[]),...(s.conference_ids.length||s.recording_ids?.length?['conference:read']:[]),...(s.chat_channel_ids?.length?['chat:read']:[]),...(s.planning?['projects:read']:[]),...(s.objectives?['objectives:read']:[]),...(s.semantic?.enabled?['semantic:read']:[])])];}
export function agentEventMatches(config,event,payload){return config.trigger.type==='event'&&config.trigger.events.includes(event.event_type)&&!payload.automation_depth&&!payload.agent_run_id&&(event.event_type!=='quality.allure.imported'||!config.trigger.only_failed_allure||Number(payload.failed)>0);}
const reason={reason:z.string().max(2000).default('')},patchSchema=z.object({title:z.string().trim().min(1).max(300).optional(),description:z.string().max(10000).optional(),priority:z.enum(['critical','high','medium','low']).optional(),start_date:dateOnly.nullable().optional(),due_date:dateOnly.nullable().optional(),progress:z.number().int().min(0).max(100).optional(),estimate_minutes:z.number().int().min(0).max(1000000).nullable().optional()}).strict().refine(v=>Object.keys(v).length>0,'Пустое изменение');
const actionSchema=z.discriminatedUnion('type',[
 z.object({type:z.literal('create_task'),title:z.string().trim().min(2).max(300),description:z.string().max(10000).default(''),priority:z.enum(['critical','high','medium','low']).default('medium'),...reason}).strict(),
 z.object({type:z.literal('comment'),task_id:positiveId,body:z.string().trim().min(1).max(6000),...reason}).strict(),
 z.object({type:z.literal('update_task'),task_id:positiveId,patch:patchSchema,...reason}).strict(),
 z.object({type:z.literal('move_task'),task_id:positiveId,stage_id:positiveId,...reason}).strict(),
 z.object({type:z.literal('assign_task'),task_id:positiveId,assignee_id:positiveId,...reason}).strict(),
 z.object({type:z.literal('checklist_item'),task_id:positiveId,title:z.string().trim().min(1).max(500),...reason}).strict(),
 z.object({type:z.literal('create_article'),space_id:positiveId,title:z.string().trim().min(2).max(300),body:z.string().min(1).max(20000),...reason}).strict(),
 z.object({type:z.literal('chat_message'),channel_id:positiveId,body:z.string().trim().min(1).max(6000),...reason}).strict()
]);
export function parseAgentResult(text,config,refs){
 let value;try{value=JSON.parse(text.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));}catch{throw new WorkError(502,'Модель вернула неверный JSON');}
 const parsed=z.object({summary:z.string().trim().min(1).max(30000),actions:z.array(actionSchema).max(config.max_actions).default([]),confidence:z.number().min(0).max(1).nullable().default(null),citations:z.array(z.object({kind:z.string().max(30),id:positiveId,quote:z.string().trim().min(1).max(600).optional()}).strict()).max(100).default([])}).strict().safeParse(value);
 if(!parsed.success)throw new WorkError(502,'Ответ модели не соответствует разрешённому формату');
 const policy=config.policy||{};
 for(const cite of parsed.data.citations){const ref=refs.find(r=>r.kind===cite.kind&&Number(r.id)===cite.id);if(!ref)throw new WorkError(502,'Модель сослалась на источник вне контекста');if(cite.quote&&!ref.evidence?.includes(cite.quote))throw new WorkError(502,'Цитата модели отсутствует в переданном фрагменте источника');}
 for(const action of parsed.data.actions){
  if(!config.actions.includes(action.type))throw new WorkError(502,'Модель предложила неразрешённое действие');
  if(action.task_id&&!refs.some(r=>r.kind==='task'&&Number(r.id)===action.task_id))throw new WorkError(502,'Модель указала задачу вне переданных источников');
  for(const [field,allow]of [['stage_id','allowed_stage_ids'],['assignee_id','allowed_assignee_ids'],['space_id','article_space_ids'],['channel_id','chat_channel_ids']])if(action[field]&&!(policy[allow]||[]).includes(action[field]))throw new WorkError(502,'Модель выбрала цель вне разрешённого списка');
  if(action.type==='update_task'&&Object.keys(action.patch).some(k=>!policy.editable_fields?.includes(k)))throw new WorkError(502,'Модель изменила запрещённый атрибут');
 }return parsed.data;
}
export function agentResultWarnings(result,config){const p=config.policy||{},warnings=[];
 if(p.min_confidence>0&&(result.confidence===null||result.confidence===undefined||result.confidence<p.min_confidence))warnings.push('Уверенность модели ниже заданного порога или не указана');
 if(p.require_citations&&!result.citations?.length)warnings.push('Модель не указала проверяемые ссылки на источники');
 if(p.require_reasons&&result.actions.some(a=>!a.reason?.trim()))warnings.push('Не все действия имеют обоснование');return warnings;
}
