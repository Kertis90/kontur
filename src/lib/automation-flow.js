import { z } from 'zod';

const condition=z.object({field:z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_.]*$/).max(120),operator:z.enum(['equals','not_equals','contains','in','is_empty','within_days','greater_than','less_than']),value:z.unknown().optional()});
export const conditionGroup=z.object({mode:z.enum(['all','any']).default('all'),conditions:z.array(condition).max(30).default([])});
const action=z.lazy(()=>z.union([
  z.object({type:z.literal('integration_send'),connection_id:z.number().int().positive()}),
  z.object({type:z.literal('branch'),condition:conditionGroup,then:z.array(action).max(20),else:z.array(action).max(20).default([])}),
  z.object({type:z.enum(['notify_assignee','notify_user']),userId:z.number().int().positive().optional(),title:z.string().trim().min(1).max(300),body:z.string().max(2000).default('')}),
  z.object({type:z.literal('set_field'),field:z.enum(['priority','assignee_id','stage_id','progress','due_date','estimate_minutes']),value:z.union([z.string(),z.number(),z.null()])}),
  z.object({type:z.literal('create_subtask'),title:z.string().trim().min(1).max(300),description:z.string().max(10000).default(''),priority:z.enum(['critical','high','medium','low']).default('medium'),assigneeId:z.number().int().positive().nullable().optional()}),
]));
export const automationSchema=z.object({
  name:z.string().trim().min(2).max(180),description:z.string().max(1000).default(''),project_id:z.number().int().positive().nullable().default(null),enabled:z.boolean().default(true),
  trigger_type:z.enum(['task.created','task.updated','task.due_soon','comment.created','approval.approved','sla.warning','sla.breached','sla.escalated','scheduled']),
  trigger_config:z.object({interval_minutes:z.number().int().min(5).max(525600).default(1440)}).default({}),
  conditions:z.union([z.array(condition).max(30),conditionGroup]).default([]),actions:z.array(action).min(1).max(30),
}).superRefine((value,ctx)=>{
  let total=0;function check(actions,depth){for(const item of actions){total++;if(depth>5)ctx.addIssue({code:'custom',message:'Не более 5 уровней ветвления'});if(item.type==='branch'){check(item.then,depth+1);check(item.else,depth+1);}if(item.type==='notify_user'&&!item.userId)ctx.addIssue({code:'custom',message:'Выберите получателя уведомления'});}}
  check(value.actions,0);if(total>100)ctx.addIssue({code:'custom',message:'Не более 100 блоков'});
});
export function compare(actual,operator,expected,now=Date.now()){
  if(operator==='equals')return typeof expected==='boolean'?Boolean(Number(actual))===expected||actual===expected:String(actual)===String(expected);
  if(operator==='not_equals')return !compare(actual,'equals',expected,now);
  if(operator==='contains')return String(actual??'').toLowerCase().includes(String(expected??'').toLowerCase());
  if(operator==='in')return Array.isArray(expected)&&expected.map(String).includes(String(actual));
  if(operator==='is_empty')return actual==null||actual==='';
  if(operator==='within_days'){const days=(Date.parse(actual)-now)/86400000;return Number.isFinite(days)&&days>=0&&days<=Number(expected);}
  if(operator==='greater_than')return Number(actual)>Number(expected);
  if(operator==='less_than')return Number(actual)<Number(expected);
  return false;
}
export function conditionsMatch(group,context){
  const items=Array.isArray(group)?group:group?.conditions||[];
  const evaluate=c=>{const value=c.field.split('.').reduce((v,key)=>v?.[key],context);return compare(value,c.operator,c.value);};
  return !items.length||(group?.mode==='any'?items.some(evaluate):items.every(evaluate));
}
export function traceFlow(actions,context,path=''){
  return actions.flatMap((action,index)=>{
    const step=path?`${path}.${index}`:String(index);
    if(action.type!=='branch')return [{path:step,action}];
    const matched=conditionsMatch(action.condition,context);
    return [{path:step,branch:matched},...traceFlow(matched?action.then:action.else,context,`${step}.${matched?'then':'else'}`)];
  });
}
