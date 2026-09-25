import { z } from 'zod';
import { rows, one, parseJson, transaction } from './db.js';
import { WorkError, projectFor, positiveId, reply, body, workspaceFor, validUsers } from './work-common.js';
import { projectPermissionSet, PROJECT_MEMBERSHIP_DEFAULTS } from './permissions.js';
import { audit } from './audit.js';
import {tribeAccess} from './tribe-policy.js';

export async function fieldAccess(user,projectId){
  const policies=await rows('SELECT * FROM task_field_access WHERE project_id=?',[projectId]);
  if(!policies.length)return [];
  const admin=(!user.is_service&&['owner','admin'].includes(user.global_role))||(await projectPermissionSet(user,projectId)).has('project.access.manage');
  const groups=admin?[]:await rows(`WITH RECURSIVE mine AS (
    SELECT g.id,g.parent_group_id,CAST(g.id AS CHAR(2000)) AS path FROM access_groups g JOIN access_group_members m ON m.group_id=g.id
    WHERE g.workspace_id=? AND g.active=TRUE AND m.user_id=? AND (m.expires_at IS NULL OR m.expires_at>CURRENT_TIMESTAMP)
    UNION ALL SELECT g.id,g.parent_group_id,CONCAT(mine.path,',',g.id) FROM access_groups g JOIN mine ON g.id=mine.parent_group_id
    WHERE g.active=TRUE AND FIND_IN_SET(g.id,mine.path)=0) SELECT DISTINCT id FROM mine`,[user.workspace_id,user.id]);
  const principals=new Set([`user:${user.id}`,...groups.map(g=>`group:${g.id}`)]);
  const allows=list=>admin||parseJson(list,[]).some(p=>principals.has(p));
  return policies.map(p=>({...p,can_read:allows(p.readers_json),can_edit:allows(p.readers_json)&&allows(p.editors_json)}));
}
export function redactFields(value,policies){
  if(!value||typeof value!=='object')return value;
  const hidden=new Set(policies.filter(p=>!p.can_read).map(p=>p.field_code));
  const result={...value};
  for(const key of ['custom_values','custom_values_json'])if(Object.hasOwn(result,key)){
    const custom={...parseJson(result[key],{})};for(const code of hidden)delete custom[code];
    result[key]=key.endsWith('_json')?JSON.stringify(custom):custom;
  }
  result.field_access=Object.fromEntries(policies.map(p=>[p.field_code,{read:p.can_read,edit:p.can_edit}]));
  return result;
}
export async function assertFieldEdits(user,projectId,patch,existing={}){
  if(!patch)return;
  for(const policy of await fieldAccess(user,projectId))if(!policy.can_edit&&Object.hasOwn(patch,policy.field_code)&&JSON.stringify(patch[policy.field_code])!==JSON.stringify(existing[policy.field_code]))throw new WorkError(403,`Нет права изменять атрибут «${policy.field_code}»`);
}
export async function sanitizeWorkResponse(user,value){
  if(!value||typeof value!=='object')return value;
  const restricted=await rows('SELECT DISTINCT f.project_id FROM task_field_access f JOIN projects p ON p.id=f.project_id WHERE p.workspace_id=?',[user.workspace_id]);
  if(!restricted.length)return value;
  const policies=new Map(await Promise.all(restricted.map(async p=>[Number(p.project_id),await fieldAccess(user,p.project_id)])));
  const taskIds=new Set();
  function collect(item){if(Array.isArray(item))item.forEach(collect);else if(item&&typeof item==='object'){if(Number.isSafeInteger(Number(item.task_id))&&Number(item.task_id)>0)taskIds.add(Number(item.task_id));Object.values(item).forEach(collect);}}
  collect(value);
  const taskProjects=taskIds.size?new Map((await rows(`SELECT id,project_id FROM tasks WHERE id IN (${[...taskIds].map(()=>'?')})`,[...taskIds])).map(t=>[Number(t.id),Number(t.project_id)])):new Map();
  function walk(item,projectId=null){
    if(Array.isArray(item))return item.map(x=>walk(x,projectId));
    if(!item||typeof item!=='object')return item;
    const pid=Number(item.project_id||taskProjects.get(Number(item.task_id))||projectId)||null;
    let next=policies.has(pid)?redactFields(item,policies.get(pid)):{...item};
    // Historical changes must follow the current field policy too.
    if(next.changes_json&&policies.has(pid))next.changes_json=redactFields(parseJson(next.changes_json,{}),policies.get(pid));
    for(const [key,child]of Object.entries(next))if(child&&typeof child==='object'&&key!=='field_access')next[key]=walk(child,pid);
    return next;
  }
  return walk(value);
}
// Объясняет действующий доступ и управляет правилами полей и запросами доступа.
export async function accessApi(request,path,user){
  const method=request.method,url=new URL(request.url);
  if(path[0]==='access-directory'&&method==='GET'){
    await projectFor(user,path[1],'project.access.manage');
    return reply({users:await rows("SELECT id,display_name FROM users WHERE workspace_id=? AND status='active'",[user.workspace_id]),groups:await rows('SELECT id,name FROM access_groups WHERE workspace_id=? AND active=TRUE',[user.workspace_id])});
  }
  if(path[0]==='access-explain'&&method==='GET'){
    const project=await projectFor(user,path[1]);
    const sources=[];
    if(Number(project.owner_id)===Number(user.id))sources.push('Вы — владелец проекта');
    const tribe=project.tribe_id?await tribeAccess(user,project.tribe_id):null;
    if(tribe)sources.push(`Трайб «${tribe.name}»: ${tribe.is_leader?'лидер':tribe.can_manage_projects?'управление всеми проектами':'участник'}`);
    const member=await one('SELECT project_role FROM project_members WHERE project_id=? AND user_id=?',[project.id,user.id]);if(member)sources.push(`Прямое участие в проекте: ${member.project_role}`);
    const groups=await rows(`WITH RECURSIVE mine AS (
      SELECT g.id,g.parent_group_id,CAST(g.id AS CHAR(2000)) AS path FROM access_groups g JOIN access_group_members m ON m.group_id=g.id WHERE m.user_id=? AND g.workspace_id=? AND g.active=TRUE AND (m.expires_at IS NULL OR m.expires_at>CURRENT_TIMESTAMP)
      UNION ALL SELECT g.id,g.parent_group_id,CONCAT(mine.path,',',g.id) FROM access_groups g JOIN mine ON g.id=mine.parent_group_id WHERE g.active=TRUE AND FIND_IN_SET(g.id,mine.path)=0)
      SELECT DISTINCT g.id,g.name,a.project_role FROM mine JOIN access_groups g ON g.id=mine.id LEFT JOIN project_group_access a ON a.group_id=g.id AND a.project_id=?`,[user.id,user.workspace_id,project.id]);
    for(const g of groups)if(g.project_role)sources.push(`Группа «${g.name}»: ${g.project_role}`);
    const temporary=await rows("SELECT id,project_role,expires_at FROM project_access_requests WHERE project_id=? AND user_id=? AND status='approved' AND expires_at>CURRENT_TIMESTAMP",[project.id,user.id]);for(const t of temporary)sources.push(`Временный доступ по запросу №${t.id}: ${t.project_role}, до ${t.expires_at}`);
    const assignments=await rows(`SELECT DISTINCT r.name,a.principal_type,a.principal_id FROM access_assignments a JOIN access_roles r ON r.id=a.role_id WHERE r.workspace_id=? AND r.scope='project' AND r.active=TRUE AND (a.valid_from IS NULL OR a.valid_from<=CURRENT_TIMESTAMP) AND (a.expires_at IS NULL OR a.expires_at>CURRENT_TIMESTAMP) AND ((a.principal_type='user' AND a.principal_id=?) ${groups.length?`OR (a.principal_type='group' AND a.principal_id IN (${groups.map(()=>'?')}))`:''}) AND (a.scope_type='workspace' OR (a.scope_type='project' AND a.scope_id=?) OR (a.scope_type='project_group' AND a.scope_id=?))`,[user.workspace_id,user.id,...groups.map(g=>g.id),project.id,project.group_id||0]);
    for(const a of assignments)sources.push(`Функциональная роль «${a.name}»${a.principal_type==='group'?` через группу «${groups.find(g=>g.id===a.principal_id)?.name||a.principal_id}»`:''}`);
    sources.push(project.access_mode==='members'?'Проект закрыт: действуют личные и групповые назначения проекта, владелец и руководство трайба. Общая схема компании не открывает доступ.':'Сохранена прежняя схема разрешений проекта и глобальная роль');
    sources.push('Явные запреты учитываются после разрешений; системные администраторы сохраняют доступ');
    return reply({global_role:user.global_role,sources,permissions:[...await projectPermissionSet(user,project)]});
  }
  if(path[0]==='field-access'){
    const projectId=positiveId.parse(path[1]||url.searchParams.get('project_id'));
    await projectFor(user,projectId,method==='GET'?'project.browse':'project.access.manage');
    if(method==='GET')return reply(await fieldAccess(user,projectId));
    if(method==='PUT'){
      const data=z.array(z.object({field_code:z.string().max(120),readers:z.array(z.string().regex(/^(user|group):[1-9]\d*$/)).max(500),editors:z.array(z.string().regex(/^(user|group):[1-9]\d*$/)).max(500)})).max(100).parse(await body(request));
      if(new Set(data.map(x=>x.field_code)).size!==data.length)throw new WorkError(422,'Атрибуты не должны повторяться');
      const definitions=await rows('SELECT code FROM task_field_definitions WHERE workspace_id=?',[user.workspace_id]);
      for(const item of data){
        if(!definitions.some(d=>d.code===item.field_code))throw new WorkError(422,'Можно ограничивать только существующие дополнительные атрибуты');
        for(const principal of new Set([...item.readers,...item.editors])){
          const [kind,id]=principal.split(':');
          if(!await one(`SELECT id FROM ${kind==='user'?'users':'access_groups'} WHERE id=? AND workspace_id=?`,[id,user.workspace_id]))throw new WorkError(422,'Пользователь или группа не найдены');
        }
      }
      await transaction(async c=>{await c.query('SELECT id FROM projects WHERE id=? FOR UPDATE',[projectId]);await c.query('DELETE FROM task_field_access WHERE project_id=?',[projectId]);for(const item of data)await c.query('INSERT INTO task_field_access(project_id,field_code,readers_json,editors_json) VALUES(?,?,?,?)',[projectId,item.field_code,JSON.stringify(item.readers),JSON.stringify(item.editors)]);});
      await audit(user,'field_access.updated','project',projectId,{fields:data.map(x=>x.field_code)},request);return reply({ok:true});
    }
  }
  if(path[0]==='access-requests'){
    if(method==='GET'){
      const requests=await rows('SELECT r.*,p.name AS project_name,u.display_name AS user_name FROM project_access_requests r JOIN projects p ON p.id=r.project_id JOIN users u ON u.id=r.user_id WHERE p.workspace_id=? ORDER BY r.id DESC LIMIT 1000',[user.workspace_id]);
      const visible=[];for(const item of requests)if(Number(item.user_id)===Number(user.id)||(await projectPermissionSet(user,item.project_id)).has('project.access.manage'))visible.push(item);
      return reply(visible);
    }
    if(method==='POST'&&!path[1]){
      const d=z.object({project_id:positiveId.optional(),project_key:z.string().trim().min(2).max(12).optional(),project_role:z.enum(['viewer','member']),reason:z.string().trim().min(5).max(2000),expires_at:z.string().datetime()}).parse(await body(request));
      if(!d.project_id&&d.project_key)d.project_id=(await one('SELECT id FROM projects WHERE workspace_id=? AND key_code=?',[user.workspace_id,d.project_key]))?.id;
      if(!d.project_id)throw new WorkError(404,'Проект недоступен');
      if(Date.parse(d.expires_at)<=Date.now()||Date.parse(d.expires_at)>Date.now()+90*86400000)throw new WorkError(422,'Срок доступа: от текущего момента до 90 дней');
      if(!await one("SELECT id FROM projects WHERE id=? AND workspace_id=? AND status='active' AND deleted_at IS NULL",[d.project_id,user.workspace_id]))throw new WorkError(404,'Проект недоступен');
      const created=await rows('INSERT INTO project_access_requests(project_id,user_id,project_role,reason,expires_at) VALUES(?,?,?,?,?)',[d.project_id,user.id,d.project_role,d.reason,new Date(d.expires_at)]);
      return reply({id:created.insertId},201);
    }
    if(method==='PATCH'&&path[1]){
      const d=z.object({status:z.enum(['approved','rejected','revoked']),reason:z.string().trim().min(1).max(2000)}).parse(await body(request));
      const record=await one('SELECT * FROM project_access_requests WHERE id=?',[positiveId.parse(path[1])]);
      if(!record)throw new WorkError(404,'Запрос не найден');
      await projectFor(user,record.project_id,'project.access.manage',true);
      if(Number(record.user_id)===Number(user.id))throw new WorkError(403,'Свой запрос согласовать нельзя');
      const rights=await projectPermissionSet(user,record.project_id);
      if(d.status==='approved'&&PROJECT_MEMBERSHIP_DEFAULTS[record.project_role].some(k=>!rights.has(k)))throw new WorkError(403,'Нельзя выдать отсутствующие у вас разрешения');
      await transaction(async c=>{
        const [[locked]]=await c.query('SELECT * FROM project_access_requests WHERE id=? FOR UPDATE',[record.id]);
        if(d.status==='revoked'?locked.status!=='approved':locked.status!=='pending')throw new WorkError(409,'Запрос уже обработан');
        if(d.status==='approved'&&Date.parse(locked.expires_at)<=Date.now())throw new WorkError(409,'Срок доступа истёк');
        await c.query('UPDATE project_access_requests SET status=?,decided_by=?,decision_reason=?,decided_at=CURRENT_TIMESTAMP WHERE id=?',[d.status,user.id,d.reason,record.id]);
      });
      await audit(user,'project_access.request_decided','project',record.project_id,{request_id:record.id,status:d.status},request);return reply({ok:true});
    }
  }
  throw new WorkError(404,'Маршрут доступа не найден');
}
