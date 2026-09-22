import crypto from 'node:crypto';
import { z } from 'zod';
import { rows,one,transaction } from './db.js';
import { WorkError,projectFor,positiveId,body,reply } from './work-common.js';
import { encryptSecret,decryptSecret } from './crypto.js';

export function verifyDevelopmentSignature(provider,secret,raw,headers){
  const expected=provider==='github'?`sha256=${crypto.createHmac('sha256',secret).update(raw).digest('hex')}`:secret;
  const received=headers.get(provider==='github'?'x-hub-signature-256':'x-gitlab-token')||'';
  return !!secret&&Buffer.byteLength(expected)===Buffer.byteLength(received)&&crypto.timingSafeEqual(Buffer.from(expected),Buffer.from(received));
}
function safeUrl(value,repository){try{const u=new URL(value),base=new URL(repository);return ['https:','http:'].includes(u.protocol)&&u.origin===base.origin&&!u.username&&!u.password?u.toString():null;}catch{return null;}}
export function developmentEntries(provider,event){
  const records=[];
  for(const c of event.commits||[])records.push({key:`commit-${c.id}`,kind:'commit',title:c.message,url:c.url,state:'committed'});
  if(event.ref)records.push({key:`branch-${event.ref}`,kind:'branch',title:event.ref,url:event.repository?.html_url||event.project?.web_url,state:event.deleted?'deleted':'active'});
  const pr=event.pull_request||(event.object_kind==='merge_request'?event.object_attributes:null);
  if(pr)records.push({key:`merge-${pr.id}`,kind:'merge_request',title:`${pr.title} ${pr.head?.ref||pr.source_branch||''}`,url:pr.html_url||pr.url,state:pr.merged?'merged':pr.state});
  const build=event.workflow_run||event.check_run||(event.object_kind==='pipeline'?event.object_attributes:null);
  if(build)records.push({key:`pipeline-${build.id}`,kind:'pipeline',title:`${build.name||'Сборка'} ${build.head_branch||build.ref||''} ${event.commit?.message||''}`,url:build.html_url||build.url,state:build.conclusion||build.status});
  return records.filter(r=>r.title).slice(0,500);
}
export async function developmentWebhook(request,connectionId){
  const connection=await one("SELECT c.*,p.workspace_id,p.key_code FROM development_connections c JOIN projects p ON p.id=c.project_id WHERE c.id=? AND c.enabled=TRUE AND p.deleted_at IS NULL AND p.status='active'",[positiveId.parse(connectionId)]);
  if(!connection)throw new WorkError(404,'Подключение не найдено');
  const raw=await request.text();if(Buffer.byteLength(raw)>3000000)throw new WorkError(413,'Слишком большой webhook');
  if(!verifyDevelopmentSignature(connection.provider,decryptSecret(connection.secret_encrypted),raw,request.headers))throw new WorkError(401,'Подпись webhook не прошла проверку');
  let event;try{event=JSON.parse(raw);}catch{throw new WorkError(400,'Некорректный JSON');}
  const repo=event.repository?.html_url||event.project?.web_url;
  if(repo&&String(repo).replace(/\.git$|\/$/g,'')!==connection.repository_url.replace(/\.git$|\/$/g,''))throw new WorkError(403,'Webhook относится к другому репозиторию');
  const prefix=connection.key_code.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');const keyPattern=new RegExp(`(?:^|[^A-Za-zА-Яа-я0-9_])${prefix}-(\\d+)(?!\\d)`,'gi');
  let linked=0;
  for(const entry of developmentEntries(connection.provider,event)){
    const numbers=[...new Set([...String(entry.title).matchAll(keyPattern)].map(m=>Number(m[1])))];
    for(const number of numbers){
      const task=await one('SELECT id FROM tasks WHERE project_id=? AND task_number=?',[connection.project_id,number]);if(!task)continue;
      await rows('INSERT INTO development_events(connection_id,external_id,task_id,kind,title,url,state) VALUES(?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE title=VALUES(title),url=VALUES(url),state=VALUES(state)',[connection.id,String(entry.key).slice(0,200),task.id,entry.kind,String(entry.title).slice(0,300),safeUrl(entry.url,connection.repository_url),String(entry.state||'').slice(0,80)]);linked++;
    }
  }return reply({linked});
}
export async function developmentApi(request,path,user){
  const method=request.method;
  if(path[1]==='task'){
    const task=await one('SELECT * FROM tasks WHERE id=?',[positiveId.parse(path[2])]);if(!task)throw new WorkError(404,'Задача не найдена');await projectFor(user,task.project_id);
    return reply(await rows('SELECT e.*,c.provider,c.name AS connection_name FROM development_events e JOIN development_connections c ON c.id=e.connection_id WHERE e.task_id=? ORDER BY e.id DESC LIMIT 200',[task.id]));
  }
  const project=await projectFor(user,path[1],method==='GET'?'project.browse':'project.admin',method!=='GET');
  if(method==='GET'){
    if(path[2]==='release-notes'){
      const releaseId=positiveId.parse(new URL(request.url).searchParams.get('release_id'));
      const tasks=await rows('SELECT t.id,t.title,t.task_number,s.is_done FROM tasks t JOIN workflow_stages s ON s.id=t.stage_id WHERE t.project_id=? AND t.release_id=?',[project.id,releaseId]);
      return reply({text:tasks.map(t=>`- ${project.key_code}-${t.task_number}: ${t.title}${t.is_done?'':' (ещё в работе)'}`).join('\n')});
    }
    return reply(await rows('SELECT id,project_id,provider,name,repository_url,enabled FROM development_connections WHERE project_id=?',[project.id]));
  }
  if(method==='POST'){
    const d=z.object({provider:z.enum(['github','gitlab']),name:z.string().trim().min(2).max(180),repository_url:z.string().url().max(1000)}).parse(await body(request));
    const u=new URL(d.repository_url);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash)throw new WorkError(422,'Укажите HTTP(S) URL репозитория без ключей и параметров');
    const secret=crypto.randomBytes(32).toString('hex');
    const created=await rows('INSERT INTO development_connections(project_id,provider,name,repository_url,secret_encrypted) VALUES(?,?,?,?,?)',[project.id,d.provider,d.name,d.repository_url.replace(/\/$/,''),encryptSecret(secret)]);
    return reply({id:created.insertId,secret,webhook_path:`/api/work/development/webhook/${created.insertId}`},201);
  }
  if(method==='PATCH'&&path[2]){const d=z.object({enabled:z.boolean()}).parse(await body(request));await rows('UPDATE development_connections SET enabled=? WHERE id=? AND project_id=?',[d.enabled,positiveId.parse(path[2]),project.id]);return reply({ok:true});}
  throw new WorkError(404,'Метод интеграции не найден');
}
