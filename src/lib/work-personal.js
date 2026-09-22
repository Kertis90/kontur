import { z } from 'zod';
import { createHash } from 'node:crypto';
import { rows,one,transaction } from './db.js';
import { WorkError,positiveId,projectFor,reply,body } from './work-common.js';
import { taskChangeSchema,changeTask,createWorkTask } from './work-tasks.js';
import { objectInfo } from './storage.js';
import { emitEvent } from './events.js';
import { sendSystemMail } from './settings.js';
import { knowledgeSpaceAccess,knowledgeAccessAtLeast } from './knowledge-access.js';
import { recordingConferenceAccess } from './recordings.js';

export function offlineFingerprint(value){
  const normalize=v=>Array.isArray(v)?v.map(normalize):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,normalize(v[k])])):v;
  return createHash('sha256').update(JSON.stringify(normalize(value))).digest('hex');
}

export function localNotificationTime(preference,now=new Date()){
  const parts=Object.fromEntries(new Intl.DateTimeFormat('sv-SE',{timeZone:preference.timezone||'UTC',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23',weekday:'short'}).formatToParts(now).map(p=>[p.type,p.value]));
  const time=`${parts.hour}:${parts.minute}`,start=preference.quiet_start?.slice(0,5),end=preference.quiet_end?.slice(0,5);
  const quiet=!!start&&!!end&&(start===end||start<end?time>=start&&time<end:time>=start||time<end);
  return {quiet,hour:Number(parts.hour),date:`${parts.year}-${parts.month}-${parts.day}`};
}
export async function personalApi(request,path,user){
  const method=request.method;
  if(path[0]==='preferences'){
    if(method==='GET')return reply(await one('SELECT * FROM notification_preferences WHERE user_id=?',[user.id])||{timezone:'UTC',quiet_start:null,quiet_end:null,digest:'off',digest_hour:9,mentions_only:false,email_enabled:false});
    if(method==='PUT'){
      const d=z.object({timezone:z.string().max(100),quiet_start:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),quiet_end:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),digest:z.enum(['off','daily','weekly']),digest_hour:z.number().int().min(0).max(23),mentions_only:z.boolean(),email_enabled:z.boolean()}).parse(await body(request));
      try{new Intl.DateTimeFormat('ru',{timeZone:d.timezone});}catch{throw new WorkError(422,'Неизвестный часовой пояс');}
      if(Boolean(d.quiet_start)!==Boolean(d.quiet_end)||d.quiet_start&&d.quiet_start===d.quiet_end)throw new WorkError(422,'Укажите начало и окончание тихих часов');
      await rows('INSERT INTO notification_preferences(user_id,timezone,quiet_start,quiet_end,digest,digest_hour,mentions_only,email_enabled) VALUES(?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE timezone=VALUES(timezone),quiet_start=VALUES(quiet_start),quiet_end=VALUES(quiet_end),digest=VALUES(digest),digest_hour=VALUES(digest_hour),mentions_only=VALUES(mentions_only),enabled_at=IF(email_enabled=FALSE AND VALUES(email_enabled)=TRUE,CURRENT_TIMESTAMP,enabled_at),email_enabled=VALUES(email_enabled)',[user.id,d.timezone,d.quiet_start,d.quiet_end,d.digest,d.digest_hour,d.mentions_only,d.email_enabled]);return reply({ok:true});
    }
  }
  if(path[0]==='bulk'&&method==='POST'){
    const d=z.object({tasks:z.array(z.object({id:positiveId,version_number:positiveId})).min(1).max(100),patch:taskChangeSchema}).parse(await body(request));
    if(new Set(d.tasks.map(t=>t.id)).size!==d.tasks.length)throw new WorkError(422,'Задачи не должны повторяться');
    const result=await transaction(async c=>{const result=[];for(const t of [...d.tasks].sort((a,b)=>a.id-b.id))result.push(await changeTask(user,t.id,d.patch,c,{version:t.version_number}));return result;});return reply({updated:result});
  }
  if(path[0]==='offline'&&method==='POST'){
    const d=z.object({operation_id:z.string().uuid(),kind:z.enum(['task.create','task.update','comment.create','voice.create']),project_id:positiveId.optional(),task_id:positiveId.optional(),version_number:positiveId.optional(),data:z.record(z.unknown())}).parse(await body(request));
    let voice;
    if(d.kind==='voice.create'){
      voice=z.object({object_key:z.string().max(700),mime_type:z.enum(['audio/webm','audio/mp4','audio/ogg','audio/wav']),duration_seconds:z.number().min(0).max(1800),body:z.string().max(2000).default('Голосовой комментарий')}).parse(d.data);
      const task=await one('SELECT project_id FROM tasks WHERE id=?',[positiveId.parse(d.task_id)]);if(!task)throw new WorkError(404,'Задача не найдена');await projectFor(user,task.project_id,'comment.create',true);
      if(!voice.object_key.startsWith(`workspaces/${user.workspace_id}/projects/${task.project_id}/voice/`))throw new WorkError(403,'Неверный путь голосового файла');
      voice.size=Number((await objectInfo(voice.object_key)).size);if(voice.size>25*1024*1024||voice.size<1)throw new WorkError(422,'Размер голосовой записи должен быть до 25 МБ');
    }
    const result=await transaction(async c=>{
      await c.query('SELECT id FROM users WHERE id=? FOR UPDATE',[user.id]);
      const fingerprint=offlineFingerprint(d);
      const [[existing]]=await c.query('SELECT result_json,request_hash FROM offline_operations WHERE user_id=? AND operation_id=?',[user.id,d.operation_id]);
      if(existing){if(existing.request_hash!==fingerprint)throw new WorkError(409,'Этот идентификатор уже использован для другого изменения');return typeof existing.result_json==='string'?JSON.parse(existing.result_json):existing.result_json;}
      let result;
      if(d.kind==='task.create')result=await createWorkTask(user,positiveId.parse(d.project_id),d.data,c);
      else if(d.kind==='task.update')result=await changeTask(user,positiveId.parse(d.task_id),d.data,c,{version:positiveId.parse(d.version_number)});
      else{
        const [[task]]=await c.query('SELECT * FROM tasks WHERE id=?',[positiveId.parse(d.task_id)]);if(!task)throw new WorkError(404,'Задача не найдена');await projectFor(user,task.project_id,'comment.create',true);
        const text=voice?voice.body:z.string().trim().min(1).max(100000).parse(d.data.body);
        const [created]=await c.query('INSERT INTO comments(task_id,author_id,body) VALUES(?,?,?)',[task.id,user.id,text]);
        if(voice)await c.query('INSERT INTO comment_voice_attachments(comment_id,object_key,mime_type,size_bytes,duration_seconds) VALUES(?,?,?,?,?)',[created.insertId,voice.object_key,voice.mime_type,voice.size,voice.duration_seconds]);
        await emitEvent({workspaceId:user.workspace_id,eventType:'comment.created',aggregateType:'task',aggregateId:task.id,payload:{task_id:task.id,project_id:task.project_id,comment_id:created.insertId}},c);
        result={comment_id:created.insertId};
      }
      await c.query('INSERT INTO offline_operations(user_id,operation_id,request_hash,result_json) VALUES(?,?,?,?)',[user.id,d.operation_id,fingerprint,JSON.stringify(result)]);return result;
    });return reply(result);
  }
  throw new WorkError(404,'Персональный метод не найден');
}
export async function mayReadNotification(user,n){
  try{
    if(n.entity_type==='task'){const task=await one('SELECT project_id FROM tasks WHERE id=?',[n.entity_id]);if(!task)return false;await projectFor(user,task.project_id);}
    else if(n.entity_type==='conference')await recordingConferenceAccess(user,n.entity_id);
    else if(n.entity_type==='article'){const a=await one('SELECT space_id,status FROM knowledge_articles WHERE id=?',[n.entity_id]);if(!a)return false;const access=await knowledgeSpaceAccess(user,a.space_id);if(!knowledgeAccessAtLeast(access.level,a.status==='published'?'view':'edit'))return false;}
    else if(n.entity_type==='approval'){const a=await one('SELECT project_id FROM approval_requests WHERE id=?',[n.entity_id]);if(!a)return false;await projectFor(user,a.project_id);}
    else return false;
    return true;
  }catch(e){if([403,404].includes(e.status))return false;throw e;}
}
export async function deliverPersonalDigests(){
  const preferences=await rows("SELECT p.*,u.workspace_id FROM notification_preferences p JOIN users u ON u.id=p.user_id WHERE p.email_enabled=TRUE AND u.status='active'");
  for(const preference of preferences){
    const local=localNotificationTime(preference);if(local.quiet)continue;
    if(preference.digest!=='off'&&local.hour!==preference.digest_hour)continue;
    if(preference.last_digest_at&&preference.digest==='daily'&&localNotificationTime(preference,new Date(preference.last_digest_at)).date===local.date)continue;
    if(preference.last_digest_at&&preference.digest==='weekly'&&Date.now()-Date.parse(preference.last_digest_at)<7*86400000)continue;
    // Named advisory lock covers SMTP across replicas without holding a DB transaction.
    const {db}=await import('./db.js');const connection=await db.getConnection();
    try{
      const [[lock]]=await connection.query('SELECT GET_LOCK(?,0) AS acquired',[`kontur-digest-${preference.user_id}`]);if(!lock.acquired)continue;
      const fresh=await one('SELECT * FROM notification_preferences WHERE user_id=?',[preference.user_id]);
      if(!fresh?.email_enabled||localNotificationTime(fresh).quiet)continue;
      if(fresh.digest!=='off'&&localNotificationTime(fresh).hour!==fresh.digest_hour)continue;
      if(fresh.digest==='daily'&&fresh.last_digest_at&&localNotificationTime(fresh,new Date(fresh.last_digest_at)).date===localNotificationTime(fresh).date)continue;
      if(fresh.digest==='weekly'&&fresh.last_digest_at&&Date.now()-Date.parse(fresh.last_digest_at)<7*86400000)continue;
      const user=await one("SELECT * FROM users WHERE id=? AND status='active'",[preference.user_id]);if(!user)continue;
      const items=await rows('SELECT * FROM user_notifications WHERE user_id=? AND read_at IS NULL AND mail_delivered_at IS NULL AND created_at>=? ORDER BY id LIMIT 200',[user.id,fresh.enabled_at]);
      const selected=[],skipped=[];for(const item of items)if((!fresh.mentions_only||item.event_type.includes('mention')||item.event_type.includes('assigned')||item.event_type.startsWith('approval.'))&&await mayReadNotification(user,item))selected.push(item);else skipped.push(item.id);
      // Evaluate skipped mail once; an inaccessible notification must not block later deliveries.
      if(skipped.length)await rows(`UPDATE user_notifications SET mail_delivered_at=CURRENT_TIMESTAMP WHERE id IN (${skipped.map(()=>'?')})`,skipped);
      if(!selected.length)continue;
      const result=await sendSystemMail(user.workspace_id,user.email,`Контур: ${selected.length} уведомлений`,selected.map(n=>`${n.title}\n${n.body||''}`).join('\n\n'));
      if(result.status==='sent'){
        await rows(`UPDATE user_notifications SET mail_delivered_at=CURRENT_TIMESTAMP WHERE id IN (${selected.map(()=>'?')})`,selected.map(n=>n.id));
        await rows('UPDATE notification_preferences SET last_digest_at=CURRENT_TIMESTAMP WHERE user_id=?',[user.id]);
      }
    }finally{await connection.query('SELECT RELEASE_LOCK(?)',[`kontur-digest-${preference.user_id}`]).catch(()=>{});connection.release();}
  }
}
