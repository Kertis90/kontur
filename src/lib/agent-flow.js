import {z} from 'zod';
import {WorkError} from './work-common.js';
const key=z.string().regex(/^[a-z][a-z0-9_]{0,31}$/).refine(v=>!['constructor','prototype','__proto__'].includes(v),'Зарезервированное имя');
const scalar=z.union([z.string().max(4000),z.number().finite(),z.boolean()]);
const path=z.string().max(160).regex(/^(metrics\.[a-z_]+|inputs\.[a-z][a-z0-9_]*|trigger\.(event_type|task_id|run_id)|steps\.[a-z][a-z0-9_]*\.(summary|count|matched|approved|values\.[a-z][a-z0-9_]*))$/).refine(v=>!v.split('.').some(p=>['constructor','prototype','__proto__'].includes(p)));
export const conditionSchema=z.object({mode:z.enum(['all','any']).default('all'),rules:z.array(z.object({path,operator:z.enum(['equals','not_equals','greater','less','contains','not_empty','empty']),value:scalar.optional()}).strict()).max(12).default([])}).strict();
const target=z.union([key,z.literal(''),z.literal('$end')]).default('');
const base={id:key,name:z.string().trim().min(1).max(100),next:target};
const point=z.object({x:z.number().min(0).max(6000),y:z.number().min(0).max(6000)}).strict();
export const flowSchema=z.object({positions:z.record(key,point).refine(v=>Object.keys(v).length<=16).default({}),max_calls:z.number().int().min(1).max(12).default(8),nodes:z.array(z.discriminatedUnion('type',[
 z.object({...base,type:z.literal('analyze'),profile_id:z.string().uuid().nullable().default(null),prompt:z.string().trim().min(10).max(6000),fields:z.array(z.object({key,type:z.enum(['string','number','boolean'])}).strict()).max(10).default([])}).strict(),
 z.object({...base,type:z.literal('condition'),condition:conditionSchema,on_true:target,on_false:target}).strict(),
 z.object({...base,type:z.literal('approval'),message:z.string().trim().min(1).max(2000),reviewer_ids:z.array(z.number().int().positive()).max(20).default([]),timeout_hours:z.number().int().min(1).max(168).default(48)}).strict(),
 z.object({...base,type:z.literal('filter'),kinds:z.array(z.enum(['task','quality','article','conference','recording','chat','planning','objective'])).min(1).max(8),limit:z.number().int().min(1).max(200).default(100)}).strict(),
 z.object({...base,type:z.literal('template'),text:z.string().min(1).max(8000)}).strict(),
 z.object({...base,type:z.literal('stop'),text:z.string().min(1).max(8000)}).strict()
])).max(16).default([])}).strict().superRefine((v,ctx)=>{
 const positions=new Map(v.nodes.map((n,i)=>[n.id,i]));
 if(positions.size!==v.nodes.length)ctx.addIssue({code:'custom',message:'ID шагов должны быть уникальны',path:['nodes']});
 for(const [index,node]of v.nodes.entries()){
  for(const to of [node.next,...(node.type==='condition'?[node.on_true,node.on_false]:[])])if(to&&to!=='$end'&&(!positions.has(to)||positions.get(to)<=index))ctx.addIssue({code:'custom',message:'Переход возможен только к существующему следующему шагу; циклы запрещены',path:['nodes',index]});
  if(node.fields&&new Set(node.fields.map(f=>f.key)).size!==node.fields.length)ctx.addIssue({code:'custom',message:'Поля результата должны быть уникальны',path:['nodes',index,'fields']});
 }
});
export const inputsSchema=z.array(z.object({key,label:z.string().min(1).max(100),type:z.enum(['string','number','boolean']),required:z.boolean().default(false),default:scalar.optional()}).strict()).max(12).default([]).superRefine((items,ctx)=>{
 if(new Set(items.map(i=>i.key)).size!==items.length)ctx.addIssue({code:'custom',message:'Имена параметров повторяются'});
 for(const item of items)if(item.default!==undefined&&typeof item.default!==item.type)ctx.addIssue({code:'custom',message:'Тип значения по умолчанию не совпадает с параметром'});
});
export function agentInputs(definitions,values={}){
 if(!values||Array.isArray(values)||typeof values!=='object')throw new WorkError(422,'Параметры должны быть объектом');
 if(Object.keys(values).some(k=>!definitions.some(d=>d.key===k)))throw new WorkError(422,'Передан неизвестный параметр агента');
 const output=Object.create(null);
 for(const d of definitions){const v=Object.hasOwn(values,d.key)?values[d.key]:d.default;
  if(v===undefined||v===''){if(d.required)throw new WorkError(422,`Заполните параметр «${d.label}»`);continue;}
  if(typeof v!==d.type||(typeof v==='string'&&v.length>4000)||(typeof v==='number'&&!Number.isFinite(v)))throw new WorkError(422,`Неверный тип параметра «${d.label}»`);output[d.key]=v;
 }return output;
}
export function readVariable(context,path){let current=context;for(const part of String(path).split('.')){if(['__proto__','prototype','constructor'].includes(part)||!current||typeof current!=='object'||!Object.hasOwn(current,part))return undefined;current=current[part];}return current;}
export function matchesCondition(condition,context){
 if(!condition?.rules?.length)return true;
 const values=condition.rules.map(r=>{const v=readVariable(context,r.path),want=r.value;
  if(r.operator==='empty')return v===undefined||v===null||v==='';if(r.operator==='not_empty')return v!==undefined&&v!==null&&v!=='';
  if(v===undefined||v===null)return false;
  if(r.operator==='equals')return v===want;if(r.operator==='not_equals')return v!==want;
  if(r.operator==='greater'||r.operator==='less')return typeof v==='number'&&typeof want==='number'&&(r.operator==='greater'?v>want:v<want);
  return r.operator==='contains'&&typeof v==='string'&&typeof want==='string'&&v.toLocaleLowerCase('ru').includes(want.toLocaleLowerCase('ru'));
 });return condition.mode==='any'?values.some(Boolean):values.every(Boolean);
}
export function renderAgentTemplate(text,context){return text.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g,(_,path)=>{const v=readVariable(context,path);return ['string','number','boolean'].includes(typeof v)?String(v):'';}).slice(0,16000);}
export function sourceMetrics(sources,now=new Date()){
 const tasks=sources.filter(s=>s.kind==='task'),day=now.toISOString().slice(0,10);
 return {source_count:sources.length,task_count:tasks.length,overdue_count:tasks.filter(t=>t.due_date&&t.due_date<day&&(t.is_done===false||t.is_done===0)).length,critical_count:tasks.filter(t=>t.priority==='critical').length,failed_tests:sources.filter(s=>s.kind==='quality').reduce((n,r)=>n+(r.allure_summary?Number(r.allure_summary.failed||0)+Number(r.allure_summary.broken||0)+Number(r.allure_summary.unknown||0):(r.results||[]).filter(x=>['failed','blocked'].includes(x.result)).length),0),flaky_tests:sources.filter(s=>s.kind==='quality').reduce((n,r)=>n+Number(r.allure_summary?.flaky||0),0)};
}
export function parseNodeOutput(text,fields){
 let value;try{value=JSON.parse(text.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));}catch{throw new WorkError(502,'Шаг ИИ вернул неверный JSON');}
 const shape=Object.fromEntries(fields.map(f=>[f.key,f.type==='number'?z.number().finite():f.type==='boolean'?z.boolean():z.string().max(4000)]));
 const parsed=z.object({summary:z.string().max(10000),values:z.object(shape).strict().default({})}).strict().safeParse(value);
 if(!parsed.success)throw new WorkError(502,'Шаг ИИ вернул результат с неверными типами полей');return parsed.data;
}
export async function executeAgentFlow(config,context,{analyze,onStep=async()=>{},guard=async()=>{},approval=async()=>null,resume=null}){
 const nodes=config.flow.nodes,state=resume?.state||{inputs:context.inputs||{},trigger:context.trigger||{},metrics:sourceMetrics(context.sources),steps:Object.create(null)},trace=[];
 let sources=resume?.sources||[...context.sources],index=resume?.index||0,stopped=false,summary='';
 while(index<nodes.length){
  const node=nodes[index],started=Date.now();await guard();await onStep({node,index,status:'running',input_count:sources.length});
  try{
   let output,next=node.next;
   if(node.type==='analyze')output=await analyze(node,renderAgentTemplate(node.prompt,state),sources,state);
   if(node.type==='approval'){output=await approval(node,{state,sources,index});if(!output)return {paused:true,node,state,sources,index,trace};}
   if(node.type==='condition'){const matched=matchesCondition(node.condition,state);output={matched};next=matched?node.on_true:node.on_false;}
   if(node.type==='filter'){sources=sources.filter(s=>node.kinds.includes(s.kind)).slice(0,node.limit);state.metrics=sourceMetrics(sources);output={count:sources.length};}
   if(['template','stop'].includes(node.type)){output={summary:renderAgentTemplate(node.text,state)};if(node.type==='stop'){stopped=true;summary=output.summary;}}
   state.steps[node.id]=output;const step={node,index,status:'completed',output,duration_ms:Date.now()-started,input_count:sources.length};trace.push(step);await guard();await onStep(step);
   if(stopped||next==='$end')break;index=next?nodes.findIndex(n=>n.id===next):index+1;
  }catch(e){await onStep({node,index,status:'failed',duration_ms:Date.now()-started,error:e.status?e.message:'Ошибка шага'});throw e;}
 }
 return {sources,state,trace,stopped,summary};
}
export function agentContextBudget(config,profiles,inputs={}){
 const instructionSize=Math.max(config.instructions.length+JSON.stringify(config.policy).length+1800,...config.flow.nodes.map(n=>(n.prompt||n.text||'').length+JSON.stringify(n.fields||[]).length+1000));
 const reserve=instructionSize+Math.max(...profiles.map(p=>(p.instructions||'').length))+JSON.stringify(inputs).length+300;
 return Math.min(...profiles.map(p=>p.max_input_chars))-reserve;
}
