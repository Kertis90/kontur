"use client";
import { useEffect, useState } from "react";
import ToolDialog, { toolApi } from "./ToolDialog.jsx";
import { AiButton } from "./AiTools.jsx";
import ProjectAccessPanel from "./ProjectAccessPanel.jsx";

// Открывает настройки и участников проекта отдельными заметными кнопками.
export function ProjectActions({ project, data, onChanged, accessOnly=false }) {
  const permissions = project.permissions || data.permissions.projects[String(project.id)] || {};
  const [open, setOpen] = useState("");
  const manageable = ["project.edit","project.access.manage","project.archive","project.delete"].some((key) => permissions[key]);
  return <div className="project-actions">{manageable && !accessOnly && <button className="secondary" onClick={() => setOpen("details")}>Настройки</button>}{permissions["project.access.manage"]&&<button className="secondary" onClick={()=>setOpen("access")}>Участники и доступ</button>}{!accessOnly&&<AiButton kind="project" sourceId={project.id} title={project.name} permissions={permissions}/>}{open && <ProjectSettings initialTab={open} project={project} data={data} permissions={permissions} onClose={() => setOpen(false)} onChanged={onChanged}/>}</div>;
}

// Сохраняет параметры проекта и открывает защищённое управление участниками.
function ProjectSettings({ project, data, permissions, onClose, onChanged,initialTab }) {
  const [tab, setTab] = useState(initialTab==="access"?"access":permissions["project.edit"]?"details":permissions["project.access.manage"]?"access":"lifecycle");
  const [draft, setDraft] = useState({ name: project.name, description: project.description || "", color: project.color, workflow_id: project.workflow_id, group_id: project.group_id, start_date: project.start_date?.slice(0,10) || "", target_date: project.target_date?.slice(0,10) || "" });
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const base = `/api/projects/${project.id}`;
  // Сохраняет параметры либо жизненный цикл проекта и обновляет страницу.
  async function change(path, method, body, close = false) {
    setBusy(true); setError(""); setNotice("");
    try { await toolApi(base + path, { method, body: body ? JSON.stringify(body) : undefined }); await onChanged?.(); if (close) onClose(); else setNotice("Изменения сохранены"); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
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
    {tab === "access" && <ProjectAccessPanel project={project} data={data} onChanged={onChanged}/>}
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
