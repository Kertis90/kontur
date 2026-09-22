import crypto from 'node:crypto';
import {z} from 'zod';
import {integrationUrl,integrationPost,networkError} from './integration-http.js';

export function validateIntegrationCredentials(provider,credentials,config={}){
 if(provider==='telegram'){
  const token=z.string().regex(/^\d{5,20}:[A-Za-z0-9_-]{20,100}$/,'Некорректный токен бота').parse(credentials.token);
  const chat_id=z.string().regex(/^(?:-?\d{1,20}|@[A-Za-z0-9_]{5,64})$/,'Укажите chat_id или @имя канала').parse(config.chat_id);
  const message_thread_id=config.message_thread_id?z.coerce.number().int().positive().max(2147483647).parse(config.message_thread_id):null;
  return {credentials:{token},config:{chat_id,message_thread_id},label:`Telegram · ${chat_id}`};
 }
 const url=integrationUrl(z.string().max(2000).parse(credentials.url));
 if(provider==='slack'&&(!['hooks.slack.com','hooks.slack-gov.com'].includes(url.hostname)||url.port||!/^\/services\/[^/]+\/[^/]+\/[^/]+$/.test(url.pathname)||url.search))throw networkError('CONFIG_INVALID');
 if(provider==='mattermost'&&!/^\/hooks\/[A-Za-z0-9_-]+$/.test(url.pathname))throw networkError('CONFIG_INVALID');
 const secret=provider==='webhook'?z.string().min(16).max(256).parse(credentials.secret):undefined;
 return {credentials:{url:url.href,...(secret?{secret}:{})},config:{},label:url.origin};
}
export function integrationEnvelope(delivery,task=null){
 const test=delivery.event_type==='integration.test';
 return {id:delivery.event_uuid,type:delivery.event_type,created_at:delivery.created_at,data:test?{text:'Проверка подключения Контур. Уведомления доставляются.'}:{task_id:task.id,project_id:task.project_id,key:`${task.key_code}-${task.task_number}`,title:task.title}};
}
const eventLabels={'sla.warning':'Предупреждение SLA','sla.breached':'Нарушение SLA','sla.escalated':'Эскалация SLA','automation.notification':'Уведомление автоматизации','task.created':'Новая задача','task.updated':'Задача изменена','task.due_soon':'Приближается срок задачи','comment.created':'Новый комментарий к задаче'};
export function integrationMessage(envelope){return envelope.type==='integration.test'?envelope.data.text:`Контур · ${eventLabels[envelope.type]||envelope.type}\n${envelope.data.key}: ${envelope.data.title}`;}
export function adapterRequest(provider,credentials,config,envelope){
 const text=integrationMessage(envelope);
 if(provider==='telegram')return {url:`https://api.telegram.org/bot${credentials.token}/sendMessage`,body:JSON.stringify({chat_id:config.chat_id,text,link_preview_options:{is_disabled:true},...(config.message_thread_id?{message_thread_id:config.message_thread_id}:{})}),headers:{}};
 if(provider==='slack')return {url:credentials.url,body:JSON.stringify({text:text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),mrkdwn:false,link_names:false,unfurl_links:false,unfurl_media:false}),headers:{}};
 // Mattermost always interprets mentions/Markdown; neutralize user-supplied titles.
 if(provider==='mattermost')return {url:credentials.url,body:JSON.stringify({text:text.replaceAll('@','@\u200b').replaceAll('<','‹').replaceAll('>','›').replace(/([\\`*_\[\]~!])/g,'\\$1')}),headers:{}};
 const body=JSON.stringify(envelope),signature=crypto.createHmac('sha256',credentials.secret).update(body).digest('hex');
 return {url:credentials.url,body,headers:{'x-kontur-event':envelope.type,'x-kontur-delivery':envelope.id,'x-kontur-signature-256':`sha256=${signature}`}};
}
export function adapterResult(provider,response){
 let data={};try{data=JSON.parse(response.text);}catch{}
 const code=Number(data.error_code);
 const status=provider==='telegram'&&data.ok===false&&Number.isInteger(code)&&code>=100&&code<=599?code:response.status;
 const retryAfter=Math.max(0,Math.min(86400,Number(data.parameters?.retry_after||response.headers?.['retry-after'])||0));
 if(status<200||status>=300)return {ok:false,status,code:status===429?'RATE_LIMIT':'HTTP_ERROR',retryable:status===429||status===408||status>=500,retryAfter};
 if(provider==='telegram'?data.ok!==true:['slack','mattermost'].includes(provider)&&response.text.trim()!=='ok')return {ok:false,status,code:'INVALID_RESPONSE',retryable:false};
 return {ok:true,status};
}
export async function sendIntegration(provider,credentials,config,envelope,transport=integrationPost){
 const request=adapterRequest(provider,credentials,config,envelope);
 return adapterResult(provider,await transport(request.url,request.body,request.headers));
}
