import {assertChatRoomMembership} from './chat-rooms.js';
import {createHash,randomUUID} from 'node:crypto';
import webpush from 'web-push';
import {z} from 'zod';
import {rows,one,transaction} from './db.js';
import {encryptSecret,decryptSecret} from './crypto.js';
import {projectPermissionSet} from './permissions.js';
import {body,reply,WorkError} from './work-common.js';
import {localNotificationTime,mayReadNotification} from './work-personal.js';

export function pushConfig(env=process.env){
 const publicKey=env.WEB_PUSH_PUBLIC_KEY||'',privateKey=env.WEB_PUSH_PRIVATE_KEY||'',subject=env.WEB_PUSH_SUBJECT||'';
 return {enabled:env.WEB_PUSH_ENABLED==='true'&&Boolean(publicKey&&privateKey&&subject),publicKey,privateKey,subject};
}
export function safePushEndpoint(value){
 let url;try{url=new URL(value);}catch{throw new WorkError(422,'Некорректный адрес push-службы');}
 const host=url.hostname;
 const allowed=host==='fcm.googleapis.com'||host==='updates.push.services.mozilla.com'||host.endsWith('.push.services.mozilla.com')||host==='web.push.apple.com'||host.endsWith('.web.push.apple.com')||host.endsWith('.notify.windows.com');
 if(!allowed||url.protocol!=='https:'||url.username||url.password||url.hash||(url.port&&url.port!=='443')||String(value).length>2048)throw new WorkError(422,'Адрес не относится к поддерживаемой push-службе браузера');
 return url.href;
}
const key=(bytes)=>z.string().regex(/^[A-Za-z0-9_-]+$/).refine(v=>Buffer.from(v,'base64url').length===bytes,'Неверный ключ подписки');
export const subscriptionSchema=z.object({endpoint:z.string().transform(safePushEndpoint),keys:z.object({p256dh:key(65).refine(v=>Buffer.from(v,'base64url')[0]===4),auth:key(16)})});
const fingerprint=endpoint=>createHash('sha256').update(endpoint).digest('hex');

export async function browserPushApi(request,path,user){
 if(!user.session_id||user.api_token_id)throw new WorkError(403,'Подписка доступна только из браузера после входа');
 const config=pushConfig();
 if(request.method==='GET'&&path.length===1)return reply({configured:config.enabled,public_key:config.enabled?config.publicKey:null});
 if(request.method==='DELETE'&&path.length===1){const data=z.object({endpoint:z.string().max(2048)}).parse(await body(request));await rows('DELETE FROM browser_push_subscriptions WHERE id=? AND user_id=?',[fingerprint(data.endpoint),user.id]);return reply({ok:true});}
 if(request.method==='POST'&&path.length===1){
  if(!config.enabled)throw new WorkError(409,'Push-уведомления ещё не настроены администратором');
  const subscription=subscriptionSchema.parse(await body(request)),id=fingerprint(subscription.endpoint);
  await transaction(async c=>{
   await c.query('SELECT id FROM users WHERE id=? FOR UPDATE',[user.id]);
   const [[count]]=await c.query('SELECT COUNT(*) AS total FROM browser_push_subscriptions WHERE user_id=? AND id<>?',[user.id,id]);
   if(Number(count.total)>=10)throw new WorkError(422,'Достигнут лимит 10 устройств');
   const [[cursor]]=await c.query('SELECT COALESCE((SELECT MAX(id) FROM user_notifications WHERE user_id=?),0) AS notification_id,COALESCE((SELECT MAX(id) FROM chat_messages),0) AS message_id',[user.id]);
   await c.query(`INSERT INTO browser_push_subscriptions(id,user_id,workspace_id,session_id,subscription_encrypted,last_notification_id,last_chat_message_id) VALUES(?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE last_notification_id=IF(user_id=VALUES(user_id),last_notification_id,VALUES(last_notification_id)),last_chat_message_id=IF(user_id=VALUES(user_id),last_chat_message_id,VALUES(last_chat_message_id)),user_id=VALUES(user_id),workspace_id=VALUES(workspace_id),session_id=VALUES(session_id),subscription_encrypted=VALUES(subscription_encrypted),lease_token=NULL,lease_until=NULL,failures=0,next_attempt_at=CURRENT_TIMESTAMP`,[id,user.id,user.workspace_id,user.session_id,encryptSecret(JSON.stringify(subscription)),cursor.notification_id,cursor.message_id]);
  });return reply({enabled:true});
 }
 throw new WorkError(404,'Метод push не найден');
}

