import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { rows,one,transaction,parseJson } from './db.js';
import { encryptSecret,decryptSecret } from './crypto.js';
import { secretHash,newRecoveryCodes,newTotpSecret,verifyTotp } from './totp.js';
import { consumeRate } from './session-store.js';
import { body,reply,WorkError,workspaceFor,positiveId,visibleProjects } from './work-common.js';
import { workspacePermissionSet,projectPermissionSet,PERMISSION_CATALOG } from './permissions.js';
import { audit } from './audit.js';
const timestamp=s=>Date.parse(/[TZ]|[+-]\d\d:\d\d$/.test(s||'')?s:String(s).replace(' ','T')+'Z');
// Ограничивает назначение глобальных руководящих ролей администраторами компании.
export function assertAccountChange(actor,target,patch,activeAdmins=0){
 const privileged=['owner','admin','project_manager','tribe_leader'],full=['owner','admin'];
 if((target?.global_role==='owner'||patch.global_role==='owner')&&actor.global_role!=='owner')throw new WorkError(403,'Только владелец может менять учётную запись владельца');
 if(!full.includes(actor.global_role)&&(privileged.includes(target?.global_role)||privileged.includes(patch.global_role)))throw new WorkError(403,'Назначение и изменение привилегированных учётных записей доступно администратору');
 if(target&&Number(target.id)===Number(actor.id)&&patch.status&&patch.status!=='active')throw new WorkError(409,'Нельзя отключить свою учётную запись');
 if(target?.status==='active'&&full.includes(target.global_role)&&((patch.status&&patch.status!=='active')||(patch.global_role&&!full.includes(patch.global_role)))&&activeAdmins<=1)throw new WorkError(409,'В рабочем пространстве должен остаться действующий владелец или администратор');
}
function browserOnly(user){if(user.api_token_id||!user.session_id)throw new WorkError(403,'Требуется вход через браузер');}
async function recentSession(user,password){browserOnly(user);const created=timestamp(user.session_created_at);if(!Number.isFinite(created)||Date.now()-created>10*60000)throw new WorkError(403,'Для изменения защиты войдите в систему заново');if(user.auth_source==='local'){await consumeRate(`reauth:${user.id}`);const account=await one('SELECT password_hash FROM users WHERE id=?',[user.id]);if(!password||!await bcrypt.compare(password,account.password_hash||''))throw new WorkError(401,'Введите текущий пароль');}}
export async function checkFactor(c,factor,code){
 const counter=verifyTotp(decryptSecret(factor.secret_encrypted),code,{lastCounter:factor.last_counter});
 if(counter!==null){await c.query('UPDATE user_mfa SET last_counter=? WHERE user_id=?',[counter,factor.user_id]);return true;}
 const hashes=parseJson(factor.recovery_hashes_json,[]),hash=secretHash(String(code).replace(/[\s-]/g,'').toLowerCase());
 if(hashes.includes(hash)){await c.query('UPDATE user_mfa SET recovery_hashes_json=? WHERE user_id=?',[JSON.stringify(hashes.filter(h=>h!==hash)),factor.user_id]);return true;}return false;
}
export async function completeMfaChallenge(raw,code){
 const hash=secretHash(String(raw||'')),initial=await one('SELECT user_id FROM auth_challenges WHERE token_hash=? AND used_at IS NULL AND expires_at>CURRENT_TIMESTAMP',[hash]);if(!initial)throw new WorkError(401,'Время подтверждения истекло. Войдите заново');
 await consumeRate(`mfa:${initial.user_id}`,{max:8});
 const result=await transaction(async c=>{const [[user]]=await c.query("SELECT * FROM users WHERE id=? AND status='active' FOR UPDATE",[initial.user_id]);if(!user)return null;
 const [[challenge]]=await c.query('SELECT user_id FROM auth_challenges WHERE token_hash=? AND used_at IS NULL AND expires_at>CURRENT_TIMESTAMP FOR UPDATE',[hash]);if(!challenge)return null;
 const [[factor]]=await c.query('SELECT * FROM user_mfa WHERE user_id=? AND enabled=TRUE FOR UPDATE',[user.id]);if(!factor||!await checkFactor(c,factor,code))return null;
 await c.query('UPDATE auth_challenges SET used_at=CURRENT_TIMESTAMP WHERE token_hash=?',[hash]);return user;});
 if(!result)throw new WorkError(401,'Неверный или уже использованный код');return result;
}
export async function securityApi(request,path,user){
 const method=request.method;browserOnly(user);
 if(path[1]==='sessions'){
  const target=new URL(request.url).searchParams.get('user_id');let id=user.id;if(target&&Number(target)!==Number(user.id)){await workspaceFor(user,'auth.manage');id=positiveId.parse(target);if(!await one('SELECT id FROM users WHERE id=? AND workspace_id=?',[id,user.workspace_id]))throw new WorkError(404,'Пользователь недоступен');}
  if(method==='GET')return reply((await rows('SELECT id,user_agent,created_at,last_seen_at,expires_at,mfa_verified FROM user_sessions WHERE user_id=? AND revoked_at IS NULL AND expires_at>CURRENT_TIMESTAMP ORDER BY last_seen_at DESC',[id])).map(s=>({...s,current:s.id===user.session_id})));
  if(method==='DELETE'){if(path[2]==='others')await rows('UPDATE user_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE user_id=? AND id<>? AND revoked_at IS NULL',[id,user.session_id]);else await rows('UPDATE user_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE user_id=? AND id=?',[id,z.string().uuid().parse(path[2])]);await audit(user,'session.revoked','user',id,{},request);return reply({ok:true});}
 }
 if(path[1]==='mfa'){
  if(method==='GET'){const f=await one('SELECT enabled,recovery_hashes_json,changed_at FROM user_mfa WHERE user_id=?',[user.id]);return reply({enabled:Boolean(f?.enabled),recovery_codes_left:parseJson(f?.recovery_hashes_json,[]).length,changed_at:f?.changed_at||null});}
  if(method==='POST'&&path[2]==='setup'){
   const d=z.object({password:z.string().max(500).optional()}).parse(await body(request));await recentSession(user,d.password);const secret=newTotpSecret();
   await transaction(async c=>{await c.query('SELECT id FROM users WHERE id=? FOR UPDATE',[user.id]);const [[f]]=await c.query('SELECT enabled FROM user_mfa WHERE user_id=? FOR UPDATE',[user.id]);if(f?.enabled)throw new WorkError(409,'Двухфакторный вход уже включён');await c.query('INSERT INTO user_mfa(user_id,pending_secret_encrypted,pending_expires_at) VALUES(?,?,DATE_ADD(CURRENT_TIMESTAMP,INTERVAL 10 MINUTE)) ON DUPLICATE KEY UPDATE pending_secret_encrypted=VALUES(pending_secret_encrypted),pending_expires_at=VALUES(pending_expires_at)',[user.id,encryptSecret(secret)]);});return reply({secret,uri:`otpauth://totp/${encodeURIComponent(`Контур:${user.email}`)}?secret=${secret}&issuer=${encodeURIComponent('Контур')}&algorithm=SHA1&digits=6&period=30`});
  }
  if(method==='POST'&&path[2]==='enable'){
   const d=z.object({code:z.string().regex(/^\d{6}$/)}).parse(await body(request));await consumeRate(`mfa:${user.id}`,{max:8});const codes=newRecoveryCodes();
   await transaction(async c=>{await c.query('SELECT id FROM users WHERE id=? FOR UPDATE',[user.id]);const [[f]]=await c.query('SELECT * FROM user_mfa WHERE user_id=? AND pending_expires_at>CURRENT_TIMESTAMP AND enabled=FALSE FOR UPDATE',[user.id]);if(!f)throw new WorkError(409,'Настройка истекла. Получите новый секрет');const counter=verifyTotp(decryptSecret(f.pending_secret_encrypted),d.code);if(counter===null)throw new WorkError(401,'Неверный код');await c.query('UPDATE user_mfa SET enabled=TRUE,secret_encrypted=pending_secret_encrypted,pending_secret_encrypted=NULL,pending_expires_at=NULL,last_counter=?,recovery_hashes_json=?,changed_at=CURRENT_TIMESTAMP WHERE user_id=?',[counter,JSON.stringify(codes.map(secretHash)),user.id]);await c.query('UPDATE user_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE user_id=? AND id<>?',[user.id,user.session_id]);await c.query('UPDATE user_sessions SET mfa_verified=TRUE WHERE id=?',[user.session_id]);});await audit(user,'mfa.enabled','user',user.id,{},request);return reply({recovery_codes:codes});
  }
  if(method==='POST'&&['disable','recovery'].includes(path[2])){
   const d=z.object({code:z.string().min(6).max(40),password:z.string().max(500).optional()}).parse(await body(request));await recentSession(user,d.password);await consumeRate(`mfa:${user.id}`,{max:8});const codes=path[2]==='recovery'?newRecoveryCodes():null;
   await transaction(async c=>{await c.query('SELECT id FROM users WHERE id=? FOR UPDATE',[user.id]);const [[f]]=await c.query('SELECT * FROM user_mfa WHERE user_id=? AND enabled=TRUE FOR UPDATE',[user.id]);if(!f||!await checkFactor(c,f,d.code))throw new WorkError(401,'Неверный или уже использованный код');if(codes)await c.query('UPDATE user_mfa SET recovery_hashes_json=?,changed_at=CURRENT_TIMESTAMP WHERE user_id=?',[JSON.stringify(codes.map(secretHash)),user.id]);else await c.query('DELETE FROM user_mfa WHERE user_id=?',[user.id]);await c.query('UPDATE user_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE user_id=? AND id<>?',[user.id,user.session_id]);});await audit(user,`mfa.${path[2]}`,'user',user.id,{},request);return reply(codes?{recovery_codes:codes}:{ok:true});
  }
 }
 if(path[1]==='access-preview'&&method==='GET'){
  await workspaceFor(user,'role.manage');const url=new URL(request.url);
  if(url.searchParams.has('role_id')){const role=await one('SELECT * FROM access_roles WHERE id=? AND workspace_id=?',[positiveId.parse(url.searchParams.get('role_id')),user.workspace_id]);if(!role)throw new WorkError(404,'Роль не найдена');return reply({mode:'role',name:role.name,scope:role.scope,decisions:await rows('SELECT permission_key,effect FROM access_role_permissions WHERE role_id=?',[role.id]),catalog:PERMISSION_CATALOG,note:'Показаны разрешения роли. Итоговые права пользователя учитывают все назначения, группы и запреты.'});}
  const target=await one('SELECT id,workspace_id,display_name,global_role,status FROM users WHERE id=? AND workspace_id=?',[positiveId.parse(url.searchParams.get('user_id')),user.workspace_id]);if(!target)throw new WorkError(404,'Пользователь недоступен');const projects=await visibleProjects(user),active=target.status==='active';return reply({mode:'user',name:target.display_name,status:target.status,workspace:active?[...await workspacePermissionSet(target)]:[],projects:await Promise.all(projects.map(async p=>({id:p.id,name:p.name,permissions:active?[...await projectPermissionSet(target,p)]:[]}))),catalog:PERMISSION_CATALOG,note:'Просмотр не создаёт сессию пользователя и не меняет назначения.'});
 }
 throw new WorkError(404,'Метод безопасности не найден');
}
