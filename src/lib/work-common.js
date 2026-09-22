import { z } from "zod";
import { one, rows } from "./db.js";
import { projectPermissionSet, workspacePermissionSet } from "./permissions.js";

import {WorkError} from './work-error.js';
export {WorkError};
export const positiveId = z.coerce.number().int().positive();
export const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v, "Некорректная дата");
export const reply = (value, status=200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
export async function body(request) {
  if (Number(request.headers.get("content-length") || 0) > 3_000_000) throw new WorkError(413,"Слишком большой запрос");
  const text = await request.text();
  if (Buffer.byteLength(text) > 3_000_000) throw new WorkError(413,"Слишком большой запрос");
  try { return JSON.parse(text); } catch { throw new WorkError(400,"Некорректный JSON"); }
}
export async function projectFor(user, value, permission="project.browse", write=false) {
  const project = await one("SELECT * FROM projects WHERE id=? AND workspace_id=? AND deleted_at IS NULL", [positiveId.parse(value),user.workspace_id]);
  if (!project || !(await projectPermissionSet(user,project)).has(permission)) throw new WorkError(403,"Нет доступа к проекту или действию");
  if (write && project.status !== "active") throw new WorkError(409,"Проект находится в архиве");
  return project;
}
export async function workspaceFor(user, permission) {
  if (!(await workspacePermissionSet(user)).has(permission)) throw new WorkError(403,"Недостаточно прав для этого действия");
}
export async function visibleProjects(user, permission="project.browse") {
  const projects = await rows("SELECT * FROM projects WHERE workspace_id=? AND deleted_at IS NULL AND status='active'",[user.workspace_id]);
  const sets = await Promise.all(projects.map(p=>projectPermissionSet(user,p)));
  return projects.filter((_,i)=>sets[i].has(permission));
}
export async function validUsers(user, ids, projectId=null) {
  const unique = [...new Set(ids.filter(Boolean).map(Number))];
  if (!unique.length) return;
  const found = await rows(`SELECT * FROM users WHERE workspace_id=? AND status='active' AND id IN (${unique.map(()=>"?").join(",")})`, [user.workspace_id,...unique]);
  if (found.length!==unique.length) throw new WorkError(422,"Один из пользователей недоступен");
  if (projectId) for (const person of found) await projectFor(person,projectId);
}
