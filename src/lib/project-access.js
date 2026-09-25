import { z } from "zod";
import { one, rows, transaction } from "./db.js";
import { audit } from "./audit.js";
import { projectPermissionSet, hasWorkspacePermission, PERMISSION_CATALOG, PROJECT_MEMBERSHIP_DEFAULTS } from "./permissions.js";
import {companyAdmin,tribeAccess} from './tribe-policy.js';

export class ProjectAccessError extends Error {
  // Возвращает понятную ошибку управления доступом без раскрытия сведений о БД.
  constructor(status, message) { super(message); this.status = status; }
}
const id = z.coerce.number().int().positive().safe();
const send = (value, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "private, no-store" } });
const roleNames = { manager: "Руководитель", member: "Участник", viewer: "Наблюдатель" };

// Показывает только роли, права которых сотрудник вправе передать другим.
export function grantableProjectRoles(permissions) {
  return Object.entries(PROJECT_MEMBERSHIP_DEFAULTS).filter(([, keys]) => keys.every((key) => permissions.has(key))).map(([key]) => ({ key, name: roleNames[key] }));
}

// Проверяет область компании и действующие права конкретного проекта.
async function projectAccess(user, projectId, permission, deleted = false) {
  const project = await one("SELECT * FROM projects WHERE id=? AND workspace_id=?", [projectId, user.workspace_id]);
  if (!project || (project.deleted_at && !deleted)) throw new ProjectAccessError(404, "Проект не найден");
  const permissions = await projectPermissionSet(user, project, null, deleted);
  if (!permissions.has("project.browse") || !permissions.has(permission)) throw new ProjectAccessError(403, "Нет разрешения на это действие с проектом");
  return { project, permissions };
}

// Блокирует сначала трайб, затем проект: отзыв членства не может пересечь передачу владения.
async function lockedAccess(connection,user,projectId,revision){
  const initial=await one('SELECT tribe_id FROM projects WHERE id=? AND workspace_id=?',[projectId,user.workspace_id]);
  if(initial?.tribe_id)await connection.query('SELECT id FROM tribes WHERE id=? FOR UPDATE',[initial.tribe_id]);
  const [[project]]=await connection.query('SELECT * FROM projects WHERE id=? AND workspace_id=? FOR UPDATE',[projectId,user.workspace_id]);
  if(!project||project.deleted_at)throw new ProjectAccessError(404,'Проект не найден');
  if(Number(project.tribe_id)!==Number(initial?.tribe_id))throw new ProjectAccessError(409,'Трайб проекта изменился. Обновите страницу');
  const rights=await projectPermissionSet(user,project);
  if(!rights.has('project.browse')||!rights.has('project.access.manage'))throw new ProjectAccessError(403,'Право управления доступом отозвано');
  if(revision!==undefined&&Number(project.access_revision)!==revision)throw new ProjectAccessError(409,'Список участников уже изменён. Обновите его и повторите действие');
  return {project,rights};
}

// Назначает сотруднику или группе проектную роль без повышения собственных полномочий.
export async function changeProjectAccess(user, projectId, input, request) {
  const data = z.object({ principal_type: z.enum(["user", "group"]), principal_id: id, project_role: z.enum(["manager", "member", "viewer"]),revision:id.optional() }).parse(input);
  const { permissions } = await projectAccess(user, projectId, "project.access.manage");
  if (!grantableProjectRoles(permissions).some((role) => role.key === data.project_role)) throw new ProjectAccessError(403, "Нельзя выдать роль с разрешениями, которых у вас нет");
  const table = data.principal_type === "user" ? "users" : "access_groups";
  const principal = await one(`SELECT id FROM ${table} WHERE id=? AND workspace_id=? AND ${data.principal_type === "user" ? "status='active' AND is_service=FALSE" : "active=TRUE"}`, [data.principal_id, user.workspace_id]);
  if (!principal) throw new ProjectAccessError(422, "Пользователь или группа недоступны в этом рабочем пространстве");
  await transaction(async (connection) => {
    const {project,rights}=await lockedAccess(connection,user,projectId,data.revision);
    if(!grantableProjectRoles(rights).some(role=>role.key===data.project_role))throw new ProjectAccessError(403,'Право назначения этой роли отозвано');
    if(data.principal_type==='user'&&Number(project.owner_id)===data.principal_id&&data.project_role!=='manager')throw new ProjectAccessError(409,'Сначала передайте проект другому владельцу');
    if(data.principal_type==='user'&&project.tribe_id&&!await tribeAccess({...user,id:data.principal_id,global_role:'member'},project.tribe_id,connection))throw new ProjectAccessError(422,'Сначала добавьте сотрудника в трайб проекта');
    if (data.principal_type === "user" && data.project_role !== "manager") {
      const [managers] = await connection.query("SELECT user_id FROM project_members WHERE project_id=? AND project_role='manager'", [projectId]);
      if (managers.length === 1 && Number(managers[0].user_id) === data.principal_id) throw new ProjectAccessError(409, "Назначьте другого руководителя перед изменением роли последнего руководителя");
    }
    if (data.principal_type === "user") await connection.query("INSERT INTO project_members (project_id, user_id, project_role) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE project_role=VALUES(project_role)", [projectId, data.principal_id, data.project_role]);
    else await connection.query("INSERT INTO project_group_access (project_id, group_id, project_role, created_by) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE project_role=VALUES(project_role), created_by=VALUES(created_by)", [projectId, data.principal_id, data.project_role, user.id]);
    await connection.query('UPDATE projects SET access_revision=access_revision+1 WHERE id=?',[projectId]);
  });
  await audit(user, "project.access.granted", "project", projectId, data, request);
  return send({ ok: true }, 201);
}

