import {rows,one,transaction,parseJson} from './db.js';
import {WorkError,projectFor,workspaceFor} from './work-common.js';
import {projectPermissionSet} from './permissions.js';
import {integrationRequest,integrationUrl} from './integration-http.js';
import {recordingConferenceAccess} from './recordings.js';
import {utc} from './business-time.js';
import {calendarDocument,parseCalendar} from './calendar-format.js';
import {snapshotHash,safeExternalKey,syncError} from './external-sync-model.js';
import {changeTask} from './work-tasks.js';
import {audit} from './audit.js';
const iso=d=>new Date(utc(d)).toISOString();
export async function syncLocal(connection,binding,user){
 if(connection.kind==='caldav'){
  await workspaceFor(user,'calendar.connect');const c=await recordingConferenceAccess(user,binding.entity_id);await projectFor(user,c.project_id);
  const cp=await one('SELECT response FROM conference_participants WHERE conference_id=? AND user_id=?',[c.id,user.id]);
  return {record:c,snapshot:{title:c.title,description:c.description||'',start:iso(c.scheduled_start),end:iso(c.scheduled_end),status:c.status==='cancelled'?'cancelled':'scheduled',response:cp?.response||'pending'}};
 }
 await workspaceFor(user,'integration.manage');await projectFor(user,connection.project_id,'project.admin',true);
 const task=await one('SELECT t.*,s.is_done FROM tasks t JOIN workflow_stages s ON s.id=t.stage_id WHERE t.id=? AND t.project_id=?',[binding.entity_id,connection.project_id]);if(!task)throw syncError('LOCAL_UNAVAILABLE');
 return {record:task,snapshot:{title:task.title,description:task.description||'',due_date:task.due_date||null,stage_id:task.stage_id,assignee_id:task.assignee_id||null}};
}
function endpoint(connection,binding,credentials){
 const base=integrationUrl(credentials.url);if(base.search)throw syncError('CONFIG_INVALID');
 safeExternalKey(connection.kind,binding.external_key);
 return connection.kind==='caldav'?`${base.href.replace(/\/$/,'')}/${binding.external_key}.ics`:`${base.href.replace(/\/$/,'')}/api/v4/projects/${connection.config.remote_project_id}/issues/${binding.external_key}`;
}
const auth=(kind,credentials)=>kind==='caldav'?{Authorization:`Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')}`}:{'PRIVATE-TOKEN':credentials.token};
export async function syncRemote(connection,binding,credentials,user){
 const url=endpoint(connection,binding,credentials),response=await integrationRequest(url,{headers:auth(connection.kind,credentials),maxResponseBytes:512000});
 if(response.status===404)return {snapshot:null,etag:null};
 if(response.status!==200)throw syncError(`HTTP_${response.status}`);
 if(connection.kind==='caldav')return {snapshot:parseCalendar(response.text,binding.external_key,user.email),etag:response.headers.etag||null};
 let issue;try{issue=JSON.parse(response.text);}catch{throw syncError('INVALID_RESPONSE');}
 if(!issue.title||String(issue.iid)!==binding.external_key||String(issue.project_id)!==String(connection.config.remote_project_id))throw syncError('INVALID_RESPONSE');
 if(issue.assignees?.length>1)throw syncError('UNMAPPED_USER');
 const remoteUser=issue.assignees?.[0]?.id,assignee=remoteUser?connection.config.users[String(remoteUser)]:null;
 if(remoteUser&&!assignee)throw syncError('UNMAPPED_USER');
 return {snapshot:{title:issue.title,description:issue.description||'',due_date:issue.due_date||null,stage_id:issue.state==='closed'?connection.config.closed_stage_id:connection.config.open_stage_id,assignee_id:assignee||null},etag:issue.updated_at};
}
async function currentSyncUser(connection,user){
 const actor=await one("SELECT * FROM users WHERE id=? AND workspace_id=? AND status='active'",[user.id,user.workspace_id]);if(!actor)throw syncError('ACCESS_REVOKED');
 const held=await one('SELECT id FROM external_connections WHERE id=? AND enabled=TRUE AND lease_token=? AND lease_until>CURRENT_TIMESTAMP',[connection.id,connection.lease_token]);if(!held)throw syncError('LEASE_LOST');return actor;
}
export async function pushExternal(connection,binding,credentials,user,local,remote){
 user=await currentSyncUser(connection,user);
 const url=endpoint(connection,binding,credentials),headers=auth(connection.kind,credentials);let body;
 if(connection.kind==='caldav'){
  if(remote.snapshot&&!remote.etag)throw syncError('ETAG_REQUIRED');
  headers['content-type']='text/calendar; charset=utf-8';headers[remote.snapshot?'if-match':'if-none-match']=remote.snapshot?remote.etag:'*';body=calendarDocument(binding.external_key,local.snapshot,user.email);
 }else{
  if(!remote.snapshot)throw syncError('REMOTE_MISSING');
  if(![connection.config.open_stage_id,connection.config.closed_stage_id].includes(Number(local.snapshot.stage_id)))throw syncError('UNMAPPED_STAGE');
  const remoteUser=local.snapshot.assignee_id?Object.keys(connection.config.users).find(k=>Number(connection.config.users[k])===Number(local.snapshot.assignee_id)):null;
  if(local.snapshot.assignee_id&&!remoteUser)throw syncError('UNMAPPED_USER');
  body=JSON.stringify({title:local.snapshot.title,description:local.snapshot.description,due_date:local.snapshot.due_date||'',assignee_ids:remoteUser?[Number(remoteUser)]:[],state_event:Number(local.snapshot.stage_id)===connection.config.closed_stage_id?'close':'reopen'});
  const checked=await syncRemote(connection,binding,credentials,user);if(checked.etag!==remote.etag||snapshotHash(checked.snapshot)!==snapshotHash(remote.snapshot))throw syncError('REMOTE_CHANGED');
 }
 const latest=await syncLocal(connection,binding,user);if(snapshotHash(latest.snapshot)!==snapshotHash(local.snapshot))throw syncError('LOCAL_CHANGED');
 const response=await integrationRequest(url,{method:'PUT',headers,body,maxResponseBytes:512000});if(![200,201,204].includes(response.status))throw syncError(response.status===412?'REMOTE_CHANGED':`HTTP_${response.status}`);
 return syncRemote(connection,binding,credentials,user);
}
export async function pullExternal(connection,binding,user,local,remote){
 user=await currentSyncUser(connection,user);
 await syncLocal(connection,binding,user);
 if(!remote.snapshot)throw syncError('REMOTE_MISSING');
 if(connection.kind==='gitlab'){
  return transaction(async c=>{
   const [[locked]]=await c.query('SELECT version_number FROM tasks WHERE id=? FOR UPDATE',[binding.entity_id]);if(locked?.version_number!==local.record.version_number)throw syncError('LOCAL_CHANGED');
   await changeTask(user,binding.entity_id,remote.snapshot,c);
  });
 }
 const incoming=remote.snapshot,current=local.snapshot;
 const meetingFields=['title','description','start','end','status'],changes=meetingFields.some(key=>incoming[key]!==current[key]);
 if(changes&&Number(local.record.created_by)!==Number(user.id)&&!(await projectPermissionSet(user,local.record.project_id)).has('conference.manage'))throw syncError('ORGANIZER_REQUIRED');
 if(changes&&local.record.status!=='scheduled')throw syncError('MEETING_NOT_SCHEDULED');
 await transaction(async c=>{
  const [[locked]]=await c.query('SELECT * FROM conferences WHERE id=? FOR UPDATE',[binding.entity_id]);
  const [[participant]]=await c.query('SELECT response FROM conference_participants WHERE conference_id=? AND user_id=? FOR UPDATE',[binding.entity_id,user.id]);
  if(!locked||locked.updated_at!==local.record.updated_at||locked.title!==local.record.title||(locked.description||'')!==(local.record.description||'')||locked.status!==local.record.status||locked.scheduled_start!==local.record.scheduled_start||locked.scheduled_end!==local.record.scheduled_end||(participant?.response||'pending')!==current.response)throw syncError('LOCAL_CHANGED');
  if(changes)await c.query('UPDATE conferences SET title=?,description=?,scheduled_start=?,scheduled_end=?,status=?,reminder_sent_at=NULL WHERE id=?',[incoming.title,incoming.description,new Date(incoming.start),new Date(incoming.end),incoming.status,binding.entity_id]);
  if(incoming.response!==current.response)await c.query('UPDATE conference_participants SET response=?,responded_at=CURRENT_TIMESTAMP WHERE conference_id=? AND user_id=?',[incoming.response,binding.entity_id,user.id]);
 });await audit(user,'calendar.meeting.updated','conference',binding.entity_id,{fields:meetingFields.filter(k=>incoming[k]!==current[k])});
}
