import crypto from 'node:crypto';
import { z } from 'zod';
import { rows,one,transaction } from './db.js';
import { WorkError,projectFor,workspaceFor,positiveId,body,reply } from './work-common.js';
import { createWorkTask } from './work-tasks.js';

export function parseWorkCsv(text){
  const result=[];let row=[],value='',quoted=false;const input=text.replace(/^\uFEFF/,'');
  for(let i=0;i<input.length;i++){
    const char=input[i];
    if(quoted){if(char==='"'&&input[i+1]==='"'){value+='"';i++;}else if(char==='"')quoted=false;else value+=char;}
    else if(char==='"'){if(value)throw new WorkError(422,'Кавычка внутри неэкранированного поля CSV');quoted=true;}
    else if(char===','){row.push(value);value='';}
    else if(char==='\n'){row.push(value.replace(/\r$/,''));result.push(row);row=[];value='';}
    else value+=char;
  }
  if(quoted)throw new WorkError(422,'В CSV не закрыта кавычка');
  if(value||row.length){row.push(value.replace(/\r$/,''));result.push(row);}
  const headers=(result.shift()||[]).map(h=>h.trim());
  if(!headers.length||new Set(headers).size!==headers.length||headers.some(h=>!h))throw new WorkError(422,'Заголовки CSV должны быть заполнены и уникальны');
  return {headers,records:result.filter(r=>r.some(Boolean)).map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]||''])))};
}
export function jiraText(value){return typeof value==='string'?value:Array.isArray(value)?value.map(jiraText).join('\n'):value?.text||jiraText(value?.content||'');}
export function normalizeImport(source,text,mapping={}){
  let data;
  if(source==='jira_json'){
    let parsed;try{parsed=JSON.parse(text);}catch{throw new WorkError(422,'Некорректный JSON Jira');}
    const issues=parsed.issues||parsed;if(!Array.isArray(issues))throw new WorkError(422,'Ожидается массив issues');
    data={headers:['key','title','description','status','priority','assignee','due_date'],records:issues.map(i=>({key:i.key,title:i.fields?.summary||i.summary,description:jiraText(i.fields?.description||i.description),status:i.fields?.status?.name||i.status,priority:i.fields?.priority?.name||i.priority,assignee:i.fields?.assignee?.emailAddress||i.fields?.assignee?.displayName||i.assignee,due_date:i.fields?.duedate||i.dueDate}))};
  }else data=parseWorkCsv(text);
  const aliases={key:['key','issue key','issue_key'],title:['title','summary','название'],description:['description','описание'],status:['status','статус'],priority:['priority','приоритет'],assignee:['assignee','assignee_email','исполнитель'],due_date:['due_date','duedate','due date','срок']};
  const chosen={};for(const [target,candidates]of Object.entries(aliases))chosen[target]=Object.hasOwn(mapping,target)?mapping[target]:(data.headers.find(h=>candidates.includes(h.toLowerCase()))||'');
  return {headers:data.headers,mapping:chosen,records:data.records.map(row=>Object.fromEntries(Object.entries(chosen).map(([target,header])=>[target,row[header]??''])))};
}
export async function importPlan(user,d){
  await workspaceFor(user,'import.manage');const project=await projectFor(user,d.project_id,'task.create',true);
  const input=normalizeImport(d.source,d.text,d.mapping);
  if(input.records.length>1000)throw new WorkError(422,'Разбейте импорт на файлы не более 1000 задач');
  const stages=await rows('SELECT id,name,code FROM workflow_stages WHERE workflow_id=? ORDER BY position',[project.workflow_id]);
  const users=await rows("SELECT id,email,display_name FROM users WHERE workspace_id=? AND status='active'",[user.workspace_id]);
  const existing=await rows('SELECT external_key FROM work_import_items WHERE project_id=?',[project.id]),keys=new Set(existing.map(x=>x.external_key)),seen=new Set();
  const priorities={highest:'critical',critical:'critical',high:'high',medium:'medium',low:'low',lowest:'low','критический':'critical','высокий':'high','средний':'medium','низкий':'low'};
  const records=input.records.map((record,index)=>{
    const errors=[],warnings=[];const stage=stages.find(s=>String(s.id)===String(d.stages?.[record.status]))||stages.find(s=>[s.name,s.code].some(x=>x.toLowerCase()===String(record.status).toLowerCase()))||(!record.status?stages[0]:null);
    if(!stage)errors.push(`Сопоставьте этап «${record.status}»`);if(!String(record.title||'').trim())errors.push('Нет названия');
    const matches=users.filter(u=>[u.email,u.display_name].some(x=>x.toLowerCase()===String(record.assignee||'').toLowerCase()));
    let assignee=null;if(record.assignee){if(matches.length===1)assignee=matches[0];else warnings.push('Исполнитель не определён однозначно; останется пустым');}
    const due=record.due_date||null;if(due&&(!/^\d{4}-\d{2}-\d{2}$/.test(due)||Number.isNaN(Date.parse(due))||new Date(due).toISOString().slice(0,10)!==due))errors.push('Срок должен быть датой YYYY-MM-DD');
    const key=String(record.key||crypto.createHash('sha256').update(JSON.stringify(record)).digest('hex')).slice(0,255);
    const duplicate=keys.has(key)||seen.has(key);seen.add(key);
    return {row:index+1,external_key:key,duplicate,errors,warnings,task:{title:String(record.title||'').slice(0,300),description:String(record.description||''),priority:priorities[String(record.priority).toLowerCase()]||'medium',stage_id:stage?.id,assignee_id:assignee?.id||null,due_date:due},original_status:record.status};
  });return {headers:input.headers,mapping:input.mapping,stages,records,total:records.length,ready:records.filter(r=>!r.duplicate&&!r.errors.length).length};
}
export async function executeImport(user,d,plan){
  if(plan.records.some(r=>r.errors.length))throw new WorkError(422,'Исправьте ошибки предварительного просмотра');
  return transaction(async c=>{
    await c.query('SELECT id FROM projects WHERE id=? FOR UPDATE',[d.project_id]);let imported=0,skipped=0;
    for(const record of plan.records){
      const [[exists]]=await c.query('SELECT task_id FROM work_import_items WHERE project_id=? AND external_key=?',[d.project_id,record.external_key]);if(exists||record.duplicate){skipped++;continue;}
      const task=await createWorkTask(user,d.project_id,record.task,c);
      await c.query('INSERT INTO work_import_items(project_id,external_key,task_id) VALUES(?,?,?)',[d.project_id,record.external_key,task.task_id]);imported++;
    }return {imported,skipped,total:plan.total};
  });
}
export async function importWorkApi(request,path,user){
  const d=z.object({project_id:positiveId,source:z.enum(['csv','jira_json']),text:z.string().min(1).max(2500000),mapping:z.record(z.string()).default({}),stages:z.record(positiveId).default({}),preview_hash:z.string().length(64).optional()}).parse(await body(request));
  const plan=await importPlan(user,d);
  const fingerprint=crypto.createHash('sha256').update(JSON.stringify({project_id:d.project_id,source:d.source,text:d.text,mapping:plan.mapping,stages:d.stages})).digest('hex');
  plan.preview_hash=fingerprint;
  if(path[1]==='preview')return reply(plan);
  if(path[1]==='confirm'){if(d.preview_hash!==fingerprint)throw new WorkError(409,'Данные импорта изменились. Повторите предварительный просмотр');return reply(await executeImport(user,d,plan));}
  throw new WorkError(404,'Метод импорта не найден');
}