// Отзывает один источник прав и не позволяет удалить владельца или последнего руководителя.
export async function removeProjectAccess(user, projectId, type, principalId, request,revision) {
  await projectAccess(user, projectId, "project.access.manage");
  z.enum(["user", "group"]).parse(type);
  await transaction(async (connection) => {
    const {project}=await lockedAccess(connection,user,projectId,revision);
    if(type==='user'&&Number(project.owner_id)===principalId)throw new ProjectAccessError(409,'Нельзя убрать владельца: сначала передайте проект другому сотруднику');
    if (type === "user") {
      const [managers] = await connection.query("SELECT user_id FROM project_members WHERE project_id=? AND project_role='manager'", [projectId]);
      if (managers.length === 1 && Number(managers[0].user_id) === principalId) throw new ProjectAccessError(409, "Нельзя убрать последнего руководителя проекта");
      await connection.query("DELETE FROM project_members WHERE project_id=? AND user_id=?", [projectId, principalId]);
    } else await connection.query("DELETE FROM project_group_access WHERE project_id=? AND group_id=?", [projectId, principalId]);
    await connection.query('UPDATE projects SET access_revision=access_revision+1 WHERE id=?',[projectId]);
  });
  await audit(user, "project.access.removed", "project", projectId, { principal_type: type, principal_id: principalId }, request);
  return send({ ok: true });
}

// Обновляет проект и переносит задачи на соответствующие этапы выбранного процесса.
export async function updateProject(user, projectId, input, request) {
  const { project, permissions } = await projectAccess(user, projectId, "project.edit");
  const date = z.string().date().nullable().optional();
  const data = z.object({ name: z.string().trim().min(2).max(180).optional(), description: z.string().max(10000).optional(), group_id: id.nullable().optional(), workflow_id: id.optional(), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), start_date: date, target_date: date }).parse(input);
  if (data.group_id && !(await one("SELECT id FROM project_groups WHERE id=? AND workspace_id=?", [data.group_id, user.workspace_id]))) throw new ProjectAccessError(422, "Группа проектов не найдена");
  if (Object.hasOwn(data, "group_id") && Number(data.group_id || 0) !== Number(project.group_id || 0) && !(await hasWorkspacePermission(user, "project.group.manage"))) throw new ProjectAccessError(403, "Для переноса в другую группу нужно право управления группами проектов");
  const changeWorkflow = data.workflow_id && data.workflow_id !== Number(project.workflow_id);
  if (changeWorkflow && !permissions.has("project.admin")) throw new ProjectAccessError(403, "Менять рабочий процесс может администратор проекта");
  if (data.workflow_id && !(await one("SELECT id FROM workflows WHERE id=? AND workspace_id=?", [data.workflow_id, user.workspace_id]))) throw new ProjectAccessError(422, "Рабочий процесс недоступен");
  const start = data.start_date === undefined ? project.start_date : data.start_date;
  const target = data.target_date === undefined ? project.target_date : data.target_date;
  if (start && target && target < start) throw new ProjectAccessError(422, "Целевая дата не может быть раньше начала проекта");
  await transaction(async (connection) => {
    await connection.query("SELECT id FROM projects WHERE id=? FOR UPDATE", [projectId]);
    if (changeWorkflow) {
      const [missing] = await connection.query(`SELECT DISTINCT old.code FROM tasks task JOIN workflow_stages old ON old.id=task.stage_id
        LEFT JOIN workflow_stages next ON next.workflow_id=? AND next.code=old.code WHERE task.project_id=? AND next.id IS NULL`, [data.workflow_id, projectId]);
      if (missing.length) throw new ProjectAccessError(422, "В новом процессе отсутствуют этапы существующих задач: " + missing.map((stage) => stage.code).join(", "));
      await connection.query("UPDATE tasks SET stage_id=(SELECT next.id FROM workflow_stages old JOIN workflow_stages next ON next.workflow_id=? AND next.code=old.code WHERE old.id=tasks.stage_id) WHERE project_id=?", [data.workflow_id, projectId]);
    }
    const keys = Object.keys(data);
    if (keys.length) await connection.query(`UPDATE projects SET ${keys.map((key) => `${key}=?`).join(",")} WHERE id=? AND workspace_id=?`, [...keys.map((key) => data[key]), projectId, user.workspace_id]);
  });
  await audit(user, "project.updated", "project", projectId, { fields: Object.keys(data) }, request);
  return send({ ok: true });
}

