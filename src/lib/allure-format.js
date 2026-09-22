import {createHash} from 'node:crypto';
import {z} from 'zod';
import {WorkError} from './work-common.js';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text=(value,max)=>String(value??'').slice(0,max);
const status=z.enum(['passed','failed','broken','skipped','unknown']);
const resultSchema=z.object({
 uuid:z.string().max(200).optional(),name:z.string().min(1).max(2000),fullName:z.string().max(4000).optional(),
 historyId:z.string().max(500).optional(),testCaseId:z.string().max(500).optional(),status,
 start:z.number().nonnegative().max(8640000000000000).optional(),stop:z.number().nonnegative().max(8640000000000000).optional(),
 statusDetails:z.object({message:z.string().max(50000).optional(),trace:z.string().max(100000).optional(),flaky:z.boolean().optional()}).optional(),
 labels:z.array(z.object({name:z.string().max(100),value:z.string().max(2000)})).max(100).default([]),
 parameters:z.array(z.object({name:z.string().max(200),value:z.string().max(4000),excluded:z.boolean().optional(),mode:z.string().max(40).optional()})).max(100).default([]),
 steps:z.array(z.unknown()).max(500).default([]),attachments:z.array(z.unknown()).max(200).default([]),
});
export const allureImportSchema=z.object({external_id:z.string().trim().min(1).max(160),title:z.string().trim().min(2).max(200),report_url:z.string().max(1000).default(''),results:z.array(resultSchema).min(1).max(200)}).strict();
export function allureReportUrl(value,base=''){
 if(!value)return '';
 let url;try{url=new URL(value);}catch{throw new WorkError(422,'Некорректная ссылка на отчёт Allure');}
 if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw new WorkError(422,'Для отчёта нужен HTTP(S)-адрес без логина и пароля');
 if(base){const root=new URL(base),prefix=root.pathname.replace(/\/$/,'');if(url.origin!==root.origin||(url.pathname!==prefix&&!url.pathname.startsWith(prefix+'/')))throw new WorkError(422,'Отчёт находится вне настроенного адреса Allure');}
 return url.href;
}
function stepsOf(steps){
 const result=[],queue=steps.map(s=>({s,depth:0})).reverse();
 while(queue.length&&result.length<100){const {s,depth}=queue.pop();if(!s||typeof s!=='object'||Array.isArray(s))continue;result.push({name:text(s.name,1000),status:['passed','failed','broken','skipped','unknown'].includes(s.status)?s.status:'unknown',message:text(s.statusDetails?.message,1500)});if(depth<5&&Array.isArray(s.steps))for(const step of s.steps.slice(0,100).reverse())queue.push({s:step,depth:depth+1});}
 return result;
}
export function normalizeAllure(input,strategy='historyId'){
 const parsed=allureImportSchema.parse(input),groups=new Map(),uuids=new Map();
 for(const raw of parsed.results){
  // An execution UUID is not a stable test key. Hidden/masked parameter values never enter stored results.
  const parameters=raw.parameters.filter(p=>!['hidden','masked'].includes(p.mode)).map(p=>({name:p.name,value:p.value,excluded:Boolean(p.excluded)}));
  const fallback=raw.fullName||raw.name,base=raw[strategy]||fallback;
  const variants=raw.parameters.filter(p=>!p.excluded).map(p=>[p.name,p.value]).sort((a,b)=>a[0].localeCompare(b[0])||a[1].localeCompare(b[1]));
  const stable=strategy==='historyId'&&raw.historyId?base:base+(variants.length?`::${digest(variants).slice(0,20)}`:'');
  const key=stable.length<=200?stable:`allure:${digest(stable)}`;
  const item={key,name:text(raw.name,300),full_name:text(raw.fullName,2000),status:raw.status,result:{passed:'passed',failed:'failed',broken:'blocked',skipped:'skipped',unknown:'blocked'}[raw.status],start:raw.start??null,stop:raw.stop??null,duration_ms:raw.start!=null&&raw.stop!=null?Math.max(0,raw.stop-raw.start):null,message:text(raw.statusDetails?.message,4000),trace:text(raw.statusDetails?.trace,6000),steps:stepsOf(raw.steps),labels:raw.labels.filter(l=>['suite','parentSuite','subSuite','feature','story','severity','epic'].includes(l.name)),parameters,attachment_count:raw.attachments.length,flaky:Boolean(raw.statusDetails?.flaky)};
  if(raw.uuid){const hash=digest(item);if(uuids.has(raw.uuid)){if(uuids.get(raw.uuid)!==hash)throw new WorkError(422,'Один UUID Allure содержит разные результаты');continue;}uuids.set(raw.uuid,hash);}
  if(!groups.has(key))groups.set(key,[]);groups.get(key).push(item);
 }
 const results=[...groups.values()].map(attempts=>{attempts.sort((a,b)=>(a.stop??a.start??0)-(b.stop??b.start??0)||digest(a).localeCompare(digest(b)));const last=attempts.at(-1);return {...last,attempts:attempts.length,retries:attempts.length-1,flaky:last.flaky||(last.status==='passed'&&attempts.some(a=>['failed','broken'].includes(a.status))),attempt_statuses:attempts.map(a=>a.status)};}).sort((a,b)=>a.key.localeCompare(b.key));
 const summary={total:results.length,passed:0,failed:0,broken:0,skipped:0,unknown:0,flaky:0,retries:0};for(const item of results){summary[item.status]++;summary.flaky+=Number(item.flaky);summary.retries+=item.retries;}
 return {external_id:parsed.external_id,title:parsed.title,report_url:parsed.report_url,results,summary};
}
export function allureFingerprint(value){return digest(value);}
