import { z } from "zod";
import { one, rows, transaction } from "./db.js";
import { audit } from "./audit.js";
import { projectPermissionSet, hasWorkspacePermission, PERMISSION_CATALOG, PROJECT_MEMBERSHIP_DEFAULTS } from "./permissions.js";

export class ProjectAccessError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const id = z.coerce.number().int().positive().safe();
const send = (value, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "private, no-store" } });
const roleNames = { manager: "Руководитель", member: "Участник", viewer: "Наблюдатель" };

export function grantableProjectRoles(permissions) {
  return Object.entries(PROJECT_MEMBERSHIP_DEFAULTS).filter(([, keys]) => keys.every((key) => permissions.has(key))).map(([key]) => ({ key, name: roleNames[key] }));
}

async function projectAccess(user, projectId, permission, deleted = false) {
  const project = await one("SELECT * FROM projects WHERE id=? AND workspace_id=?", [projectId, user.workspace_id]);
  if (!project || (project.deleted_at && !deleted)) throw new ProjectAccessError(404, "Проект не найден");
  const permissions = await projectPermissionSet(user, project, null, deleted);
  if (!permissions.has("project.browse") || !permissions.has(permission)) throw new ProjectAccessError(403, "Нет разрешения на это действие с проектом");
  return { project, permissions };
}

export async function changeProjectAccess(user, projectId, input, request) {
  const data = z.object({ principal_type: z.enum(["user", "group"]), principal_id: id, project_role: z.enum(["manager", "member", "viewer"]) }).parse(input);
  const { permissions } = await projectAccess(user, projectId, "project.access.manage");
  if (!grantableProjectRoles(permissions).some((role) => role.key === data.project_role)) throw new ProjectAccessError(403, "Нельзя выдать роль с разрешениями, которых у вас нет");
  const table = data.principal_type === "user" ? "users" : "access_groups";
  const principal = await one(`SELECT id FROM ${table} WHERE id=? AND workspace_id=? AND ${data.principal_type === "user" ? "status='active'" : "active=TRUE"}`, [data.principal_id, user.workspace_id]);
  if (!principal) throw new ProjectAccessError(422, "Пользователь или группа недоступны в этом рабочем пространстве");
  await transaction(async (connection) => {
    await connection.query("SELECT id FROM projects WHERE id=? FOR UPDATE", [projectId]);
    if (data.principal_type === "user" && data.project_role !== "manager") {
      const [managers] = await connection.query("SELECT user_id FROM project_members WHERE project_id=? AND project_role='manager'", [projectId]);
      if (managers.length === 1 && Number(managers[0].user_id) === data.principal_id) throw new ProjectAccessError(409, "Назначьте другого руководителя перед изменением роли последнего руководителя");
    }
    if (data.principal_type === "user") await connection.query("INSERT INTO project_members (project_id, user_id, project_role) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE project_role=VALUES(project_role)", [projectId, data.principal_id, data.project_role]);
    else await connection.query("INSERT INTO project_group_access (project_id, group_id, project_role, created_by) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE project_role=VALUES(project_role), created_by=VALUES(created_by)", [projectId, data.principal_id, data.project_role, user.id]);
  });
  await audit(user, "project.access.granted", "project", projectId, data, request);
  return send({ ok: true }, 201);
}

export async function removeProjectAccess(user, projectId, type, principalId, request) {
  await projectAccess(user, projectId, "project.access.manage");
  z.enum(["user", "group"]).parse(type);
  await transaction(async (connection) => {
    await connection.query("SELECT id FROM projects WHERE id=? FOR UPDATE", [projectId]);
    if (type === "user") {
      const [managers] = await connection.query("SELECT user_id FROM project_members WHERE project_id=? AND project_role='manager'", [projectId]);
      if (managers.length === 1 && Number(managers[0].user_id) === principalId) throw new ProjectAccessError(409, "Нельзя убрать последнего руководителя проекта");
      await connection.query("DELETE FROM project_members WHERE project_id=? AND user_id=?", [projectId, principalId]);
    } else await connection.query("DELETE FROM project_group_access WHERE project_id=? AND group_id=?", [projectId, principalId]);
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
    if (path.length === 4 && path[3] === "effective" && method === "GET") {
      const target = await one("SELECT id, workspace_id, global_role, email, display_name FROM users WHERE id=? AND workspace_id=? AND status='active'", [id.parse(url.searchParams.get("user_id")), user.workspace_id]);
      if (!target) throw new ProjectAccessError(404, "Пользователь не найден");
      const effective = await projectPermissionSet(target, project);
      return send({ user_id: target.id, user_name: target.display_name, permissions: PERMISSION_CATALOG.filter((permission) => permission.scope === "project").map((permission) => ({ ...permission, allowed: effective.has(permission.key) })) });
    }
    if (path.length === 3 && method === "GET") {
      const [members, groups, users, availableGroups] = await Promise.all([
        rows("SELECT member.user_id AS principal_id, member.project_role, account.display_name AS name FROM project_members member JOIN users account ON account.id=member.user_id WHERE member.project_id=? ORDER BY account.display_name", [projectId]),
        rows("SELECT access.group_id AS principal_id, access.project_role, access_group.name, access_group.active FROM project_group_access access JOIN access_groups access_group ON access_group.id=access.group_id WHERE access.project_id=? ORDER BY access_group.name", [projectId]),
        rows("SELECT id, display_name AS name FROM users WHERE workspace_id=? AND status='active' ORDER BY display_name", [user.workspace_id]),
        rows("SELECT id, name FROM access_groups WHERE workspace_id=? AND active=TRUE ORDER BY name", [user.workspace_id]),
      ]);
      return send({ members, groups, users, available_groups: availableGroups, grantable_roles: grantableProjectRoles(permissions) });
    }
    if (path.length === 3 && method === "POST") return changeProjectAccess(user, projectId, await request.json(), request);
    if (path.length === 5 && method === "DELETE") return removeProjectAccess(user, projectId, path[3], id.parse(path[4]), request);
  }
  // Keep existing clients on the same authorization and last-manager checks.
  if (path[2] === "members" && path.length === 3 && method === "POST") {
    const data = await request.json();
    return changeProjectAccess(user, projectId, { principal_type: "user", principal_id: data.user_id, project_role: data.project_role }, request);
  }
  if (path[2] === "members" && path.length === 4 && method === "DELETE") return removeProjectAccess(user, projectId, "user", id.parse(path[3]), request);
  throw new ProjectAccessError(404, "Метод управления проектом не найден");
}