// Передаёт владение внутри компании и сохраняет предыдущего владельца руководителем проекта.
export async function transferProjectOwner(user,projectId,input,request){
  const data=z.object({user_id:id,revision:id}).strict().parse(input);
  await projectAccess(user,projectId,'project.access.manage');
  await transaction(async connection=>{
    const {project}=await lockedAccess(connection,user,projectId,data.revision);
    if(!companyAdmin(user)&&Number(project.owner_id)!==Number(user.id))throw new ProjectAccessError(403,'Передать владение может владелец проекта или администратор компании');
    const [[target]]=await connection.query("SELECT id,workspace_id,global_role,is_service FROM users WHERE id=? AND workspace_id=? AND status='active' AND is_service=FALSE",[data.user_id,user.workspace_id]);
    if(!target)throw new ProjectAccessError(422,'Выберите действующего сотрудника компании');
    if(project.tribe_id&&!await tribeAccess({...target,global_role:'member'},project.tribe_id,connection))throw new ProjectAccessError(422,'Новый владелец должен входить в трайб проекта');
    if(!(await projectPermissionSet(target,{...project,owner_id:target.id})).has('project.access.manage'))throw new ProjectAccessError(409,'Назначенные сотруднику запреты не позволяют управлять этим проектом');
    await connection.query("INSERT INTO project_members(project_id,user_id,project_role) VALUES(?,?,'manager') ON DUPLICATE KEY UPDATE project_role='manager'",[projectId,data.user_id]);
    await connection.query('UPDATE projects SET owner_id=?,access_revision=access_revision+1 WHERE id=?',[data.user_id,projectId]);
  });
  await audit(user,'project.owner.changed','project',projectId,{owner_id:data.user_id},request);return send({ok:true});
}