export async function pushItems(user,subscription){
 const notifications=await rows('SELECT * FROM user_notifications WHERE user_id=? AND id>? ORDER BY id LIMIT 100',[user.id,subscription.last_notification_id]);
 const messages=await rows(`SELECT m.id,m.channel_id,m.sender_id,m.deleted_at,c.project_id,cm.last_read_message_id,cm.user_id AS member_id FROM chat_messages m JOIN chat_channels c ON c.id=m.channel_id LEFT JOIN chat_channel_members cm ON cm.channel_id=c.id AND cm.user_id=? WHERE c.workspace_id=? AND m.id>? ORDER BY m.id LIMIT 200`,[user.id,user.workspace_id,subscription.last_chat_message_id]);
 let notify=false,channelId=null;const rights=new Map();
 for(const n of notifications)if(!n.read_at&&await mayReadNotification(user,n)){notify=true;break;}
 for(const m of messages){
  if(m.deleted_at||Number(m.sender_id)===Number(user.id)||Number(m.id)<=Number(m.last_read_message_id||0))continue;
  let allowed=Boolean(m.member_id);
  if(m.project_id){if(!rights.has(m.project_id))rights.set(m.project_id,(await projectPermissionSet(user,m.project_id)).has('chat.use'));allowed=rights.get(m.project_id);}
  if(allowed){try{await assertChatRoomMembership(user,{id:m.channel_id,project_id:m.project_id});channelId=m.channel_id;break;}catch(e){if(![403,404].includes(e.status))throw e;}}
 }
 return {notify:notify||Boolean(channelId),url:channelId?`/?view=chat&channel=${channelId}`:'/?notifications=1',notificationId:notifications.at(-1)?.id||subscription.last_notification_id,messageId:messages.at(-1)?.id||subscription.last_chat_message_id};
}

export async function pollBrowserPush(){
 const config=pushConfig();if(!config.enabled)return;
 const subscriptions=await rows('SELECT id FROM browser_push_subscriptions WHERE next_attempt_at<=CURRENT_TIMESTAMP AND (lease_until IS NULL OR lease_until<CURRENT_TIMESTAMP) ORDER BY next_attempt_at,id LIMIT 30');
 for(const candidate of subscriptions){
  const token=randomUUID();
  const claimed=await rows('UPDATE browser_push_subscriptions SET lease_token=?,lease_until=DATE_ADD(CURRENT_TIMESTAMP,INTERVAL 30 SECOND) WHERE id=? AND next_attempt_at<=CURRENT_TIMESTAMP AND (lease_until IS NULL OR lease_until<CURRENT_TIMESTAMP)',[token,candidate.id]);if(!claimed.affectedRows)continue;
  try{
   const sub=await one('SELECT * FROM browser_push_subscriptions WHERE id=? AND lease_token=?',[candidate.id,token]);if(!sub)continue;
   const user=await one("SELECT u.* FROM users u JOIN user_sessions s ON s.user_id=u.id WHERE u.id=? AND u.workspace_id=? AND u.status='active' AND s.id=? AND s.revoked_at IS NULL AND s.expires_at>CURRENT_TIMESTAMP",[sub.user_id,sub.workspace_id,sub.session_id]);
   if(!user){await rows('DELETE FROM browser_push_subscriptions WHERE id=? AND lease_token=?',[sub.id,token]);continue;}
   const preference=await one('SELECT * FROM notification_preferences WHERE user_id=?',[user.id]);
   if(preference&&localNotificationTime(preference).quiet){await rows('UPDATE browser_push_subscriptions SET next_attempt_at=DATE_ADD(CURRENT_TIMESTAMP,INTERVAL 1 MINUTE),lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=?',[sub.id,token]);continue;}
   const items=await pushItems(user,sub);
   if(items.notify){
    const subscription=subscriptionSchema.parse(JSON.parse(decryptSecret(sub.subscription_encrypted)));
    // Generic payload: no task titles, chat text, filenames or secrets on a locked screen.
    await webpush.sendNotification(subscription,JSON.stringify({title:'Контур',body:'Есть новые сообщения или уведомления',url:items.url,tag:`kontur-${user.id}`}),{vapidDetails:{subject:config.subject,publicKey:config.publicKey,privateKey:config.privateKey},timeout:8000,TTL:300,urgency:'normal'});
   }
   await rows('UPDATE browser_push_subscriptions SET last_notification_id=?,last_chat_message_id=?,failures=0,next_attempt_at=DATE_ADD(CURRENT_TIMESTAMP,INTERVAL 20 SECOND),lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=?',[items.notificationId,items.messageId,sub.id,token]);
  }catch(error){
   if([404,410].includes(error.statusCode))await rows('DELETE FROM browser_push_subscriptions WHERE id=? AND lease_token=?',[candidate.id,token]);
   else await rows('UPDATE browser_push_subscriptions SET failures=failures+1,next_attempt_at=DATE_ADD(CURRENT_TIMESTAMP,INTERVAL 5 MINUTE),lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=?',[candidate.id,token]);
  }
 }
}
