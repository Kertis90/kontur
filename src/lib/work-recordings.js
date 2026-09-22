import crypto from 'node:crypto';
import { z } from 'zod';
import { rows,one,transaction } from './db.js';
import { assertRecording,recordingConferenceAccess } from './recordings.js';
import { WorkError,positiveId,body,reply } from './work-common.js';
import { deleteObject } from './storage.js';
import { audit } from './audit.js';
const hash=text=>crypto.createHash('sha256').update(text).digest('hex');
export async function recordingWorkApi(request,path,user){
  const conferenceId=positiveId.parse(path[1]),recordingId=positiveId.parse(path[2]),method=request.method;
  const record=await assertRecording(user,conferenceId,recordingId);
  if(method==='GET'){
    const [chapters,chunks,history]=await Promise.all([rows('SELECT * FROM recording_chapters WHERE recording_id=? ORDER BY start_seconds',[record.id]),rows('SELECT * FROM conference_recording_transcripts WHERE recording_id=? ORDER BY chunk_index',[record.id]),rows('SELECT e.id,e.chunk_index,e.created_at,u.display_name AS editor FROM recording_transcript_edits e JOIN users u ON u.id=e.changed_by WHERE recording_id=? ORDER BY e.id DESC LIMIT 100',[record.id])]);
    return reply({recording:{id:record.id,conference_id:record.conference_id,duration_seconds:record.duration_seconds,retained_until:record.retained_until,transcript_status:record.transcript_status},chapters,chunks:chunks.map(c=>({...c,etag:hash(c.text)})),history});
  }
  await recordingConferenceAccess(user,conferenceId,'conference.manage');
  if(method==='PUT'&&path[3]==='chapters'){
    const d=z.array(z.object({start_seconds:z.number().int().min(0),title:z.string().trim().min(1).max(300)})).max(500).parse(await body(request));
    if(new Set(d.map(c=>c.start_seconds)).size!==d.length)throw new WorkError(422,'Время начала глав не должно повторяться');
    if(d.some(c=>c.start_seconds>=Number(record.duration_seconds||0)))throw new WorkError(422,'Глава выходит за длительность записи');
    await transaction(async c=>{await c.query('SELECT id FROM conference_recordings WHERE id=? FOR UPDATE',[record.id]);await c.query('DELETE FROM recording_chapters WHERE recording_id=?',[record.id]);for(const chapter of d)await c.query('INSERT INTO recording_chapters(recording_id,start_seconds,title,created_by) VALUES(?,?,?,?)',[record.id,chapter.start_seconds,chapter.title,user.id]);});return reply({ok:true});
  }
  if(method==='PATCH'&&path[3]==='transcript'){
    const d=z.object({chunk_index:z.number().int().min(0),etag:z.string().length(64),text:z.string().trim().min(1).max(100000)}).parse(await body(request));
    if(record.transcript_status!=='completed')throw new WorkError(409,'Сначала дождитесь завершения расшифровки');
    await transaction(async c=>{
      const [[locked]]=await c.query('SELECT * FROM conference_recordings WHERE id=? FOR UPDATE',[record.id]);
      if(locked.deleted_at||locked.transcript_status!=='completed')throw new WorkError(409,'Запись больше недоступна для редактирования');
      const [[chunk]]=await c.query('SELECT * FROM conference_recording_transcripts WHERE recording_id=? AND chunk_index=? FOR UPDATE',[record.id,d.chunk_index]);
      if(!chunk)throw new WorkError(404,'Фрагмент не найден');if(hash(chunk.text)!==d.etag)throw new WorkError(409,'Фрагмент изменён другим пользователем. Обновите его перед сохранением');
      await c.query('INSERT INTO recording_transcript_edits(recording_id,chunk_index,original_text,replacement_text,changed_by) VALUES(?,?,?,?,?)',[record.id,d.chunk_index,chunk.text,d.text,user.id]);
      await c.query('UPDATE conference_recording_transcripts SET text=? WHERE recording_id=? AND chunk_index=?',[d.text,record.id,d.chunk_index]);
      const [all]=await c.query('SELECT chunk_index,text FROM conference_recording_transcripts WHERE recording_id=? ORDER BY chunk_index',[record.id]);
      await c.query('UPDATE conference_recordings SET transcript_revision=? WHERE id=?',[hash(JSON.stringify(all)),record.id]);
    });await audit(user,'recording.transcript.corrected','conference',conferenceId,{recording_id:record.id,chunk_index:d.chunk_index},request);return reply({ok:true});
  }
  if(method==='PATCH'&&path[3]==='retention'){
    const d=z.object({retained_until:z.string().datetime().nullable()}).parse(await body(request));
    if(d.retained_until&&Date.parse(d.retained_until)<Date.now()+86400000)throw new WorkError(422,'Срок хранения должен быть не меньше суток');
    const updated=await rows('UPDATE conference_recordings SET retained_until=? WHERE id=? AND deleted_at IS NULL',[d.retained_until?new Date(d.retained_until):null,record.id]);
    if(!updated.affectedRows)throw new WorkError(409,'Запись уже удалена');
    await audit(user,'recording.retention.updated','conference',conferenceId,{recording_id:record.id,retained_until:d.retained_until},request);return reply({ok:true});
  }
  throw new WorkError(404,'Метод записи не найден');
}
export async function purgeExpiredRecordings(){
  const records=await rows("SELECT id,object_key FROM conference_recordings WHERE retained_until<=CURRENT_TIMESTAMP AND deleted_at IS NULL AND status IN ('completed','failed') AND transcript_status NOT IN ('queued','running') LIMIT 50");
  for(const record of records){
    // A short transaction serializes retention edits and cleanup across worker replicas.
    await transaction(async c=>{
      const [[locked]]=await c.query('SELECT * FROM conference_recordings WHERE id=? FOR UPDATE',[record.id]);
      if(locked.deleted_at||!locked.retained_until||Date.parse(locked.retained_until)>Date.now())return;
      await deleteObject(locked.object_key);
      await c.query('DELETE FROM conference_recording_transcripts WHERE recording_id=?',[record.id]);
      await c.query('DELETE FROM recording_transcript_edits WHERE recording_id=?',[record.id]);
      await c.query('UPDATE conference_recordings SET deleted_at=CURRENT_TIMESTAMP WHERE id=?',[record.id]);
    });
  }
  return {processed:records.length};
}