// Обслуживает настройки проекта и назначения сотрудников и групп с одинаковыми проверками для всех клиентов.
export async function handleProjectAccessApi(request, path, user) {
  const method = request.method;
  const url = new URL(request.url);
  if (path.length === 1 && method === "GET") {
    const state = z.enum(["active", "archived", "deleted"]).parse(url.searchParams.get("status") || "active");
    const all = await rows(`SELECT * FROM projects WHERE workspace_id=? AND ${state === "deleted" ? "deleted_at IS NOT NULL" : "deleted_at IS NULL AND status=?"} ORDER BY name`, [user.workspace_id, ...(state === "deleted" ? [] : [state])]);
    const result = [];
    for (const project of all) {
      const permissions = await projectPermissionSet(user, project, null, state === "deleted");
      if (permissions.has("project.browse") && (state !== "deleted" || permissions.has("project.delete"))) result.push({ ...project, permissions: Object.fromEntries([...permissions].map((key) => [key, true])) });
    }
    return send({ projects: result });
  }
  const projectId = id.parse(path[1]);
  if (path.length === 2 && method === "PATCH") return updateProject(user, projectId, await request.json(), request);
  if (path.length === 2 && method === "DELETE") {
    const { project } = await projectAccess(user, projectId, "project.delete");
    const data = z.object({ confirmation: z.string() }).parse(await request.json());
    if (data.confirmation !== project.key_code) throw new ProjectAccessError(422, "Для удаления введите ключ проекта");
    await transaction(async (connection) => {
      await connection.query("UPDATE projects SET deleted_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=?", [projectId, user.workspace_id]);
      await connection.query("UPDATE ai_jobs SET status='cancelled', input_json=NULL, completed_at=CURRENT_TIMESTAMP WHERE project_id=? AND status IN ('queued','running')", [projectId]);
    });
    await audit(user, "project.deleted", "project", projectId, { recoverable: true }, request);
    return send({ ok: true, recoverable: true });
  }
  if (path.length === 3 && path[2] === "restore" && method === "POST") {
    await projectAccess(user, projectId, "project.delete", true);
    await rows("UPDATE projects SET deleted_at=NULL WHERE id=? AND workspace_id=?", [projectId, user.workspace_id]);
    await audit(user, "project.restored", "project", projectId, null, request);
    return send({ ok: true });
  }
  if (path.length === 3 && path[2] === "archive" && method === "POST") {
    await projectAccess(user, projectId, "project.archive");
    const { archived } = z.object({ archived: z.boolean() }).parse(await request.json());
    await rows("UPDATE projects SET status=? WHERE id=? AND workspace_id=? AND deleted_at IS NULL", [archived ? "archived" : "active", projectId, user.workspace_id]);
    await audit(user, archived ? "project.archived" : "project.unarchived", "project", projectId, null, request);
    return send({ ok: true });
  }
  if (path[2] === "access") {
    const { project, permissions } = await projectAccess(user, projectId, "project.access.manage");
    if(path.length===4&&path[3]==='owner'&&method==='POST')return transferProjectOwner(user,projectId,await request.json(),request);
    if(path.length===4&&path[3]==='mode'&&method==='PATCH'){
      const data=z.object({access_mode:z.literal('members'),revision:id}).strict().parse(await request.json());
      await transaction(async connection=>{const {project:fresh}=await lockedAccess(connection,user,projectId,data.revision);if(!companyAdmin(user)&&Number(fresh.owner_id)!==Number(user.id))throw new ProjectAccessError(403,'Видимость меняет владелец проекта или администратор');await connection.query('UPDATE projects SET access_mode=?,access_revision=access_revision+1 WHERE id=?',[data.access_mode,projectId]);});
      await audit(user,'project.access.mode','project',projectId,data,request);return send({ok:true});
    }
    if (path.length === 4 && path[3] === "effective" && method === "GET") {
      const target = await one("SELECT id, workspace_id, global_role, email, display_name FROM users WHERE id=? AND workspace_id=? AND status='active'", [id.parse(url.searchParams.get("user_id")), user.workspace_id]);
      if (!target) throw new ProjectAccessError(404, "Пользователь не найден");
      const effective = await projectPermissionSet(target, project);
      return send({ user_id: target.id, user_name: target.display_name, permissions: PERMISSION_CATALOG.filter((permission) => permission.scope === "project").map((permission) => ({ ...permission, allowed: effective.has(permission.key) })) });
    }
    if (path.length === 3 && method === "GET") {
      const [members, groups, users, availableGroups,owner] = await Promise.all([
        rows("SELECT member.user_id AS principal_id, member.project_role, account.display_name AS name,account.status,account.is_service FROM project_members member JOIN users account ON account.id=member.user_id WHERE member.project_id=? ORDER BY account.display_name", [projectId]),
        rows("SELECT access.group_id AS principal_id, access.project_role, access_group.name, access_group.active FROM project_group_access access JOIN access_groups access_group ON access_group.id=access.group_id WHERE access.project_id=? ORDER BY access_group.name", [projectId]),
        rows("SELECT u.id,u.display_name AS name FROM users u WHERE u.workspace_id=? AND u.status='active' AND u.is_service=FALSE AND (? IS NULL OR EXISTS(SELECT 1 FROM tribe_members m WHERE m.user_id=u.id AND m.tribe_id=?)) ORDER BY u.display_name", [user.workspace_id,project.tribe_id||null,project.tribe_id||null]),
        rows("SELECT g.id,g.name,g.source,(SELECT COUNT(*) FROM access_group_members m JOIN users u ON u.id=m.user_id WHERE m.group_id=g.id AND u.status='active' AND (m.expires_at IS NULL OR m.expires_at>CURRENT_TIMESTAMP)) AS member_count FROM access_groups g WHERE g.workspace_id=? AND g.active=TRUE ORDER BY g.name", [user.workspace_id]),
        one('SELECT id,display_name AS name,status FROM users WHERE id=? AND workspace_id=?',[project.owner_id||null,user.workspace_id]),
      ]);
      return send({ members, groups, users, owner,tribe_id:project.tribe_id,access_mode:project.access_mode,revision:project.access_revision,can_transfer_owner:companyAdmin(user)||Number(project.owner_id)===Number(user.id),can_manage_groups:await hasWorkspacePermission(user,'group.manage'), available_groups: availableGroups, grantable_roles: grantableProjectRoles(permissions) });
    }
    if (path.length === 3 && method === "POST") return changeProjectAccess(user, projectId, await request.json(), request);
    if (path.length === 5 && method === "DELETE") return removeProjectAccess(user, projectId, path[3], id.parse(path[4]), request,url.searchParams.has('revision')?id.parse(url.searchParams.get('revision')):undefined);
  }
  // Keep existing clients on the same authorization and last-manager checks.
  if (path[2] === "members" && path.length === 3 && method === "POST") {
    const data = await request.json();
    return changeProjectAccess(user, projectId, { principal_type: "user", principal_id: data.user_id, project_role: data.project_role }, request);
  }
  if (path[2] === "members" && path.length === 4 && method === "DELETE") return removeProjectAccess(user, projectId, "user", id.parse(path[3]), request);
  throw new ProjectAccessError(404, "Метод управления проектом не найден");
}
