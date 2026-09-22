"use client";
import { useEffect, useState } from "react";
import ToolDialog, { toolApi } from "./ToolDialog.jsx";
import { AiButton } from "./AiTools.jsx";
const roleNames = { manager: "Руководитель", member: "Участник", viewer: "Наблюдатель" };

export function ProjectActions({ project, data, onChanged }) {
  const permissions = project.permissions || data.permissions.projects[String(project.id)] || {};
  const [open, setOpen] = useState(false);
  const manageable = ["project.edit","project.access.manage","project.archive","project.delete"].some((key) => permissions[key]);
  return <div className="project-actions">{manageable && <button className="secondary" onClick={() => setOpen(true)}>Настройки и доступ</button>}<AiButton kind="project" sourceId={project.id} title={project.name} permissions={permissions}/>{open && <ProjectSettings project={project} data={data} permissions={permissions} onClose={() => setOpen(false)} onChanged={onChanged}/>}</div>;
}

function ProjectSettings({ project, data, permissions, onClose, onChanged }) {
  const [tab, setTab] = useState(permissions["project.edit"] ? "details" : permissions["project.access.manage"] ? "access" : "lifecycle");
  const [draft, setDraft] = useState({ name: project.name, description: project.description || "", color: project.color, workflow_id: project.workflow_id, group_id: project.group_id, start_date: project.start_date?.slice(0,10) || "", target_date: project.target_date?.slice(0,10) || "" });
  const [access, setAccess] = useState(null);
  const [type, setType] = useState("group");
  const [search, setSearch] = useState("");
  const [principal, setPrincipal] = useState("");
  const [role, setRole] = useState("viewer");
  const [effective, setEffective] = useState(null);
  const [checkUser, setCheckUser] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const base = `/api/projects/${project.id}`;
  useEffect(() => {
    if (tab !== "access") return;
    const controller = new AbortController();
    toolApi(base + "/access", { signal: controller.signal }).then(setAccess).catch((failure) => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [base, tab]);
  async function change(path, method, body, close = false) {
    setBusy(true); setError(""); setNotice("");
    try { await toolApi(base + path, { method, body: body ? JSON.stringify(body) : undefined }); if (tab === "access") { setAccess(await toolApi(base + "/access")); setEffective(null); } await onChanged?.(); if (close) onClose(); else setNotice("Изменения сохранены"); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  const available = (type === "user" ? access?.users : access?.available_groups) || [];
  const filtered = available.filter((item) => item.name.toLocaleLowerCase("ru").includes(search.toLocaleLowerCase("ru")));
  return <ToolDialog title="Настройки проекта" subtitle={`${project.key_code} · ${project.name}`} onClose={onClose}>
    <div className="tool-tabs">{[["details","Параметры","project.edit"],["access","Пользователи и группы","project.access.manage"],["lifecycle","Архив и удаление",null]].filter((item) => item[2] ? permissions[item[2]] : permissions["project.archive"] || permissions["project.delete"]).map(([key,label]) => <button className={tab === key ? "active" : ""} key={key} onClick={() => { setTab(key); setError(""); setNotice(""); }}>{label}</button>)}</div>
    {error && <div className="ai-notice error" role="alert">{error}</div>}{notice && <div className="ai-notice" role="status">{notice}</div>}
    {tab === "details" && <form onSubmit={(e) => { e.preventDefault(); change("", "PATCH", { ...draft, start_date: draft.start_date || null, target_date: draft.target_date || null }); }}><fieldset className="ai-fieldset ai-config-grid" disabled={busy}>
      <label className="wide">Название<input required minLength={2} maxLength={180} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })}/></label>
      <label className="wide">Описание<textarea rows={4} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })}/></label>
      <label>Группа проектов<select disabled={!data.permissions.features["project.group.manage"]} value={draft.group_id || ""} onChange={(e) => setDraft({ ...draft, group_id: e.target.value ? Number(e.target.value) : null })}><option value="">Без группы</option>{data.groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
      <label>Рабочий процесс<select disabled={!permissions["project.admin"]} value={draft.workflow_id} onChange={(e) => setDraft({ ...draft, workflow_id: Number(e.target.value) })}>{data.workflows.map((workflow) => <option key={workflow.id} value={workflow.id}>{workflow.name}</option>)}</select></label>
      <label>Начало<input type="date" value={draft.start_date} onChange={(e) => setDraft({ ...draft, start_date: e.target.value })}/></label><label>Целевая дата<input type="date" value={draft.target_date} onChange={(e) => setDraft({ ...draft, target_date: e.target.value })}/></label>
      <label>Цвет<input type="color" value={draft.color} onChange={(e) => setDraft({ ...draft, color: e.target.value })}/></label><div className="wide"><button className="primary">Сохранить параметры</button></div>
    </fieldset></form>}
    {tab === "access" && <>{!access ? <p>Загружаем участников…</p> : <><p className="ai-help">Назначьте роль сотруднику или целой группе. Состав групп настраивается в «Администрирование → Роли и группы». Разрешения ролей суммируются; явный запрет имеет приоритет. Владелец и системный администратор сохраняют полный доступ.</p>
      <form className="project-grant-form" onSubmit={(e) => { e.preventDefault(); change("/access", "POST", { principal_type: type, principal_id: Number(principal), project_role: role }); }}><fieldset disabled={busy} className="ai-fieldset ai-config-grid">
        <label>Кому выдать доступ<select value={type} onChange={(e) => { setType(e.target.value); setPrincipal(""); setSearch(""); }}><option value="group">Группе пользователей</option><option value="user">Пользователю</option></select></label>
        <label>Поиск<input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={type === "user" ? "Имя сотрудника" : "Название группы"}/></label>
        <label>{type === "user" ? "Пользователь" : "Группа"}<select required value={principal} onChange={(e) => setPrincipal(e.target.value)}><option value="">Выберите…</option>{available.filter((item) => filtered.includes(item) || String(item.id) === principal).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Роль<select value={role} onChange={(e) => setRole(e.target.value)}>{access.grantable_roles.map((item) => <option key={item.key} value={item.key}>{item.name}</option>)}</select></label><div className="wide"><button className="primary" disabled={!principal || !access.grantable_roles.some((item) => item.key === role)}>Назначить роль</button></div>
      </fieldset></form>
      {[["group",access.groups,"Группы пользователей"],["user",access.members,"Прямые назначения"]].map(([kind,entries,label]) => <section className="project-access-list" key={kind}><h3>{label}</h3>{!entries.length && <p>Назначений пока нет.</p>}{entries.map((entry) => <div className="project-access-row" key={entry.principal_id}><span><strong>{entry.name}</strong><small>{roleNames[entry.project_role]}{entry.active === 0 ? " · группа выключена" : ""}</small></span><select aria-label={`Роль: ${entry.name}`} value={entry.project_role} disabled={busy || !access.grantable_roles.length} onChange={(e) => change("/access", "POST", { principal_type: kind, principal_id: entry.principal_id, project_role: e.target.value })}>{!access.grantable_roles.some((item) => item.key === entry.project_role) && <option value={entry.project_role}>{roleNames[entry.project_role]}</option>}{access.grantable_roles.map((item) => <option key={item.key} value={item.key}>{item.name}</option>)}</select><button className="secondary" disabled={busy} onClick={() => change(`/access/${kind}/${entry.principal_id}`, "DELETE")}>Убрать</button></div>)}</section>)}
      <p className="ai-help">Удаление назначения убирает только этот источник прав. Доступ через другую группу или роль может сохраниться.</p>
      <div className="project-effective"><h3>Проверить фактические права</h3><label>Сотрудник<select value={checkUser} onChange={async (e) => { const value = e.target.value; setCheckUser(value); setEffective(null); if (!value) return; try { setEffective(await toolApi(`${base}/access/effective?user_id=${value}`)); } catch (failure) { setError(failure.message); } }}><option value="">Выберите сотрудника</option>{access.users.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>{effective && <div className="effective-permissions">{effective.permissions.map((item) => <div key={item.key} className={item.allowed ? "allowed" : "denied"}><span>{item.allowed ? "✓" : "—"}</span><span>{item.name}<small>{item.category}</small></span></div>)}</div>}</div>
    </>}</>}
    {tab === "lifecycle" && <div className="project-lifecycle">{permissions["project.archive"] && <section><h3>{project.status === "archived" ? "Вернуть проект в работу" : "Архивировать проект"}</h3><p>Проект и его задачи сохранятся. Вернуть проект можно из списка архивных проектов.</p><button className="secondary" disabled={busy} onClick={() => change("/archive", "POST", { archived: project.status !== "archived" }, true)}>{project.status === "archived" ? "Вернуть в работу" : "Архивировать"}</button></section>}{permissions["project.delete"] && <section><h3>Переместить в корзину</h3><p>Проект станет недоступен участникам. Восстановление доступно пользователям с правом удаления проекта.</p><label>Введите ключ {project.key_code}<input value={confirmation} onChange={(e) => setConfirmation(e.target.value)} autoComplete="off"/></label><button className="secondary danger" disabled={busy || confirmation !== project.key_code} onClick={() => change("", "DELETE", { confirmation }, true)}>Переместить в корзину</button></section>}</div>}
  </ToolDialog>;
}

export function ProjectArchive({ data, onChanged }) {
  const [state, setState] = useState("");
  const [projects, setProjects] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  useEffect(() => { if (!state) return; const controller = new AbortController(); setLoading(true); setError(""); toolApi(`/api/projects?status=${state}`, { signal: controller.signal }).then((result) => setProjects(result.projects)).catch((failure) => { if (!controller.signal.aborted) setError(failure.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); }); return () => controller.abort(); }, [state]);
  async function restore(project) { setBusy(true); setError(""); try { await toolApi(`/api/projects/${project.id}/${state === "deleted" ? "restore" : "archive"}`, { method: "POST", body: JSON.stringify(state === "deleted" ? {} : { archived: false }) }); setProjects((current) => current.filter((item) => item.id !== project.id)); await onChanged?.(); } catch (failure) { setError(failure.message); } finally { setBusy(false); } }
  return <><div className="project-archive-entry"><button className="text-button" onClick={() => setState("archived")}>Архив проектов</button><button className="text-button" onClick={() => setState("deleted")}>Корзина</button></div>{state && <ToolDialog title={state === "deleted" ? "Корзина проектов" : "Архив проектов"} onClose={() => setState("")}><p>Показаны проекты, к которым у вас есть соответствующие права.</p>{error && <div className="ai-notice error" role="alert">{error}</div>}{loading ? <p>Загружаем…</p> : !projects.length ? <div className="ai-empty">Здесь пока нет доступных проектов.</div> : projects.map((project) => <div className="project-access-row" key={project.id}><span><strong>{project.name}</strong><small>{project.key_code}{project.status === "archived" && state === "deleted" ? " · после восстановления останется в архиве" : ""}</small></span>{project.permissions[state === "deleted" ? "project.delete" : "project.archive"] && <button className="secondary" disabled={busy} onClick={() => restore(project)}>{state === "deleted" ? "Восстановить" : "Вернуть в работу"}</button>}</div>)}</ToolDialog>}</>;
}
