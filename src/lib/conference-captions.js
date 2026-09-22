import {createHash} from 'node:crypto';
import {z} from 'zod';
import {one,rows,transaction} from './db.js';
import {body,reply,positiveId,WorkError} from './work-common.js';
import {recordingConferenceAccess} from './recordings.js';
import {hasProjectPermission} from './permissions.js';
import {getAiSettings,aiProfileKey} from './ai-settings.js';
import {normalizeAiBaseUrl,responseJson} from './ai-client.js';
import {apiBackgroundAllowed} from './api-access.js';
import {normalizeCaptionAudio} from './caption-audio.js';
export const captionChunkSchema=z.object({client_id:z.string().uuid(),mime_type:z.string().max(100),audio_base64:z.string().min(4).max(1333336).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/)});
const isActive=c=>!['completed','cancelled'].includes(c.status);
async function verifyActor(user,conferenceId,joinCode){
 const actor=await one("SELECT * FROM users WHERE id=? AND workspace_id=? AND status='active'",[user.id,user.workspace_id]);
 if(!actor||!await apiBackgroundAllowed(actor,user.api_token_id,'conference:write')||!await apiBackgroundAllowed(actor,user.api_token_id,'ai:write'))throw new WorkError(403,'Доступ к субтитрам отозван');
 const conference=await recordingConferenceAccess(actor,conferenceId,null,joinCode);
 if(!isActive(conference)||!conference.captions_enabled)throw new WorkError(409,'Субтитры выключены или встреча завершена');
 if(!await hasProjectPermission(actor,conference.project_id,'conference.caption'))throw new WorkError(403,'Нет права распознавать свой микрофон');
 const participant=await one('SELECT participant_role FROM conference_participants WHERE conference_id=? AND user_id=?',[conference.id,actor.id]);
 if(!participant||(conference.conference_mode==='webinar'&&!['host','presenter'].includes(participant.participant_role)))throw new WorkError(403,'Субтитры доступны выступающим участникам');
 const moderator=actor.id===conference.created_by||await hasProjectPermission(actor,conference.project_id,'conference.manage');
 if(conference.waiting_room&&!moderator&&(await one('SELECT status FROM conference_admissions WHERE conference_id=? AND user_id=?',[conference.id,actor.id]))?.status!=='admitted')throw new WorkError(403,'Дождитесь допуска организатора');
 const settings=await getAiSettings(actor.workspace_id),speech=settings.speech;
 if(!speech?.enabled||!speech.live_captions||!speech.base_url||!speech.model)throw new WorkError(409,'Сервис субтитров выключен администратором');
 return {actor,conference,speech};
}
export async function reserveCaption(user,conference,data,hash,speech){
 return transaction(async c=>{
  await c.query('SELECT id FROM workspaces WHERE id=? FOR UPDATE',[user.workspace_id]);
  const [[existing]]=await c.query('SELECT id,payload_hash,status,text FROM conference_captions WHERE conference_id=? AND user_id=? AND client_id=?',[conference.id,user.id,data.client_id]);
  if(existing){if(existing.payload_hash!==hash)throw new WorkError(409,'Этот client_id уже использован для другого аудио');if(existing.status!=='completed')throw new WorkError(409,existing.status==='processing'?'Фрагмент ещё распознаётся':'Распознавание фрагмента завершилось ошибкой');return {id:existing.id,cached:true,text:existing.text};}
  const [[usage]]=await c.query("SELECT COALESCE(SUM(reserved_seconds),0) AS workspace_seconds,COALESCE(SUM(IF(user_id=?,reserved_seconds,0)),0) AS user_seconds,COUNT(IF(status='processing' AND created_at>DATE_SUB(CURRENT_TIMESTAMP,INTERVAL 2 MINUTE),1,NULL)) AS pending,COUNT(IF(user_id=? AND created_at>DATE_SUB(CURRENT_TIMESTAMP,INTERVAL 6 SECOND),1,NULL)) AS recent FROM conference_captions WHERE workspace_id=? AND created_at>=UTC_DATE()",[user.id,user.id,user.workspace_id]);
  if(Number(usage.recent)>0)throw new WorkError(429,'Фрагменты можно отправлять не чаще одного раза в 6 секунд');
  if(Number(usage.pending)>=(speech.caption_concurrency??10))throw new WorkError(429,'Сервис распознавания занят. Повторите позже');
  if(Number(usage.user_seconds)+12>(speech.caption_user_minutes??60)*60||Number(usage.workspace_seconds)+12>(speech.caption_workspace_minutes??600)*60)throw new WorkError(429,'Суточный лимит субтитров исчерпан');
  const [created]=await c.query('INSERT INTO conference_captions(conference_id,workspace_id,user_id,client_id,payload_hash) VALUES(?,?,?,?,?)',[conference.id,user.workspace_id,user.id,data.client_id,hash]);return {id:created.insertId,cached:false};
 });
}
async function speechRequest(speech,audio){
 const form=new FormData();form.append('file',new Blob([audio],{type:'audio/wav'}),'caption.wav');form.append('model',speech.model);form.append('language',speech.language||'ru');form.append('response_format','json');const key=aiProfileKey(speech);let result;
 try{result=await fetch(`${normalizeAiBaseUrl(speech.base_url)}/audio/transcriptions`,{method:'POST',headers:key?{Authorization:`Bearer ${key}`}:{},body:form,redirect:'error',signal:AbortSignal.timeout(30000)});}catch{throw new WorkError(502,'Сервис субтитров не ответил за 30 секунд');}
 if(!result.ok){await result.body?.cancel();throw new WorkError(502,`Ошибка сервиса субтитров: HTTP ${result.status}`);}const value=await responseJson(result,50000);
 if(typeof value.text!=='string'||value.text.length>10000)throw new WorkError(502,'Сервис вернул неверный текст субтитров');return value.text.trim();
}
export async function conferenceCaptionsApi(request,path,user){
 const url=new URL(request.url),joinCode=url.searchParams.get('join_code'),conference=await recordingConferenceAccess(user,positiveId.parse(path[1]),null,joinCode),canModerate=user.id===conference.created_by||await hasProjectPermission(user,conference.project_id,'conference.manage');
 if(request.method==='GET'&&path.length===2){
  const after=z.coerce.number().int().min(0).default(0).parse(url.searchParams.get('after')??undefined),settings=await getAiSettings(user.workspace_id);
  const admitted=!conference.waiting_room||canModerate||(await one('SELECT status FROM conference_admissions WHERE conference_id=? AND user_id=?',[conference.id,user.id]))?.status==='admitted';
  const items=admitted?await rows(`SELECT c.id,c.sequence_number,c.user_id,c.text,c.duration_seconds,c.created_at,u.display_name FROM conference_captions c JOIN users u ON u.id=c.user_id WHERE c.conference_id=? AND c.status='completed' AND c.text<>'' AND c.sequence_number>? ORDER BY c.sequence_number ${url.searchParams.has('after')?'ASC':'DESC'} LIMIT 200`,[conference.id,after]):[];
  if(!url.searchParams.has('after'))items.reverse();
  return reply({items,enabled:Boolean(conference.captions_enabled),service_enabled:Boolean(settings.speech?.enabled&&settings.speech?.live_captions),can_moderate:canModerate,can_caption:admitted&&isActive(conference)&&await hasProjectPermission(user,conference.project_id,'conference.caption')});
 }
 if(request.method==='PATCH'&&path.length===2){if(!canModerate)throw new WorkError(403,'Субтитры включает модератор');if(!isActive(conference))throw new WorkError(409,'Встреча завершена');const d=z.object({enabled:z.boolean()}).parse(await body(request));await rows('UPDATE conferences SET captions_enabled=? WHERE id=?',[d.enabled,conference.id]);return reply({ok:true});}
 if(request.method==='POST'&&path[2]==='chunks'&&path.length===3){
  const d=captionChunkSchema.parse(await body(request)),audio=Buffer.from(d.audio_base64,'base64');if(audio.length>1000000)throw new WorkError(413,'Аудиофрагмент больше 1 МБ');
  const verified=await verifyActor(user,conference.id,joinCode),hash=createHash('sha256').update(d.mime_type).update(audio).digest('hex'),reserved=await reserveCaption(user,conference,d,hash,verified.speech);
  if(reserved.cached)return reply(reserved);
  try{
   const normalized=await normalizeCaptionAudio(audio,d.mime_type),fresh=await verifyActor(user,conference.id,joinCode);
   const text=await speechRequest(fresh.speech,normalized.buffer);const final=await verifyActor(user,conference.id,joinCode);
   if(final.speech.revision!==fresh.speech.revision)throw new WorkError(409,'Настройки распознавания изменены');
   await transaction(async c=>{const [[current]]=await c.query('SELECT status,captions_enabled,caption_sequence FROM conferences WHERE id=? FOR UPDATE',[conference.id]);if(!current||!isActive(current)||!current.captions_enabled)throw new WorkError(409,'Субтитры остановлены');const sequence=Number(current.caption_sequence)+1;await c.query('UPDATE conferences SET caption_sequence=? WHERE id=?',[sequence,conference.id]);await c.query("UPDATE conference_captions SET status='completed',sequence_number=?,text=?,duration_seconds=?,reserved_seconds=?,completed_at=CURRENT_TIMESTAMP(3) WHERE id=?",[sequence,text,normalized.duration,Math.ceil(normalized.duration),reserved.id]);});return reply({id:reserved.id,text,cached:false});
  }catch(e){await rows("UPDATE conference_captions SET status='failed',completed_at=CURRENT_TIMESTAMP(3) WHERE id=?",[reserved.id]);throw e;}
 }
 throw new WorkError(404,'Метод субтитров не найден');
}
