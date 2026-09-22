import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {AccessToken,RoomServiceClient,WebhookReceiver} from 'livekit-server-sdk';
import {rows,one,transaction,parseJson} from './db.js';
import {body,reply,positiveId,WorkError,validUsers} from './work-common.js';
import {recordingConferenceAccess} from './recordings.js';
import {hasProjectPermission} from './permissions.js';
export const pollSchema=z.object({question:z.string().trim().min(2).max(500),options:z.array(z.string().trim().min(1).max(180)).min(2).max(10).refine(v=>new Set(v.map(o=>o.toLocaleLowerCase('ru'))).size===v.length,'Варианты не должны повторяться'),results_visible:z.boolean().default(true)});
const moderate=(user,conference)=>Number(user.id)===Number(conference.created_by)?Promise.resolve(true):hasProjectPermission(user,conference.project_id,'conference.manage');
const active=conference=>{if(['completed','cancelled'].includes(conference.status))throw new WorkError(409,'Конференция завершена');};
export async function conferenceAdmission(user,conference){
 if(!conference.waiting_room||await moderate(user,conference))return {admitted:true};
 await rows("INSERT IGNORE INTO conference_admissions(conference_id,user_id) VALUES(?,?)",[conference.id,user.id]);
 const state=await one('SELECT status FROM conference_admissions WHERE conference_id=? AND user_id=?',[conference.id,user.id]);
 if(state?.status==='denied')throw new WorkError(403,'Организатор отклонил запрос на вход');
 return {admitted:state?.status==='admitted',waiting:state?.status!=='admitted',user_id:user.id};
}
function mediaConfig(){const {LIVEKIT_API_URL:apiUrl,LIVEKIT_WS_URL:url,LIVEKIT_API_KEY:key,LIVEKIT_API_SECRET:secret}=process.env;if(!apiUrl||!url||!key||!secret)throw new WorkError(503,'Медиасервер не настроен');return {apiUrl,url,key,secret};}
export async function ensureLivekitRoom(roomKey,metadata={}){
 const cfg=mediaConfig();try{await new RoomServiceClient(cfg.apiUrl,cfg.key,cfg.secret).createRoom({name:roomKey,emptyTimeout:900,departureTimeout:120,metadata:JSON.stringify(metadata)});}catch(e){if(!/already exists|already_exist/i.test(String(e?.message||'')))throw new WorkError(503,'Медиасервер временно недоступен');}
}
export async function disconnectMediaRoom(roomKey){
 try{const cfg=mediaConfig();await new RoomServiceClient(cfg.apiUrl,cfg.key,cfg.secret).deleteRoom(roomKey);return true;}catch(e){return e?.code==='not_found';}
}
export async function closeConferenceRooms(conference){
 const rooms=await transaction(async c=>{
  await c.query('SELECT id FROM conferences WHERE id=? FOR UPDATE',[conference.id]);
  const [rooms]=await c.query('SELECT room_key FROM conference_breakouts WHERE conference_id=?',[conference.id]);
  await c.query('UPDATE conference_breakouts SET closed=TRUE WHERE conference_id=?',[conference.id]);return rooms;
 });
 const results=await Promise.all([conference.room_key,...rooms.map(r=>r.room_key)].map(disconnectMediaRoom));
 return results.every(Boolean);
}
export function summarizeAttendance(sessions,now=new Date()){
 const users=new Map();for(const row of sessions){if(!users.has(row.user_id))users.set(row.user_id,{user_id:row.user_id,display_name:row.display_name,intervals:[],sessions:0,open_sessions:0});const p=users.get(row.user_id);p.sessions++;if(row.joined_at&&!row.left_at)p.open_sessions++;if(!row.joined_at)continue;const stamp=v=>new Date(typeof v==='string'?v.replace(' ','T').replace(/Z?$/,'Z'):v).getTime(),start=stamp(row.joined_at),end=row.left_at?stamp(row.left_at):now.getTime();if(Number.isFinite(start)&&Number.isFinite(end)&&end>=start)p.intervals.push([start,end]);}
 return [...users.values()].map(p=>{let total=0,last=null;for(const item of p.intervals.sort((a,b)=>a[0]-b[0])){if(last&&item[0]<=last[1])last[1]=Math.max(last[1],item[1]);else{if(last)total+=last[1]-last[0];last=[...item];}}if(last)total+=last[1]-last[0];return {user_id:p.user_id,display_name:p.display_name,sessions:p.sessions,open_sessions:p.open_sessions,minutes:Math.round(total/60000),first_joined_at:p.intervals.length?new Date(p.intervals[0][0]).toISOString():null};});
}
export async function conferenceToolsApi(request,path,user){
 const url=new URL(request.url),conference=await recordingConferenceAccess(user,positiveId.parse(path[1]),null,url.searchParams.get('join_code')),canModerate=await moderate(user,conference),kind=path[2],method=request.method;
 if(['lobby','candidates','attendance','settings'].includes(kind)&&!canModerate)throw new WorkError(403,'Действие доступно организатору или модератору');
 if(method!=='GET')active(conference);
 if(kind==='settings'&&method==='PATCH'){const d=z.object({waiting_room:z.boolean()}).parse(await body(request));await rows('UPDATE conferences SET waiting_room=? WHERE id=?',[d.waiting_room,conference.id]);return reply({ok:true});}
 if(kind==='lobby'){
  if(method==='GET')return reply({waiting_room:Boolean(conference.waiting_room),people:await rows("SELECT a.user_id,a.status,a.requested_at,u.display_name,u.avatar_color FROM conference_admissions a JOIN users u ON u.id=a.user_id WHERE a.conference_id=? AND a.status='waiting' AND u.status='active' ORDER BY a.requested_at LIMIT 3000",[conference.id])});
  if(method==='PATCH'){const d=z.object({user_id:positiveId,status:z.enum(['admitted','denied'])}).parse(await body(request));const result=await rows("UPDATE conference_admissions SET status=?,decided_by=?,decided_at=CURRENT_TIMESTAMP WHERE conference_id=? AND user_id=? AND status='waiting'",[d.status,user.id,conference.id,d.user_id]);if(!result.affectedRows)throw new WorkError(409,'Запрос уже обработан');return reply({ok:true});}
 }
 if(kind==='candidates'&&method==='GET')return reply(await rows("SELECT u.id,u.display_name FROM conference_participants p JOIN users u ON u.id=p.user_id WHERE p.conference_id=? AND u.status='active' ORDER BY u.display_name",[conference.id]));
 if(kind==='attendance'&&method==='GET'){const sessions=await rows('SELECT a.*,u.display_name FROM conference_attendance a JOIN users u ON u.id=a.user_id WHERE a.conference_id=? ORDER BY a.joined_at,a.participant_sid',[conference.id]);return reply({people:summarizeAttendance(sessions),sessions,source:'livekit_webhook',note:'Фактические подключения из подписанных событий LiveKit. Без webhook журнал не заполняется; незавершённые интервалы помечены в sessions.'});}
 if(conference.waiting_room&&!canModerate&&(await one('SELECT status FROM conference_admissions WHERE conference_id=? AND user_id=?',[conference.id,user.id]))?.status!=='admitted')throw new WorkError(403,'Дождитесь допуска организатора');
 if(kind==='polls'){
  if(method==='GET'){const [polls,counts,votes]=await Promise.all([rows('SELECT * FROM conference_polls WHERE conference_id=? ORDER BY id DESC LIMIT 100',[conference.id]),rows('SELECT v.poll_id,v.option_index,COUNT(*) AS count FROM conference_votes v JOIN conference_polls p ON p.id=v.poll_id WHERE p.conference_id=? GROUP BY v.poll_id,v.option_index',[conference.id]),rows('SELECT v.poll_id,v.option_index FROM conference_votes v JOIN conference_polls p ON p.id=v.poll_id WHERE p.conference_id=? AND v.user_id=?',[conference.id,user.id])]);return reply({polls:polls.map(p=>({...p,options_json:undefined,options:parseJson(p.options_json,[]),my_vote:votes.find(v=>v.poll_id===p.id)?.option_index??null,counts:canModerate||p.results_visible||p.closed?counts.filter(v=>v.poll_id===p.id):null})),can_moderate:canModerate});}
  if(method==='POST'&&!path[3]){if(!canModerate)throw new WorkError(403,'Опросы создаёт модератор');const d=pollSchema.parse(await body(request));const result=await rows('INSERT INTO conference_polls(conference_id,question,options_json,results_visible,created_by) VALUES(?,?,?,?,?)',[conference.id,d.question,JSON.stringify(d.options),d.results_visible,user.id]);return reply({id:result.insertId},201);}
  if(method==='PATCH'&&path[3]){if(!canModerate)throw new WorkError(403,'Опросы закрывает модератор');const d=z.object({closed:z.boolean(),revision:positiveId}).parse(await body(request));const result=await rows('UPDATE conference_polls SET closed=?,revision=revision+1 WHERE id=? AND conference_id=? AND revision=?',[d.closed,positiveId.parse(path[3]),conference.id,d.revision]);if(!result.affectedRows)throw new WorkError(409,'Опрос изменён или недоступен');return reply({ok:true});}
  if(method==='POST'&&path[4]==='vote'){const d=z.object({option_index:z.number().int().min(0).max(9)}).parse(await body(request));return transaction(async c=>{const [[poll]]=await c.query('SELECT * FROM conference_polls WHERE id=? AND conference_id=? FOR UPDATE',[positiveId.parse(path[3]),conference.id]);if(!poll)throw new WorkError(404,'Опрос не найден');if(poll.closed)throw new WorkError(409,'Опрос закрыт');if(d.option_index>=parseJson(poll.options_json,[]).length)throw new WorkError(422,'Вариант не найден');await c.query('INSERT INTO conference_votes(poll_id,user_id,option_index) VALUES(?,?,?) ON DUPLICATE KEY UPDATE option_index=VALUES(option_index)',[poll.id,user.id,d.option_index]);return reply({ok:true});});}
 }
 if(kind==='breakouts'){
  if(method==='GET'){const rooms=await rows('SELECT b.id,b.name,b.closed,(SELECT COUNT(*) FROM conference_breakout_members m WHERE m.breakout_id=b.id) AS members FROM conference_breakouts b WHERE b.conference_id=? AND (?=TRUE OR EXISTS(SELECT 1 FROM conference_breakout_members m WHERE m.breakout_id=b.id AND m.user_id=?)) ORDER BY b.id',[conference.id,canModerate,user.id]);return reply({rooms,can_moderate:canModerate});}
  if(method==='POST'&&!path[3]){if(!canModerate)throw new WorkError(403,'Комнаты создаёт модератор');const d=z.object({name:z.string().trim().min(2).max(180),member_ids:z.array(positiveId).min(1).max(3000)}).parse(await body(request)),members=[...new Set(d.member_ids)];await validUsers(user,members);const found=await rows(`SELECT user_id FROM conference_participants WHERE conference_id=? AND user_id IN (${members.map(()=>'?')})`,[conference.id,...members]);if(found.length!==members.length)throw new WorkError(422,'Выберите участников этой конференции');return transaction(async c=>{const [[locked]]=await c.query('SELECT status FROM conferences WHERE id=? FOR UPDATE',[conference.id]);if(!locked)throw new WorkError(404,'Конференция не найдена');active(locked);const [[count]]=await c.query('SELECT COUNT(*) AS value FROM conference_breakouts WHERE conference_id=? AND closed=FALSE',[conference.id]);if(count.value>=30)throw new WorkError(422,'Можно открыть не более 30 комнат');const [created]=await c.query('INSERT INTO conference_breakouts(conference_id,name,room_key,created_by) VALUES(?,?,?,?)',[conference.id,d.name,randomUUID(),user.id]);for(let i=0;i<members.length;i+=500){const chunk=members.slice(i,i+500);await c.query(`INSERT INTO conference_breakout_members(breakout_id,user_id) VALUES ${chunk.map(()=>'(?,?)')}`,chunk.flatMap(id=>[created.insertId,id]));}return reply({id:created.insertId},201);});}
  if(path[3]){const room=await one('SELECT * FROM conference_breakouts WHERE id=? AND conference_id=?',[positiveId.parse(path[3]),conference.id]);if(!room)throw new WorkError(404,'Комната не найдена');
   if(method==='PATCH'){if(!canModerate)throw new WorkError(403,'Комнаты закрывает модератор');z.object({closed:z.literal(true)}).parse(await body(request));await rows('UPDATE conference_breakouts SET closed=TRUE WHERE id=?',[room.id]);const media_disconnected=await disconnectMediaRoom(room.room_key);return reply({ok:true,media_disconnected});}
   if(method==='POST'&&path[4]==='token'){if(room.closed)throw new WorkError(409,'Комната закрыта');if(!canModerate&&!await one('SELECT user_id FROM conference_breakout_members WHERE breakout_id=? AND user_id=?',[room.id,user.id]))throw new WorkError(403,'Вы не назначены в эту комнату');await ensureLivekitRoom(room.room_key,{conference_id:conference.id,breakout_id:room.id});const fresh=await one('SELECT b.closed,c.status FROM conference_breakouts b JOIN conferences c ON c.id=b.conference_id WHERE b.id=?',[room.id]);if(!fresh||fresh.closed||['completed','cancelled'].includes(fresh.status)){const cfg=mediaConfig();await new RoomServiceClient(cfg.apiUrl,cfg.key,cfg.secret).deleteRoom(room.room_key).catch(()=>{});throw new WorkError(409,'Комната уже закрыта');}const cfg=mediaConfig(),token=new AccessToken(cfg.key,cfg.secret,{identity:`user-${user.id}`,name:user.display_name,ttl:300,metadata:JSON.stringify({user_id:user.id,conference_id:conference.id,breakout_id:room.id})});token.addGrant({roomJoin:true,room:room.room_key,canPublish:true,canSubscribe:true,canPublishData:false});return reply({token:await token.toJwt(),url:cfg.url,can_publish:true,can_moderate:canModerate,role:'participant',user_id:user.id,display_name:user.display_name});}
  }
 }
 throw new WorkError(404,'Инструмент конференции не найден');
}
export async function livekitAttendanceWebhook(request){
 const secret=process.env.LIVEKIT_API_SECRET,key=process.env.LIVEKIT_API_KEY;if(!secret||!key)throw new WorkError(503,'Медиасервер не настроен');
 const raw=await request.text();if(Buffer.byteLength(raw)>1000000)throw new WorkError(413,'Событие слишком большое');let event;try{event=await new WebhookReceiver(key,secret).receive(raw,request.headers.get('authorization')||'');}catch{throw new WorkError(401,'Недействительная подпись медиасервера');}
 if(!['participant_joined','participant_left','room_finished'].includes(event.event))return reply({ok:true});
 if(!event.id||!event.room?.name)return reply({ok:true});
 const conference=await one('SELECT c.id,c.workspace_id FROM conferences c LEFT JOIN conference_breakouts b ON b.conference_id=c.id WHERE c.room_key=? OR b.room_key=? LIMIT 1',[event.room.name,event.room.name]);if(!conference)return reply({ok:true});
 const at=new Date(Number(event.createdAt)*1000);if(!Number.isFinite(at.getTime()))throw new WorkError(422,'Нет времени события');
 await transaction(async c=>{const [inserted]=await c.query('INSERT IGNORE INTO conference_media_events(event_id) VALUES(?)',[event.id]);if(!inserted.affectedRows)return;
  if(event.event==='room_finished'){await c.query('UPDATE conferences SET media_room_ready_at=NULL WHERE id=? AND room_key=?',[conference.id,event.room.name]);await c.query('UPDATE conference_attendance SET left_at=? WHERE conference_id=? AND room_key=? AND left_at IS NULL',[at,conference.id,event.room.name]);return;}
  const match=/^user-(\d+)$/.exec(event.participant?.identity||'');if(!match||!event.participant?.sid)return;const [[person]]=await c.query('SELECT id FROM users WHERE id=? AND workspace_id=?',[Number(match[1]),conference.workspace_id]);if(!person)return;
  const joining=event.event==='participant_joined';await c.query(`INSERT INTO conference_attendance(participant_sid,conference_id,user_id,room_key,joined_at,left_at) VALUES(?,?,?,?,?,?) ON DUPLICATE KEY UPDATE ${joining?'joined_at=IF(joined_at IS NULL,VALUES(joined_at),LEAST(joined_at,VALUES(joined_at)))':'left_at=IF(left_at IS NULL,VALUES(left_at),GREATEST(left_at,VALUES(left_at)))'}`,[event.participant.sid,conference.id,person.id,event.room.name,joining?at:null,joining?null:at]);
 });return reply({ok:true});
}
