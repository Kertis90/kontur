import {jiraText} from './work-import.js';
import {WorkError} from './work-common.js';
import {semanticHash} from './semantic-vectors.js';
const text=(v,n)=>String(v??'').slice(0,n);
export function jiraExtras(issue){
 if(!issue||typeof issue!=='object'||Array.isArray(issue))throw new WorkError(422,'Задача Jira должна быть объектом');
 const warnings=[],history=[],fields=issue.fields||{},comments=fields.comment?.comments||[],changes=issue.changelog?.histories||[];
 if(!Array.isArray(comments)||!Array.isArray(changes)||comments.length>1000||changes.length>1000||[...comments,...changes].some(e=>!e||typeof e!=='object')||changes.some(e=>!Array.isArray(e.items||[])))throw new WorkError(422,'Некорректная история: не более 1000 комментариев и 1000 событий на задачу');
 if(Number(fields.comment?.total||0)>comments.length)warnings.push('Экспорт содержит не все комментарии');if(Number(issue.changelog?.total||0)>changes.length)warnings.push('Экспорт содержит не всю историю');
 for(const [kind,list]of [['comment',comments],['change',changes]])for(const entry of list){const body=kind==='comment'?jiraText(entry.body):(entry.items||[]).map(x=>`${text(x.field,200)}: ${text(x.fromString,5000)} → ${text(x.toString,5000)}`).join('\n');if(body.length>100000)throw new WorkError(422,'Слишком длинная запись истории');history.push({kind,entry_key:semanticHash(`${kind}:${entry.id||JSON.stringify(entry)}`),author:text(entry.author?.displayName||entry.author?.name||'Не указан',300),date:text(entry.created,60),body});}
 if(!Array.isArray(fields.attachment||[])||!Array.isArray(fields.issuelinks||[])||(fields.attachment||[]).some(a=>!a||typeof a!=='object')||(fields.issuelinks||[]).some(a=>!a||typeof a!=='object'))throw new WorkError(422,'Некорректные вложения или связи Jira');
 const attachments=(fields.attachment||[]).map(a=>({external_id:text(a.id,100),file_name:text(a.filename||'file',500),expected_size:Number(a.size),mime_type:text(a.mimeType||'application/octet-stream',200)}));
 if(attachments.length>100||attachments.some(a=>!a.external_id||!Number.isSafeInteger(a.expected_size)||a.expected_size<0)||new Set(attachments.map(a=>a.external_id)).size!==attachments.length)throw new WorkError(422,'Некорректный список вложений Jira');
 const links=(fields.issuelinks||[]).map(l=>({key:text(l.outwardIssue?.key||l.inwardIssue?.key,255),outward:Boolean(l.outwardIssue),type:text(l.type?.name,100)})).filter(l=>l.key);
 if(links.length>200)throw new WorkError(422,'Не более 200 связей задачи');
 const unique=new Map(history.map(h=>[h.entry_key,h]));if(unique.size!==history.length)warnings.push('Повторные события исходной истории объединены');
 return {history:[...unique.values()],attachments,links,warnings};
}
export function jiraLink(current,target,link){const type=link.type.toLowerCase();if(['blocks','блокирует'].includes(type))return {task_id:link.outward?target:current,depends_on_task_id:link.outward?current:target,dependency_type:'blocks'};if(['relates','relates to','связана с','duplicates','дублирует'].includes(type))return {task_id:current,depends_on_task_id:target,dependency_type:['duplicates','дублирует'].includes(type)?'duplicates':'relates'};return null;}
