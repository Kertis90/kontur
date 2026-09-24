"use client";
import PersonalFavorites from '../src/components/PersonalFavorites.jsx';
import {BoardPlans} from '../src/components/PlansView.jsx';
import WorkspaceCompanion from "../src/components/WorkspaceCompanion.jsx";
import WorkspaceClock from "../src/components/WorkspaceClock.jsx";
import GettingStarted from "../src/components/GettingStarted.jsx";
import {clearDeviceOnLogout} from "../src/lib/browser-device.js";
import AgentsView from "../src/components/AgentsView.jsx";
import QualityView from "../src/components/QualityView.jsx";
import ObjectivesView from "../src/components/ObjectivesView.jsx";
import IntegrationsHub from "../src/components/IntegrationsHub.jsx";
import TaskAiAssistant from "../src/components/TaskAiAssistant.jsx";
import TaskTable, {CommandPalette,UndoBanner} from "../src/components/TaskTable.jsx";
import {workApi} from "../src/components/WorkUI.jsx";
import {SlaHistory} from "../src/components/SlaCalendars.jsx";
import SecurityWorkbench, {DirectorySettings,AccessPreview} from "../src/components/SecurityWorkbench.jsx";

import { useEffect, useMemo, useState, useRef } from "react";
import { ApiAccessAdmin, ApiTokensView, AuditAdmin, AutomationAdmin, BacklogView, DashboardStudio, ImportAdmin, IntegrationsAdmin, KnowledgeView, NotificationCenter, PermissionsAdmin, PortfolioDashboard, ProjectTemplatesAdmin, ReleasesView, ReportsView, SearchView, SlaAdmin, TaskActivity } from "../src/components/AdvancedViews";
import { ProjectActions, ProjectArchive } from "../src/components/ProjectTools.jsx";
import { AiSettings } from "../src/components/AiTools";
import WorkHub from "../src/components/WorkHub.jsx";
import AutomationStudio from "../src/components/AutomationStudio.jsx";
import OfflineWorkspace from "../src/components/OfflineWorkspace.jsx";
import OperationsView from '../src/components/OperationsView.jsx';
import JiraImport, { JiraTaskHistory } from '../src/components/JiraImport.jsx';
import { TaskDevelopment } from "../src/components/WorkDataTools.jsx";
import { rememberOffline, clearOffline } from "../src/lib/offline-store.js";
import CommunicationsView from "../src/components/CommunicationsView";

const ROLE_LABELS = { owner: "Владелец", admin: "Администратор", project_manager: "Руководитель проектов", member: "Участник", viewer: "Наблюдатель" };
const PRIORITY_LABELS = { critical: "Критический", high: "Высокий", medium: "Средний", low: "Низкий" };
const FIELD_LABELS = { text: "Текст", number: "Число", date: "Дата", select: "Список", multiselect: "Множественный список", boolean: "Да/нет", user: "Пользователь", url: "Ссылка" };
const NAV = [
  ["start", "Начать работу", "check"],
  ["dashboard", "Обзор", "dashboard"],
  ["dashboards", "Мои дашборды", "fields"],
  ["projects", "Проекты", "folder"],
  ["backlog", "Бэклог и спринты", "backlog"],
  ["board", "Канбан", "board"],
  ["table", "Таблица задач", "fields"],
  ["gantt", "Диаграмма Ганта", "gantt"],
  ["releases", "Релизы", "release"],
  ["search", "Поиск и фильтры", "search"],
  ["chat", "Чат и встречи", "users"],
  ["knowledge", "База знаний", "book"],
  ["reports", "Отчёты", "reports"],
  ["work", "Планирование и инструменты", "workflow"],
  ["quality", "Тестирование", "fields"],
  ["objectives", "Цели и OKR", "reports"],
  ["integrations", "Интеграции", "link"],
  ["agents", "ИИ-агенты", "workflow"],
  ["api", "Мой API", "link"],
  ["admin", "Администрирование", "settings"],
];

function Icon({ name, size = 18 }) {
  const content = {
    logo: <><path d="m12 3 7.7 4.5v9L12 21l-7.7-4.5v-9L12 3Z"/><path d="m8 10 4-2.3 4 2.3v4l-4 2.3L8 14v-4Z"/></>,
    folder: <><path d="M3 7h7l2 2h9v10H3V7Z"/><path d="M3 7V5h7l2 2"/></>,
    dashboard: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="11" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="18" width="7" height="3" rx="1"/></>,
    backlog: <><path d="M4 6h16M4 12h11M4 18h8"/><circle cx="19" cy="12" r="2"/></>,
    board: <><rect x="3" y="4" width="5" height="16" rx="1"/><rect x="10" y="4" width="5" height="10" rx="1"/><rect x="17" y="4" width="4" height="13" rx="1"/></>,
    gantt: <><path d="M4 6h7M4 12h13M4 18h9"/><circle cx="15" cy="6" r="2"/><circle cx="20" cy="18" r="2"/></>,
    release: <><path d="M14 4c3-1 5 0 6 0 0 2-1 5-4 7l-4 2-3-3 2-4 3-2Z"/><path d="m9 10-4 1-2 3 6 1m3-2 1 6-3 2-1-6"/><circle cx="15.5" cy="7.5" r="1"/></>,
    book: <><path d="M4 4h6a3 3 0 0 1 3 3v13a3 3 0 0 0-3-3H4V4Z"/><path d="M20 4h-4a3 3 0 0 0-3 3v13a3 3 0 0 1 3-3h4V4Z"/></>,
    reports: <><path d="M4 20V9m6 11V4m6 16v-7m4 7H2"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></>,
    chevron: <><path d="m9 18 6-6-6-6"/></>,
    down: <><path d="m6 9 6 6 6-6"/></>,
    close: <><path d="m6 6 12 12M18 6 6 18"/></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    flag: <><path d="M5 21V4m0 1h11l-2 4 2 4H5"/></>,
    user: <><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></>,
    mail: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/></>,
    shield: <><path d="M12 3 5 6v5c0 5 3 8 7 10 4-2 7-5 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-5"/></>,
    workflow: <><circle cx="5" cy="6" r="2"/><circle cx="19" cy="6" r="2"/><circle cx="12" cy="18" r="2"/><path d="M7 6h10M6 8l5 8m7-8-5 8"/></>,
    fields: <><path d="M4 6h16M4 12h10M4 18h13"/><circle cx="19" cy="12" r="2"/></>,
    users: <><circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0"/><circle cx="18" cy="9" r="2"/><path d="M16 15a5 5 0 0 1 5 5"/></>,
    logout: <><path d="M10 4H5v16h5M14 8l4 4-4 4m4-4H9"/></>,
    save: <><path d="M5 3h12l2 2v16H5V3Z"/><path d="M8 3v6h8V3M8 21v-7h8v7"/></>,
    check: <><path d="m5 12 4 4L19 6"/></>,
    grip: <><circle cx="9" cy="7" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="7" r="1" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="9" cy="17" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="17" r="1" fill="currentColor" stroke="none"/></>,
    trash: <><path d="M4 7h16M9 7V4h6v3m3 0-1 14H7L6 7m4 4v6m4-6v6"/></>,
    link: <><path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.1 1.1M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.1-1.1"/></>,
    more: <><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none"/></>,
  };
  return <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{content[name]}</svg>;
}

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { "content-type": "application/json", ...(options.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || "Ошибка запроса");
    error.status = response.status;
    error.details = body.details;
    throw error;
  }
  return body;
}

function formatDate(value, withYear = false) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}) }).format(new Date(`${value}T12:00:00`));
}

function dateOffset(days) {
  const date = new Date(); date.setHours(12, 0, 0, 0); date.setDate(date.getDate() + days); return date.toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  return Math.round((new Date(`${b}T12:00:00`) - new Date(`${a}T12:00:00`)) / 86400000);
}

function avatar(name, color, size = "normal") {
  return <span className={`avatar ${size}`} style={{ background: color || "#675EE7" }}>{(name || "?").split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</span>;
}

// Управляет рабочими разделами и настройкой организации; часы обновляются независимым компонентом.
// Показывает рабочие разделы, общую навигацию и быстрый доступ к проектам.
export default function Home() {
  const [data, setData] = useState(null);
  const [lastUndo,setLastUndo]=useState(null),[undoBusy,setUndoBusy]=useState(false),changeBusy=useRef(false);
  const linkedTaskOpened = useRef(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [view, setView] = useState("dashboard");
  const [projectId, setProjectId] = useState(null);
  const [query, setQuery] = useState("");
  const [taskDraft, setTaskDraft] = useState(null);
  const [projectDraft, setProjectDraft] = useState(null);
  const [groupDraft, setGroupDraft] = useState(null);
  const [fieldDraft, setFieldDraft] = useState(null);
  const [toast, setToast] = useState(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [favoritesOpen,setFavoritesOpen]=useState(false);
  const [loading, setLoading] = useState(true);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [linkedChannel, setLinkedChannel] = useState(null);

  // Загружает доступное пространство и открывает выбранный в личной ссылке проект.
  async function load(silent = false) {
    if (!silent) setLoading(true);
    try {
      const result = await api("/api/bootstrap");
      setData(result);
      rememberOffline(result).catch(() => {});
      const linkedTask = Number(new URLSearchParams(window.location.search).get("task"));
      if (linkedTask && !linkedTaskOpened.current) { linkedTaskOpened.current = true; setTaskDraft(result.tasks.find(task => task.id === linkedTask) || null); }
      setAuthRequired(false);
      const linkedProject=Number(new URLSearchParams(window.location.search).get('project'));
      setProjectId((current) => current && result.projects.some((project) => project.id === current) ? current : result.projects.find(project=>project.id===linkedProject)?.id || result.projects[0]?.id || null);
    } catch (error) {
      if (error.status === 401) setAuthRequired(true);
      else setToast({ type: "error", text: error.message });
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (/^[1-9]\d*$/.test(params.get("channel") || "")) setLinkedChannel(Number(params.get("channel")));
    if (params.get("notifications") === "1") setNotificationsOpen(true);
    if (NAV.some(([key]) => key === params.get("view"))) setView(params.get("view"));
    else if (params.has("conference")) setView("chat");
  }, []);
  useEffect(() => {
    const receive = event => {
      if (event.data?.type !== 'kontur:notification') return;
      try {
        const url = new URL(event.data.url, window.location.origin);
        if (url.origin !== window.location.origin || url.pathname !== '/') return;
        if (url.searchParams.get('view') === 'chat' && /^[1-9]\d*$/.test(url.searchParams.get('channel') || '')) { setLinkedChannel(Number(url.searchParams.get('channel'))); setView('chat'); }
        else setNotificationsOpen(true);
      } catch {}
    };
    navigator.serviceWorker?.addEventListener('message', receive);
    return () => navigator.serviceWorker?.removeEventListener('message', receive);
  }, []);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(null), 3200); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => { if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {}); const capture = (event) => { event.preventDefault(); setInstallPrompt(event); }; window.addEventListener("beforeinstallprompt", capture); return () => window.removeEventListener("beforeinstallprompt", capture); }, []);

  if (loading && !data) return <div className="boot"><div className="brand-mark"><Icon name="logo" size={24}/></div><div className="boot-line"><span/></div><p>Загружаем рабочее пространство…</p></div>;
  if (authRequired) return <Login onSuccess={() => load()} />;
  if (!data) return <div className="work-offline-fallback"><OfflineWorkspace onReconnect={() => load()}/></div>;

  const project = data.projects.find((item) => item.id === projectId) || data.projects[0];
  const workflow = data.workflows.find((item) => item.id === project?.workflow_id);
  const tasks = data.tasks.filter((task) => task.project_id === project?.id && `${task.title} ${task.description || ""} ${task.assignee_name || ""}`.toLowerCase().includes(query.toLowerCase()));
  const modalProject = data.projects.find((item) => item.id === taskDraft?.project_id) || project;
  const modalWorkflow = data.workflows.find((item) => item.id === modalProject?.workflow_id) || workflow;
  const projectPermissions = data.permissions.projects[String(project?.id)] || {};
  const features = data.permissions.features || {};
  const visibleNavigation = NAV.filter(([key]) => {
    if (key === "start") return data.permissions.admin || data.permissions.manageProjects;
    if (["quality","objectives"].includes(key)) return Object.values(data.permissions.projects).some(rights => (key === "quality" ? ["qa.view","qa.manage","qa.execute"] : ["okr.view","okr.manage","okr.update"]).some(k=>rights[k]));
    if (key === "agents") return Object.values(data.permissions.projects).some(rights=>rights["agent.view"]);
    if (key === "integrations") return features["integration.view"] || features["integration.manage"] || features["calendar.connect"] || Object.values(data.permissions.projects).some(rights=>["qa.view","qa.manage","qa.execute"].some(key=>rights[key]));
    if (key === "admin") return data.permissions.admin;
    if (key === "knowledge") return features["knowledge.view"] || features["knowledge.manage"] || data.knowledgeSpaces.length > 0 || data.knowledgeTeams.length > 0;
    if (key === "reports") return projectPermissions["report.view"];
    if (key === "chat") return true;
    return true;
  });

  function notify(text, type = "success") { setToast({ text, type }); }
  function openNewTask(stageId = workflow?.stages?.[0]?.id) {
    setTaskDraft({ field_access: data.permissions.fieldAccess?.[project.id] || {}, project_id: project.id, stage_id: stageId, title: "", description: "", priority: "medium", assignee_id: data.user.id, start_date: dateOffset(0), due_date: dateOffset(7), estimate_minutes: 480, progress: 0, milestone: false, custom_values: {}, dependencies: [] });
  }

  async function applyTaskChange(task,patch) {
    if (!task || changeBusy.current) return false;
    changeBusy.current=true;
    try {
      const result=await workApi('task-changes',{method:'POST',body:JSON.stringify({task_id:task.id,version_number:task.version_number,patch})});
      setLastUndo({id:result.undo_id,label:`${task.key_code}-${task.task_number}`,expiresAt:Date.now()+590000});
      await load(true); notify('Задача изменена'); return true;
    } catch(error) { notify(error.message,'error'); return false; }
    finally { changeBusy.current=false; }
  }
  async function undoTaskChange() {
    if(!lastUndo || changeBusy.current)return;
    changeBusy.current=true;setUndoBusy(true);
    try {await workApi(`undo/${lastUndo.id}`,{method:'POST',body:'{}'});setLastUndo(null);await load(true);notify('Изменение отменено');}
    catch(error){notify(error.message,'error');}
    finally{changeBusy.current=false;setUndoBusy(false);}
  }

  async function logout() { setLastUndo(null); await clearOffline().catch(() => {}); await api("/api/auth/logout", { method: "POST", body: "{}" }); await clearDeviceOnLogout().catch(() => {}); setData(null); setAuthRequired(true); }

  return <div className="shell has-companion">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Icon name="logo" size={22}/></div><div><strong>Контур</strong><small>Управление работой</small></div></div>
      <div className="sidebar-body">
      <div className="sidebar-section-label">Рабочее пространство</div>
      <nav>{visibleNavigation.map(([key, label, icon]) => <button key={key} className={view === key ? "active" : ""} onClick={() => setView(key)}><Icon name={icon}/><span>{label}</span></button>)}</nav>
      <PersonalFavorites open={favoritesOpen} onOpen={()=>setFavoritesOpen(true)} onClose={()=>setFavoritesOpen(false)} notify={notify}/>
      </div>
      <div className="sidebar-user">{avatar(data.user.display_name, data.user.avatar_color)}<div><strong>{data.user.display_name}</strong><small>{ROLE_LABELS[data.user.global_role]}</small></div><button onClick={logout} title="Выйти"><Icon name="logout" size={17}/></button></div>
    </aside>

    <main className="main">
      <header className="topbar">
        <div className="breadcrumbs"><button onClick={() => setView("dashboard")}>{data.workspace.name}</button><Icon name="chevron" size={13}/><button className="current" onClick={() => view === "admin" ? setView("dashboard") : setView(view)}>{NAV.find(([key]) => key === view)?.[1] || project?.name}</button></div>
        <label className="global-search"><Icon name="search" size={17}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Найти задачу…"/></label>
        <CommandPalette data={data} navigation={visibleNavigation} onNavigate={setView} onTask={setTaskDraft} onCreate={project && projectPermissions["task.create"]?()=>openNewTask():null}/>
        <WorkspaceClock/>
        <button className="icon-button" aria-label="Открыть избранное" title="Избранное" onClick={()=>setFavoritesOpen(true)}>☆</button>
        {installPrompt && <button className="install-button" onClick={async () => { await installPrompt.prompt(); setInstallPrompt(null); }}>Установить</button>}
        <button className={`icon-button notification-button ${data.notifications.some((item) => !item.read_at) ? "has-unread" : ""}`} onClick={() => setNotificationsOpen((value) => !value)} aria-label="Открыть уведомления" title="Уведомления"><Icon name="bell"/></button>
        {!['admin', 'knowledge', 'chat', 'dashboards', 'api', 'integrations', 'quality', 'objectives', 'agents'].includes(view) && projectPermissions["task.create"] && project && <button className="primary" onClick={() => openNewTask()}><Icon name="plus" size={17}/>Создать задачу</button>}
      </header>

      <div className="content">
        {view === "start" && <GettingStarted data={data} notify={notify} reload={() => load(true)} onNewProject={() => setProjectDraft({template_id: null, name: "", key_code: "", description: "", group_id: data.groups[0]?.id || null, workflow_id: data.workflows[0]?.id, color: "#e30611", start_date: dateOffset(0), target_date: dateOffset(30)})} onNewTask={project && projectPermissions["task.create"] ? () => openNewTask() : null}/>}
        <UndoBanner action={lastUndo} busy={undoBusy} onUndo={undoTaskChange} onDismiss={()=>setLastUndo(null)}/>
        {view === "agents" && <AgentsView data={data} notify={notify}/>}
        {view === "quality" && <QualityView data={data} notify={notify} onTask={setTaskDraft}/>}
        {view === "objectives" && <ObjectivesView data={data} notify={notify}/>}
        {view === "integrations" && <div className="view-page"><IntegrationsHub data={data} reload={() => load(true)} notify={notify}/></div>}
        {view === "table" && <TaskTable data={data} notify={notify} onOpen={setTaskDraft} onChange={applyTaskChange}/>} 
        {view === "dashboard" && project && <PortfolioDashboard data={data} project={project} tasks={tasks} onOpen={setTaskDraft} setView={setView}/>}
        {view === "dashboards" && <DashboardStudio data={data} reload={() => load(true)} notify={notify} onOpen={setTaskDraft}/>}
        {view === "projects" && <ProjectsView
          data={data}
          onChanged={() => load(true)}
          onOpen={(id) => { setProjectId(id); setView("board"); }}
          onTaskOpen={setTaskDraft}
          onNewProject={() => setProjectDraft({ template_id: null, name: "", key_code: "", description: "", group_id: data.groups[0]?.id || null, workflow_id: data.workflows[0]?.id, color: "#675EE7", start_date: dateOffset(0), target_date: dateOffset(30) })}
          onNewGroup={() => setGroupDraft({ name: "", description: "", color: "#2EA879" })}
        />}
        {view === "backlog" && project && <BacklogView data={data} project={project} tasks={tasks} onOpen={setTaskDraft} reload={() => load(true)} notify={notify}/>}
        {view === "board" && project && <BoardView query={query} project={project} workflow={workflow} tasks={tasks} data={data} onOpen={setTaskDraft} onNew={openNewTask} onMoved={(taskId,stageId)=>applyTaskChange(data.tasks.find(t=>t.id===taskId),{stage_id:stageId})}/>}
        {view === "gantt" && project && <GanttView project={project} tasks={tasks} stages={workflow?.stages || []} onOpen={setTaskDraft}/>}
        {view === "releases" && project && <ReleasesView data={data} project={project} tasks={tasks} reload={() => load(true)} notify={notify}/>}
        {view === "search" && <SearchView data={data} onOpen={setTaskDraft} reload={() => load(true)} notify={notify}/>}
        {view === "chat" && <CommunicationsView data={data} project={project} notify={notify} initialChannelId={linkedChannel}/>}
        {view === "knowledge" && <KnowledgeView data={data} reload={() => load(true)} notify={notify}/>}
        {view === "reports" && project && <ReportsView project={project} notify={notify}/>}
        {view === "work" && <WorkHub data={data} notify={notify} reload={() => load(true)} onTask={async id => { try { const fresh = await api("/api/bootstrap"); setData(fresh); const task = fresh.tasks.find(t => t.id === id); if (task) setTaskDraft(task); else notify("Задача недоступна", "error"); } catch (error) { notify(error.message, "error"); } }}/> }
        {view === "api" && <ApiTokensView data={data} reload={() => load(true)} notify={notify}/>}
        {view === "admin" && data.permissions.admin && <AdminView data={data} reload={() => load(true)} notify={notify} onNewField={() => setFieldDraft({ code: "", label: "", field_type: "text", required: false, options: [] })} onEditField={(field) => setFieldDraft({ ...field, options: field.options || [] })}/>}
      </div>
      {notificationsOpen && <NotificationCenter data={data} reload={() => load(true)} close={() => setNotificationsOpen(false)} notify={notify}/>}
    </main>
    <WorkspaceCompanion key={data.user.id} user={data.user} activeView={view} installPrompt={installPrompt} onInstalled={() => setInstallPrompt(null)} onNotifications={notifications => setData(current => current ? {...current, notifications} : current)} onOpenChat={id => { setLinkedChannel(id); setView("chat"); }}/>

    {taskDraft && modalProject && modalWorkflow && <TaskModal task={taskDraft} data={data} project={modalProject} workflow={modalWorkflow} notify={notify} onClose={() => setTaskDraft(null)} onSaved={async (message) => { setTaskDraft(null); await load(true); notify(message); }}/>}
    {projectDraft && <ProjectModal draft={projectDraft} setDraft={setProjectDraft} data={data} onClose={() => setProjectDraft(null)} onSaved={async () => { setProjectDraft(null); await load(true); notify("Проект создан"); }}/>}
    {groupDraft && <GroupModal draft={groupDraft} setDraft={setGroupDraft} onClose={() => setGroupDraft(null)} onSaved={async () => { setGroupDraft(null); await load(true); notify("Группа проектов создана"); }}/>}
    {fieldDraft && <FieldModal draft={fieldDraft} setDraft={setFieldDraft} onClose={() => setFieldDraft(null)} onSaved={async (message) => { setFieldDraft(null); await load(true); notify(message); }}/>}
    {toast && <div className={`toast ${toast.type}`}><Icon name={toast.type === "error" ? "shield" : "check"} size={17}/>{toast.text}</div>}
  </div>;
}

function Login({ onSuccess }) {
  const [form, setForm] = useState({ login: "", password: "" });
  const [mfa,setMfa]=useState(false),[code,setCode]=useState("");
  useEffect(()=>{setMfa(new URLSearchParams(window.location.search).has("mfa"));},[]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError("");
    try { const result=await api(mfa?"/api/auth/mfa":"/api/auth/login", { method: "POST", body: JSON.stringify(mfa?{code}:form) }); if(result.mfa_required){setMfa(true);setForm({...form,password:""});return;} onSuccess(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return <div className="login-page">
    <div className="login-aside"><div className="brand light"><div className="brand-mark"><Icon name="logo" size={22}/></div><div><strong>Контур</strong><small>Управление работой</small></div></div><div className="login-copy"><span className="overline">ЕДИНОЕ РАБОЧЕЕ ПРОСТРАНСТВО</span><h1>От стратегии<br/>до результата.</h1><p>Проекты, процессы, задачи и команды — в защищённой системе внутри вашей инфраструктуры.</p></div><div className="login-points"><span><Icon name="shield"/>Self-hosted и ваши данные</span><span><Icon name="workflow"/>Настраиваемые процессы</span><span><Icon name="gantt"/>Kanban и диаграмма Ганта</span></div></div>
    <div className="login-panel"><form onSubmit={submit}><div className="mobile-logo"><div className="brand-mark"><Icon name="logo" size={21}/></div><strong>Контур</strong></div><span className="overline">ДОБРО ПОЖАЛОВАТЬ</span><h2>{mfa?"Подтверждение входа":"Вход в систему"}</h2><p>{mfa?"Введите код из приложения-аутентификатора или резервный код.":"Используйте локальную или доменную учётную запись."}</p>{mfa?<label><span>Одноразовый код</span><input key="mfa-code" autoFocus autoComplete="one-time-code" value={code} maxLength={40} onChange={e=>setCode(e.target.value)} required/></label>:<><label><span>Электронная почта или логин</span><input autoFocus value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value })} placeholder="name@company.ru" required/></label><label><span>Пароль</span><input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Введите пароль" required/></label></>}{error && <div className="form-error">{error}</div>}<button className="primary wide" disabled={busy}>{busy ? "Проверяем…" : "Войти"}</button>{mfa?<button type="button" className="secondary wide" onClick={()=>{setMfa(false);setCode("");setError("");}}>Вернуться к входу</button>:<><div className="or"><span>или</span></div><a className="oidc-button" href="/api/auth/oidc/start"><Icon name="shield" size={17}/>Войти через корпоративный SSO</a></>}<small className="login-note">Способ входа настраивается администратором.</small></form></div>
  </div>;
}

function ProjectsView({ data, onOpen, onTaskOpen, onNewProject, onNewGroup, onChanged }) {
  const [taskList, setTaskList] = useState(null);
  const completeTasks = data.tasks.filter((task) => task.is_done);
  const overdueTasks = data.tasks.filter((task) => !task.is_done && task.due_date && task.due_date < dateOffset(0));
  const complete = completeTasks.length;
  const overdue = overdueTasks.length;
  const features = data.permissions.features || {};
  return <div className="view-page">
    <div className="page-head"><div><span className="overline">ПОРТФЕЛЬ</span><h1>Проекты</h1><p>Группируйте инициативы, следите за сроками и загрузкой команд.</p></div>{(features["project.create"] || features["project.group.manage"]) && <div className="head-actions">{features["project.group.manage"] && <button className="secondary" onClick={onNewGroup}><Icon name="folder" size={17}/>Новая группа</button>}{features["project.create"] && <button className="primary" onClick={onNewProject}><Icon name="plus" size={17}/>Новый проект</button>}</div>}</div>
    <ProjectArchive data={data} onChanged={onChanged}/>
    <div className="metric-row"><Metric label="Активные проекты" value={data.projects.length} note={`${data.groups.length} групп`} color="purple" icon="folder"/><Metric label="Задачи выполнены" value={`${complete}/${data.tasks.length}`} note={data.tasks.length ? `${Math.round(complete / data.tasks.length * 100)}% общего объёма` : "Нет задач"} color="green" icon="check" onClick={complete ? () => setTaskList({ title: "Выполненные задачи", tasks: completeTasks }) : null}/><Metric label="Просрочено" value={overdue} note={overdue ? "Открыть список" : "Всё по плану"} color="red" icon="clock" onClick={overdue ? () => setTaskList({ title: "Просроченные задачи", tasks: overdueTasks }) : null}/><Metric label="Пользователи" value={data.users.filter((u) => u.status === "active").length} note={`${data.users.filter((u) => ["owner", "admin", "project_manager"].includes(u.global_role)).length} руководителей`} color="blue" icon="users"/></div>
    {taskList && <Modal onClose={() => setTaskList(null)}><ModalHead eyebrow="ДЕТАЛИЗАЦИЯ" title={taskList.title} onClose={() => setTaskList(null)}/><div className="metric-task-summary">{taskList.tasks.length} задач</div><div className="metric-task-list">{taskList.tasks.map((task) => <button key={task.id} onClick={() => { setTaskList(null); onTaskOpen({ ...task }); }}><span className="task-key">{task.key_code}-{task.task_number}</span><span><strong>{task.title}</strong><small>{task.project_name} · {task.assignee_name || "Не назначено"}</small></span><span className={task.due_date < dateOffset(0) && !task.is_done ? "overdue" : ""}>{formatDate(task.due_date)}</span><Icon name="chevron" size={15}/></button>)}</div></Modal>}
    {data.groups.map((group) => {
      const projects = data.projects.filter((project) => project.group_id === group.id);
      if (!projects.length) return null;
      return <section className="project-group" key={group.id}><div className="group-head"><div className="group-title"><span style={{ background: group.color }}/><div><h2>{group.name}</h2><p>{group.description}</p></div></div><span>{projects.length} {projects.length === 1 ? "проект" : "проекта"}</span></div><div className="project-grid">{projects.map((project) => <ProjectCard key={project.id} data={data} onChanged={onChanged} project={project} tasks={data.tasks.filter((task) => task.project_id === project.id)} users={data.users} onOpen={() => onOpen(project.id)}/>)}</div></section>;
    })}
    {data.projects.some((project) => !project.group_id) && <section className="project-group"><div className="group-head"><div className="group-title"><span className="muted-dot"/><div><h2>Без группы</h2><p>Проекты, которые ещё не распределены</p></div></div></div><div className="project-grid">{data.projects.filter((p) => !p.group_id).map((project) => <ProjectCard key={project.id} data={data} onChanged={onChanged} project={project} tasks={data.tasks.filter((task) => task.project_id === project.id)} users={data.users} onOpen={() => onOpen(project.id)}/>)}</div></section>}
  </div>;
}

function Metric({ label, value, note, color, icon, onClick }) { const Tag = onClick ? "button" : "div"; return <Tag className={`metric ${onClick ? "clickable" : ""}`} onClick={onClick}><span className={`metric-icon ${color}`}><Icon name={icon}/></span><div><small>{label}</small><strong>{value}</strong><span>{note}</span></div></Tag>; }

function ProjectCard({ project, tasks, users, onOpen, data, onChanged }) {
  const done = tasks.filter((task) => task.is_done).length;
  const percent = tasks.length ? Math.round(done / tasks.length * 100) : 0;
  const memberIds = [...new Set(tasks.map((task) => task.assignee_id).filter(Boolean))];
  return <article className="project-card-shell"><button className="project-card" onClick={onOpen}><div className="project-card-top"><span className="project-icon" style={{ background: `${project.color}18`, color: project.color }}>{project.key_code.slice(0, 2)}</span><Icon name="chevron" size={18}/></div><h3>{project.name}</h3><p>{project.description}</p><div className="project-dates"><span><Icon name="calendar" size={14}/>{formatDate(project.target_date, true)}</span><span>{project.key_code}</span></div><div className="project-progress"><div><span>Прогресс</span><strong>{percent}%</strong></div><div className="progress"><span style={{ width: `${percent}%`, background: project.color }}/></div></div><div className="project-card-bottom"><div className="avatar-stack">{memberIds.slice(0, 4).map((id) => { const user = users.find((u) => u.id === id); return <span key={id}>{avatar(user?.display_name, user?.avatar_color, "small")}</span>; })}</div><span>{tasks.length} задач</span></div></button><ProjectActions project={project} data={data} onChanged={onChanged}/></article>;
}

// Показывает рабочие этапы и отдельную колонку доступных запланированных задач.
function BoardView({ project, workflow, tasks, data, onOpen, onNew, onMoved, query = "" }) {
  const [drag, setDrag] = useState(null);
  const [dropStageId, setDropStageId] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState({ priority: "", assignee: "", issueType: "", overdue: false });
  if (!workflow) return <Empty text="Для проекта не найден процесс"/>;
  const permissions = data.permissions.projects[String(project.id)] || {};
  const canCreate = permissions["task.create"];
  const canEdit = permissions["task.edit"];
  const visibleTasks = tasks.filter((task) => (!filters.priority || task.priority === filters.priority) && (!filters.assignee || Number(task.assignee_id) === Number(filters.assignee)) && (!filters.issueType || Number(task.issue_type_id) === Number(filters.issueType)) && (!filters.overdue || (!task.is_done && task.due_date && task.due_date < dateOffset(0))));
  const activeFilters = Object.values(filters).filter(Boolean).length;
  return <div className="work-view"><div className="work-head"><div><span className="project-key">{project.key_code}</span><h1>{project.name}</h1><p>{workflow.name} · {visibleTasks.length} из {tasks.length} задач</p></div><div className="member-filter"><div className="avatar-stack">{data.users.slice(0, 5).map((user) => <span key={user.id}>{avatar(user.display_name, user.avatar_color, "small")}</span>)}</div><button className={`secondary ${filtersOpen ? "active" : ""}`} onClick={() => setFiltersOpen((value) => !value)} aria-expanded={filtersOpen}><Icon name="fields" size={16}/>Фильтры{activeFilters ? ` · ${activeFilters}` : ""}</button></div></div>{filtersOpen && <div className="board-filters"><select value={filters.priority} onChange={(event) => setFilters({ ...filters, priority: event.target.value })}><option value="">Все приоритеты</option>{Object.entries(PRIORITY_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><select value={filters.assignee} onChange={(event) => setFilters({ ...filters, assignee: event.target.value })}><option value="">Все исполнители</option>{data.users.map((user) => <option key={user.id} value={user.id}>{user.display_name}</option>)}</select><select value={filters.issueType} onChange={(event) => setFilters({ ...filters, issueType: event.target.value })}><option value="">Все типы задач</option>{data.issueTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select><label><input type="checkbox" checked={filters.overdue} onChange={(event) => setFilters({ ...filters, overdue: event.target.checked })}/> Только просроченные</label><button className="text-button" onClick={() => setFilters({ priority: "", assignee: "", issueType: "", overdue: false })}>Сбросить</button></div>}<div className="board">{permissions["planning.view"]&&<BoardPlans key={project.id} project={project} data={data} filters={filters} query={query}/>} {workflow.stages.map((stage) => { const columnTasks = visibleTasks.filter((task) => task.stage_id === stage.id); const limitHit = stage.wip_limit && tasks.filter((task) => task.stage_id === stage.id).length >= stage.wip_limit; const isDropTarget = Number(dropStageId) === Number(stage.id) && Number(drag?.sourceStageId) !== Number(stage.id); return <div className={`board-column ${isDropTarget ? "drop-target" : ""}`} key={stage.id} onDragEnter={() => canEdit && setDropStageId(stage.id)} onDragOver={(event) => { if (!canEdit) return; event.preventDefault(); event.dataTransfer.dropEffect = "move"; if (Number(dropStageId) !== Number(stage.id)) setDropStageId(stage.id); }} onDrop={() => { if (canEdit && drag && Number(drag.sourceStageId) !== Number(stage.id)) onMoved(drag.taskId, stage.id); setDrag(null); setDropStageId(null); }}><div className="column-head"><div><span className="stage-dot" style={{ background: stage.color }}/><strong>{stage.name}</strong><span>{columnTasks.length}</span>{stage.wip_limit && <small className={limitHit ? "limit-hit" : ""}>WIP {tasks.filter((task) => task.stage_id === stage.id).length}/{stage.wip_limit}</small>}</div>{canCreate && <button onClick={() => onNew(stage.id)} aria-label={`Создать задачу на этапе «${stage.name}»`} title="Создать задачу"><Icon name="plus" size={16}/></button>}</div><div className="task-list">{columnTasks.map((task) => <TaskCard key={task.id} task={task} project={project} onOpen={() => onOpen({ ...task })} onDrag={canEdit ? (event) => { event.dataTransfer.effectAllowed = "move"; setDrag({ taskId: task.id, sourceStageId: task.stage_id }); } : null} onDragEnd={() => { setDrag(null); setDropStageId(null); }}/>) }{!columnTasks.length && <div className="drop-zone">{activeFilters ? "Нет задач по фильтру" : canEdit ? "Перетащите задачу сюда" : "Задач пока нет"}</div>}</div></div>; })}</div></div>;
}

function TaskCard({ task, project, onOpen, onDrag, onDragEnd }) {
  return <article className="task-card" draggable={Boolean(onDrag)} onDragStart={onDrag || undefined} onDragEnd={onDragEnd} onClick={onOpen} tabIndex={0}><div className="task-card-top"><span className={`priority ${task.priority}`}>{PRIORITY_LABELS[task.priority]}</span>{task.milestone && <span className="milestone"><Icon name="flag" size={13}/>Веха</span>}</div><h3>{task.title}</h3><p>{task.description || "Описание не добавлено"}</p><div className="task-tags">{Object.entries(task.custom_values || {}).slice(0, 2).map(([key, value]) => value ? <span key={key}>{String(value)}</span> : null)}</div><div className="task-meta"><span className="task-key">{project.key_code}-{task.task_number}</span>{task.due_date && <span className={task.due_date < dateOffset(0) && !task.is_done ? "overdue" : ""}><Icon name="calendar" size={13}/>{formatDate(task.due_date)}</span>}{avatar(task.assignee_name, task.assignee_color, "small")}</div></article>;
}

function GanttView({ project, tasks, stages, onOpen }) {
  const allDates = tasks.flatMap((task) => [task.start_date, task.due_date]).filter(Boolean).sort();
  const earliest = allDates[0] || dateOffset(-7);
  const latest = allDates.at(-1) || dateOffset(30);
  const start = new Date(`${earliest}T12:00:00`); start.setDate(start.getDate() - ((start.getDay() + 6) % 7) - 2);
  const end = new Date(`${latest}T12:00:00`); end.setDate(end.getDate() + 7);
  const minimum = new Date(start); minimum.setDate(minimum.getDate() + 41); if (end < minimum) end.setTime(minimum.getTime());
  const days = []; const cursor = new Date(start); while (cursor <= end && days.length < 90) { days.push(new Date(cursor)); cursor.setDate(cursor.getDate() + 1); }
  const startIso = days[0].toISOString().slice(0, 10); const width = 34; const today = daysBetween(startIso, dateOffset(0));
  return <div className="work-view"><div className="work-head"><div><span className="project-key">{project.key_code}</span><h1>Диаграмма Ганта</h1><p>{project.name} · планирование сроков и зависимостей</p></div><div className="gantt-legend"><span><i className="today-color"/>Сегодня</span><span><i className="milestone-color"/>Веха</span></div></div><div className="gantt-shell"><div className="gantt-names"><div className="gantt-name-head">Задача</div>{tasks.map((task) => <button key={task.id} onClick={() => onOpen({ ...task })}><span style={{ background: task.stage_color }}/><div><strong>{project.key_code}-{task.task_number} · {task.title}</strong><small>{task.assignee_name || "Не назначено"}</small></div></button>)}</div><div className="gantt-scroll"><div className="gantt-canvas" style={{ width: days.length * width }}><div className="gantt-days">{days.map((day, index) => <div key={index} className={[0, 6].includes(day.getDay()) ? "weekend" : ""} style={{ width }}><small>{day.toLocaleDateString("ru", { weekday: "narrow" })}</small><strong>{day.getDate()}</strong></div>)}</div><div className="gantt-grid">{days.map((day, index) => <span key={index} className={[0, 6].includes(day.getDay()) ? "weekend" : ""} style={{ left: index * width, width }}/>)}</div>{today >= 0 && today < days.length && <div className="today-line" style={{ left: today * width + width / 2 }}><span>Сегодня</span></div>}<div className="gantt-rows">{tasks.map((task) => { const offset = Math.max(0, daysBetween(startIso, task.start_date || task.due_date || startIso)); const duration = Math.max(1, daysBetween(task.start_date || task.due_date || startIso, task.due_date || task.start_date || startIso) + 1); const color = stages.find((s) => s.id === task.stage_id)?.color || "#675EE7"; return <div className="gantt-row" key={task.id}>{task.milestone ? <button className="gantt-milestone" style={{ left: offset * width + 10, background: color }} onClick={() => onOpen({ ...task })} aria-label={`Открыть веху «${task.title}»`} title={task.title}/> : <button className="gantt-bar" style={{ left: offset * width + 4, width: Math.max(28, duration * width - 8), background: color }} onClick={() => onOpen({ ...task })} title={task.title}><span>{task.title}</span></button>}</div>; })}</div></div></div></div></div>;
}

// Открывает разрешённый раздел администрирования, в том числе из пошаговой настройки.
function AdminView({ data, reload, notify, onNewField, onEditField }) {
  const [tab, setTab] = useState("overview");
  useEffect(() => {const section = new URLSearchParams(window.location.search).get('section');if (section) setTab(section);}, []);
  const features = data.permissions.features || {};
  const sections = [
    { key: "operations", label: "Состояние платформы", icon: "reports", permission: "operations.view", description: "Инфраструктура, обработчики и очереди" },
    { key: "users", label: "Пользователи", icon: "users", permission: "user.manage", description: "Учётные записи, статусы и базовые роли" },
    { key: "permissions", label: "Роли и группы", icon: "shield", permission: ["group.manage", "role.manage"], description: "Группы доступа, роли и точечные запреты" },
    { key: "templates", label: "Шаблоны проектов", icon: "folder", permission: "project.template.manage", description: "Готовые структуры проектов и задач" },
    { key: "workflow", label: "Этапы задач", icon: "workflow", permission: "workflow.manage", description: "Процессы, статусы и WIP-лимиты" },
    { key: "fields", label: "Атрибуты задач", icon: "fields", permission: "field.manage", description: "Пользовательские поля и метаданные" },
    { key: "automation", label: "Автоматизация", icon: "reports", permission: "automation.manage", description: "Триггеры, условия и действия" },
    { key: "integrations", label: "Интеграции и API", icon: "link", permission: ["integration.view", "integration.manage"], description: "Сервисы, репозитории и журнал доставки" },
    { key: "ai", label: "Искусственный интеллект", icon: "reports", permission: "ai.configure", description: "Свои endpoint, модели, ключи и лимиты анализа" },
    { key: "sla", label: "SLA задач", icon: "clock", permission: "sla.manage", description: "Правила сроков и рабочие календари" },
    { key: "api-access", label: "Доступ к API", icon: "shield", permission: "api.access.manage", description: "Политики токенов и разрешённые методы" },
    { key: "imports", label: "Импорт из Jira", icon: "folder", permission: "import.manage", description: "Перенос проектов, задач и пользователей" },
    { key: "mail", label: "Почта", icon: "mail", permission: "mail.manage", description: "SMTP и системные уведомления" },
    { key: "auth", label: "Доменная авторизация", icon: "shield", permission: "auth.manage", description: "LDAP, Active Directory и OIDC" },
    { key: "audit", label: "Журнал аудита", icon: "search", permission: "audit.view", description: "История административных действий" },
  ].map((section) => ({ ...section, allowed: Array.isArray(section.permission) ? section.permission.some((key) => features[key]) : Boolean(features[section.permission]) }));
  const activeTab = tab === "overview" || sections.some((section) => section.key === tab && section.allowed) ? tab : "overview";
  return <div className="admin-page"><div className="page-head"><div><span className="overline">КОНФИГУРАЦИЯ</span><h1>Администрирование</h1><p>Настройте модель доступа, процессы, автоматизацию и корпоративные интеграции.</p></div>{activeTab !== "overview" && <button className="secondary" onClick={() => setTab("overview")}>← Все разделы</button>}</div><div className="admin-layout"><nav className="admin-nav"><button className={activeTab === "overview" ? "active" : ""} onClick={() => setTab("overview")}><Icon name="dashboard" size={17}/>Все разделы<Icon name="chevron" size={13}/></button>{sections.map((section) => <button className={`${activeTab === section.key ? "active" : ""} ${section.allowed ? "" : "locked"}`} key={section.key} onClick={() => section.allowed && setTab(section.key)} aria-disabled={!section.allowed} title={section.allowed ? section.label : `Нет разрешения: ${Array.isArray(section.permission) ? section.permission.join(" или ") : section.permission}`}><Icon name={section.icon} size={17}/>{section.label}{section.allowed ? <Icon name="chevron" size={13}/> : <span className="admin-lock">×</span>}</button>)}</nav><div className="admin-panel">{activeTab === "operations" && <OperationsView/>}{activeTab === "overview" && <AdminOverview sections={sections} onOpen={setTab}/>} {activeTab === "users" && <UsersAdmin data={data} reload={reload} notify={notify}/>} {activeTab === "permissions" && <><PermissionsAdmin data={data} reload={reload} notify={notify}/>{data.permissions.features["role.manage"]&&<AccessPreview data={data} notify={notify}/>}</>} {activeTab === "templates" && <ProjectTemplatesAdmin data={data} reload={reload} notify={notify}/>} {activeTab === "workflow" && <WorkflowAdmin data={data} reload={reload} notify={notify}/>} {activeTab === "fields" && <FieldsAdmin data={data} onNew={onNewField} onEdit={onEditField}/>} {activeTab === "automation" && <AutomationStudio data={data} reload={reload} notify={notify}/>} {activeTab === "integrations" && <IntegrationsHub data={data} reload={reload} notify={notify}/>} {activeTab === "ai" && <AiSettings/>} {activeTab === "sla" && <SlaAdmin data={data} reload={reload} notify={notify}/>} {activeTab === "api-access" && <ApiAccessAdmin data={data} reload={reload} notify={notify}/>} {activeTab === "imports" && <><JiraImport data={data} reload={reload} notify={notify}/><ImportAdmin data={data} reload={reload} notify={notify}/></>} {activeTab === "mail" && <MailAdmin initial={data.settings.mail || {}} reload={reload} notify={notify}/>} {activeTab === "auth" && <><AuthAdmin initial={data.settings.authentication || {}} reload={reload} notify={notify}/><DirectorySettings data={data} notify={notify}/><SecurityWorkbench data={data} notify={notify} admin/></>} {activeTab === "audit" && <AuditAdmin notify={notify}/>}</div></div></div>;
}

function AdminOverview({ sections, onOpen }) {
  const available = sections.filter((section) => section.allowed).length;
  return <><SectionHead overline="ЦЕНТР УПРАВЛЕНИЯ" title="Все разделы" text={`Доступно ${available} из ${sections.length} разделов. Глобальные администраторы имеют полный доступ; для остальных пользователей состав определяется ролями и группами.`}/><div className="admin-section-grid">{sections.map((section) => <button key={section.key} disabled={!section.allowed} onClick={() => onOpen(section.key)}><span className="admin-section-icon"><Icon name={section.icon} size={19}/></span><span><strong>{section.label}</strong><small>{section.description}</small></span>{section.allowed ? <Icon name="chevron" size={15}/> : <b>Нет доступа</b>}</button>)}</div></>;
}

function SectionHead({ overline, title, text, action }) { return <div className="section-head"><div><span className="overline">{overline}</span><h2>{title}</h2><p>{text}</p></div>{action}</div>; }

function UsersAdmin({ data, reload, notify }) {
  const [newUser, setNewUser] = useState(null);
  async function change(user, field, value) { try { await api(`/api/admin/users/${user.id}`, { method: "PATCH", body: JSON.stringify({ [field]: value }) }); await reload(); notify("Права пользователя обновлены"); } catch (e) { notify(e.message, "error"); } }
  return <><SectionHead overline="ДОСТУП" title="Пользователи" text="Глобальная роль задаёт базовый профиль. Дополнительные разрешения и запреты назначаются через роли и группы доступа." action={<button className="primary" onClick={() => setNewUser({ display_name: "", email: "", global_role: "member", password: "" })}><Icon name="plus" size={16}/>Добавить пользователя</button>}/><div className="role-cards">{[["owner", "Полный контроль"], ["admin", "Настройки и пользователи"], ["project_manager", "Проекты и команды"], ["member", "Работа с задачами"], ["viewer", "Только просмотр"]].map(([role, text]) => <div key={role}><strong>{ROLE_LABELS[role]}</strong><span>{text}</span></div>)}</div><div className="table users-table"><div className="table-row table-head"><span>Пользователь</span><span>Источник</span><span>Базовая роль</span><span>Статус</span></div>{data.users.map((user) => <div className="table-row" key={user.id}><span className="user-cell">{avatar(user.display_name, user.avatar_color)}<span><strong>{user.display_name}</strong><small>{user.email}</small></span></span><span><span className="source-badge">{user.auth_source.toUpperCase()}</span></span><span><select value={user.global_role} onChange={(e) => change(user, "global_role", e.target.value)}>{Object.entries(ROLE_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></span><span><select value={user.status} onChange={(e) => change(user, "status", e.target.value)}><option value="active">Активен</option><option value="invited">Приглашён</option><option value="blocked">Заблокирован</option></select></span></div>)}</div>{newUser && <UserModal draft={newUser} setDraft={setNewUser} onClose={() => setNewUser(null)} onSaved={async () => { setNewUser(null); await reload(); notify("Пользователь создан"); }}/>}</>;
}

function WorkflowAdmin({ data, reload, notify }) {
  const [workflowId, setWorkflowId] = useState(data.workflows[0]?.id);
  const source = data.workflows.find((item) => item.id === workflowId) || data.workflows[0];
  const [draft, setDraft] = useState(() => structuredClone(source));
  useEffect(() => setDraft(structuredClone(source)), [workflowId, source?.updated_at]);
  function updateStage(index, key, value) { setDraft((current) => ({ ...current, stages: current.stages.map((stage, i) => i === index ? { ...stage, [key]: value } : stage) })); }
  function addStage() { setDraft((current) => ({ ...current, stages: [...current.stages, { code: `stage_${current.stages.length + 1}`, name: "Новый этап", color: "#4E8AC7", category: "active", wip_limit: null, is_done: false }] })); }
  async function save() { try { await api(`/api/admin/workflows/${draft.id}`, { method: "PUT", body: JSON.stringify(draft) }); await reload(); notify("Процесс сохранён"); } catch (e) { notify(e.message, "error"); } }
  if (!draft) return <Empty text="Создайте первый процесс"/>;
  return <><SectionHead overline="РАБОЧИЕ ПРОЦЕССЫ" title="Этапы задач" text="Создавайте собственные этапы, WIP-лимиты и категории завершения." action={<button className="primary" onClick={save}><Icon name="save" size={16}/>Сохранить процесс</button>}/><label className="inline-field"><span>Процесс</span><select value={workflowId} onChange={(e) => setWorkflowId(Number(e.target.value))}>{data.workflows.map((workflow) => <option value={workflow.id} key={workflow.id}>{workflow.name}</option>)}</select></label><div className="workflow-list">{draft.stages.map((stage, index) => <div className="workflow-row" key={stage.id || index}><span className="drag-handle"><Icon name="grip"/></span><input type="color" value={stage.color} onChange={(e) => updateStage(index, "color", e.target.value)}/><label><span>Название этапа</span><input value={stage.name} onChange={(e) => updateStage(index, "name", e.target.value)}/></label><label><span>Категория</span><select value={stage.category} onChange={(e) => { updateStage(index, "category", e.target.value); if (e.target.value === "done") updateStage(index, "is_done", true); }}><option value="backlog">Бэклог</option><option value="active">В работе</option><option value="review">Проверка</option><option value="done">Завершено</option></select></label><label className="wip-field"><span>WIP-лимит</span><input type="number" min="1" value={stage.wip_limit || ""} onChange={(e) => updateStage(index, "wip_limit", e.target.value ? Number(e.target.value) : null)} placeholder="—"/></label><label className="toggle compact"><input type="checkbox" checked={Boolean(stage.is_done)} onChange={(e) => updateStage(index, "is_done", e.target.checked)}/><i/><span>Финальный</span></label></div>)}</div><button className="add-row" onClick={addStage}><Icon name="plus" size={16}/>Добавить этап</button><div className="info-box"><Icon name="shield"/><p><strong>Безопасное изменение процесса</strong><span>Этапы, на которых уже есть задачи, не удаляются автоматически. Сначала перенесите задачи на другой этап.</span></p></div></>;
}

function FieldsAdmin({ data, onNew, onEdit }) { return <><SectionHead overline="МЕТАДАННЫЕ" title="Атрибуты задач" text="Дополняйте стандартную карточку собственными полями для любых процессов." action={<button className="primary" onClick={onNew}><Icon name="plus" size={16}/>Новый атрибут</button>}/><div className="fields-grid">{data.fields.map((field) => <div className="field-card" key={field.id}><div><span className="field-type"><Icon name="fields" size={16}/></span><div><strong>{field.label}</strong><small>{field.code}</small></div></div><span>{FIELD_LABELS[field.field_type]}</span><div><span className={`status-pill ${field.required ? "required" : ""}`}>{field.required ? "Обязательное" : "Необязательное"}</span><button className="secondary" onClick={() => onEdit(field)}>Настроить</button></div>{field.options?.length > 0 && <p>{field.options.join(" · ")}</p>}</div>)}</div></>;
}

function MailAdmin({ initial, reload, notify }) {
  const [form, setForm] = useState({ enabled: false, host: "", port: 587, secure: false, username: "", password: "••••••••", fromName: "Контур", fromEmail: "", rejectUnauthorized: true, ...initial });
  const [busy, setBusy] = useState(false);
  async function save() { setBusy(true); try { await api("/api/admin/settings/mail", { method: "PUT", body: JSON.stringify(form) }); await reload(); notify("Настройки почты сохранены"); } catch (e) { notify(e.message, "error"); } finally { setBusy(false); } }
  async function test() { setBusy(true); try { const result = await api("/api/admin/test/mail", { method: "POST", body: "{}" }); notify(result.message); } catch (e) { notify(e.message, "error"); } finally { setBusy(false); } }
  return <><SectionHead overline="УВЕДОМЛЕНИЯ" title="Исходящая почта" text="Подключите корпоративный SMTP для приглашений, уведомлений и сброса паролей." action={<button className="primary" onClick={save} disabled={busy}><Icon name="save" size={16}/>Сохранить</button>}/><label className="toggle main-toggle"><input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })}/><i/><span><strong>Включить отправку почты</strong><small>Система начнёт отправлять уведомления после успешной проверки.</small></span></label><div className="settings-form"><label><span>SMTP-сервер</span><input value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} placeholder="smtp.company.ru"/></label><label><span>Порт</span><input type="number" value={form.port} onChange={(e) => setForm({ ...form, port: Number(e.target.value) })}/></label><label><span>Имя пользователя</span><input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })}/></label><label><span>Пароль приложения</span><input type="password" value={form.password} onFocus={() => form.password === "••••••••" && setForm({ ...form, password: "" })} onChange={(e) => setForm({ ...form, password: e.target.value })}/></label><label><span>Имя отправителя</span><input value={form.fromName} onChange={(e) => setForm({ ...form, fromName: e.target.value })}/></label><label><span>Адрес отправителя</span><input type="email" value={form.fromEmail} onChange={(e) => setForm({ ...form, fromEmail: e.target.value })}/></label></div><div className="setting-checks"><label className="toggle"><input type="checkbox" checked={form.secure} onChange={(e) => setForm({ ...form, secure: e.target.checked })}/><i/><span>SMTPS / TLS с первого соединения</span></label><label className="toggle"><input type="checkbox" checked={form.rejectUnauthorized !== false} onChange={(e) => setForm({ ...form, rejectUnauthorized: e.target.checked })}/><i/><span>Проверять сертификат сервера</span></label></div><div className="test-row"><div><Icon name="mail"/><span><strong>Проверка SMTP</strong><small>Отправим тестовое письмо текущему администратору.</small></span></div><button className="secondary" onClick={test} disabled={busy}>Проверить и отправить</button></div></>;
}

function AuthAdmin({ initial, reload, notify }) {
  const [form, setForm] = useState({ localEnabled: true, ldap: { enabled: false, url: "", baseDn: "", bindDn: "", bindPassword: "••••••••", userFilter: "(mail={{login}})", rejectUnauthorized: true }, oidc: { enabled: false, issuer: "", clientId: "", clientSecret: "••••••••", scopes: "openid profile email" }, ...initial, ldap: { ...initial.ldap, bindPassword: initial.ldap?.bindPasswordConfigured ? "••••••••" : "" }, oidc: { ...initial.oidc, clientSecret: initial.oidc?.clientSecretConfigured ? "••••••••" : "" } });
  const [provider, setProvider] = useState("ldap");
  const [busy, setBusy] = useState(false);
  function nested(name, key, value) { setForm({ ...form, [name]: { ...form[name], [key]: value } }); }
  async function save() { setBusy(true); try { await api("/api/admin/settings/authentication", { method: "PUT", body: JSON.stringify(form) }); await reload(); notify("Настройки авторизации сохранены"); } catch (e) { notify(e.message, "error"); } finally { setBusy(false); } }
  async function test(kind) { setBusy(true); try { const result = await api(`/api/admin/test/${kind}`, { method: "POST", body: "{}" }); notify(result.message); } catch (e) { notify(e.message, "error"); } finally { setBusy(false); } }
  return <><SectionHead overline="ЕДИНЫЙ ВХОД" title="Доменная авторизация" text="Поддерживаются LDAP/Active Directory и OIDC-провайдеры: Keycloak, Entra ID, Authentik и другие." action={<button className="primary" onClick={save} disabled={busy}><Icon name="save" size={16}/>Сохранить</button>}/><label className="toggle main-toggle"><input type="checkbox" checked={form.localEnabled !== false} onChange={(e) => setForm({ ...form, localEnabled: e.target.checked })}/><i/><span><strong>Разрешить локальный вход</strong><small>Не отключайте до успешной проверки корпоративного входа.</small></span></label><div className="provider-switch"><button className={provider === "ldap" ? "active" : ""} onClick={() => setProvider("ldap")}><Icon name="users" size={17}/>LDAP / Active Directory</button><button className={provider === "oidc" ? "active" : ""} onClick={() => setProvider("oidc")}><Icon name="shield" size={17}/>OIDC / SSO</button></div>{provider === "ldap" ? <div><label className="toggle provider-toggle"><input type="checkbox" checked={Boolean(form.ldap.enabled)} onChange={(e) => nested("ldap", "enabled", e.target.checked)}/><i/><span>Включить LDAP-вход</span></label><div className="settings-form"><label className="span-2"><span>URL сервера</span><input value={form.ldap.url || ""} onChange={(e) => nested("ldap", "url", e.target.value)} placeholder="ldaps://dc.company.local:636"/></label><label className="span-2"><span>Base DN</span><input value={form.ldap.baseDn || ""} onChange={(e) => nested("ldap", "baseDn", e.target.value)} placeholder="DC=company,DC=local"/></label><label><span>Bind DN</span><input value={form.ldap.bindDn || ""} onChange={(e) => nested("ldap", "bindDn", e.target.value)} placeholder="CN=Service,OU=Users,…"/></label><label><span>Пароль Bind DN</span><input type="password" value={form.ldap.bindPassword || ""} onFocus={() => form.ldap.bindPassword === "••••••••" && nested("ldap", "bindPassword", "")} onChange={(e) => nested("ldap", "bindPassword", e.target.value)}/></label><label className="span-2"><span>Фильтр пользователя</span><input value={form.ldap.userFilter || ""} onChange={(e) => nested("ldap", "userFilter", e.target.value)} placeholder="(sAMAccountName={{login}})"/></label></div><div className="test-row"><div><Icon name="link"/><span><strong>Проверка LDAP</strong><small>Выполним bind и поиск в Base DN.</small></span></div><button className="secondary" onClick={() => test("ldap")} disabled={busy}>Проверить подключение</button></div></div> : <div><label className="toggle provider-toggle"><input type="checkbox" checked={Boolean(form.oidc.enabled)} onChange={(e) => nested("oidc", "enabled", e.target.checked)}/><i/><span>Включить OIDC-вход</span></label><div className="settings-form"><label className="span-2"><span>Issuer URL</span><input value={form.oidc.issuer || ""} onChange={(e) => nested("oidc", "issuer", e.target.value)} placeholder="https://sso.company.ru/realms/main"/></label><label><span>Client ID</span><input value={form.oidc.clientId || ""} onChange={(e) => nested("oidc", "clientId", e.target.value)}/></label><label><span>Client secret</span><input type="password" value={form.oidc.clientSecret || ""} onFocus={() => form.oidc.clientSecret === "••••••••" && nested("oidc", "clientSecret", "")} onChange={(e) => nested("oidc", "clientSecret", e.target.value)}/></label><label className="span-2"><span>Scopes</span><input value={form.oidc.scopes || ""} onChange={(e) => nested("oidc", "scopes", e.target.value)}/></label></div><div className="callback-box"><span>Callback URL</span><code>{typeof window !== "undefined" ? `${window.location.origin}/api/auth/oidc/callback` : "/api/auth/oidc/callback"}</code></div><div className="test-row"><div><Icon name="shield"/><span><strong>Проверка OIDC</strong><small>Загрузим discovery-документ и проверим обязательные endpoints.</small></span></div><button className="secondary" onClick={() => test("oidc")} disabled={busy}>Проверить провайдера</button></div></div>}</>;
}

function Modal({ children, onClose, wide = false }) { useEffect(() => { const close = (event) => event.key === "Escape" && onClose(); window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close); }, [onClose]); return <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()} role="presentation"><div className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true">{children}</div></div>; }
function ModalHead({ eyebrow, title, onClose }) { return <div className="modal-head"><div><span className="overline">{eyebrow}</span><h2>{title}</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Закрыть окно" title="Закрыть"><Icon name="close"/></button></div>; }

function TaskModal({ task, data, project, workflow, notify, onClose, onSaved }) {
  const isNew = !task.id;
  const permissions = data.permissions.projects[String(project.id)] || {};
  const canSave = isNew ? permissions["task.create"] : permissions["task.edit"];
  const canAssign = permissions["task.assign"];
  const canDelete = !isNew && permissions["task.delete"];
  const [draft, setDraft] = useState({ environment: "", issue_type_id: data.issueTypes.find((item) => item.code === "task")?.id || null, ...task, custom_values: task.custom_values || {}, dependencies: task.dependencies || [] });
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  function set(key, value) { setDraft((current) => ({ ...current, [key]: value })); }
  async function save(event) { event.preventDefault(); if (!canSave) return; setBusy(true); setError(""); try { await api(isNew ? "/api/tasks" : `/api/tasks/${draft.id}`, { method: isNew ? "POST" : "PATCH", body: JSON.stringify({ ...draft, ...(isNew ? {} : { dependencies: undefined }) }) }); onSaved(isNew ? "Задача создана" : "Задача обновлена"); } catch (e) { setError(e.message); } finally { setBusy(false); } }
  async function remove() { if (!confirm("Удалить задачу без возможности восстановления?")) return; setBusy(true); try { await api(`/api/tasks/${draft.id}`, { method: "DELETE" }); onSaved("Задача удалена"); } catch (e) { setError(e.message); setBusy(false); } }
  const projectTasks = data.tasks.filter((item) => item.project_id === project.id && item.id !== draft.id);
  return <Modal onClose={onClose} wide><ModalHead eyebrow={isNew ? "НОВАЯ ЗАДАЧА" : `${project.key_code}-${task.task_number} · v${task.version_number || 1}`} title={isNew ? "Создать задачу" : task.title} onClose={onClose}/><form className="task-editor-form" onSubmit={save}><label className="form-field span-2"><span>Название задачи</span><input autoFocus value={draft.title} onChange={(e) => set("title", e.target.value)} placeholder="Что необходимо сделать?" required/></label><label className="form-field span-2"><span>Описание</span><textarea value={draft.description || ""} onChange={(e) => set("description", e.target.value)} rows="5" placeholder="Контекст, ожидаемый результат и критерии приёмки…"/></label><div className="modal-grid">
    <label className="form-field"><span>Тип задачи</span><select value={draft.issue_type_id || ""} onChange={(e) => set("issue_type_id", e.target.value ? Number(e.target.value) : null)}><option value="">Обычная задача</option>{data.issueTypes.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
    <label className="form-field"><span>Этап</span><select value={draft.stage_id} onChange={(e) => set("stage_id", Number(e.target.value))}>{workflow.stages.map((stage) => <option value={stage.id} key={stage.id}>{stage.name}</option>)}</select></label>
    <label className="form-field"><span>Приоритет</span><select value={draft.priority} onChange={(e) => set("priority", e.target.value)}>{Object.entries(PRIORITY_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
    <label className="form-field"><span>Исполнитель</span><select disabled={!canAssign} value={draft.assignee_id || ""} onChange={(e) => set("assignee_id", e.target.value ? Number(e.target.value) : null)}><option value="">Не назначен</option>{data.users.filter((u) => u.status === "active").map((user) => <option value={user.id} key={user.id}>{user.display_name}</option>)}</select></label>
    <label className="form-field"><span>Родительская задача</span><select value={draft.parent_task_id || ""} onChange={(e) => set("parent_task_id", e.target.value ? Number(e.target.value) : null)}><option value="">Нет</option>{projectTasks.map((item) => <option value={item.id} key={item.id}>{project.key_code}-{item.task_number} · {item.title}</option>)}</select></label>
    <label className="form-field"><span>Эпик</span><select value={draft.epic_task_id || ""} onChange={(e) => set("epic_task_id", e.target.value ? Number(e.target.value) : null)}><option value="">Нет</option>{projectTasks.filter((item) => item.issue_type_code === "epic").map((item) => <option value={item.id} key={item.id}>{project.key_code}-{item.task_number} · {item.title}</option>)}</select></label>
    <label className="form-field"><span>Спринт</span><select value={draft.sprint_id || ""} onChange={(e) => set("sprint_id", e.target.value ? Number(e.target.value) : null)}><option value="">Бэклог</option>{data.sprints.filter((item) => item.project_id === project.id && !["completed", "cancelled"].includes(item.status)).map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
    <label className="form-field"><span>Релиз</span><select value={draft.release_id || ""} onChange={(e) => set("release_id", e.target.value ? Number(e.target.value) : null)}><option value="">Не указан</option>{data.releases.filter((item) => item.project_id === project.id).map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
    <label className="form-field"><span>Компонент</span><select value={draft.component_id || ""} onChange={(e) => set("component_id", e.target.value ? Number(e.target.value) : null)}><option value="">Не указан</option>{data.components.filter((item) => item.project_id === project.id).map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
    <label className="form-field"><span>Story points</span><input type="number" min="0" step="0.5" value={draft.story_points ?? ""} onChange={(e) => set("story_points", e.target.value ? Number(e.target.value) : null)}/></label>
    <label className="form-field"><span>Оценка, минуты</span><input type="number" min="0" value={draft.estimate_minutes ?? ""} onChange={(e) => set("estimate_minutes", e.target.value ? Number(e.target.value) : null)}/></label>
    <label className="form-field"><span>Резолюция</span><select value={draft.resolution || ""} onChange={(e) => set("resolution", e.target.value || null)}><option value="">Не решена</option><option value="done">Выполнено</option><option value="fixed">Исправлено</option><option value="duplicate">Дубликат</option><option value="wont_do">Не будет сделано</option></select></label>
    <label className="form-field"><span>Дата начала</span><input type="date" value={draft.start_date || ""} onChange={(e) => set("start_date", e.target.value || null)}/></label><label className="form-field"><span>Срок</span><input type="date" value={draft.due_date || ""} onChange={(e) => set("due_date", e.target.value || null)}/></label>
    <label className="form-field span-2"><span>Окружение / версия</span><input value={draft.environment || ""} onChange={(e) => set("environment", e.target.value)} placeholder="Например: production, Chrome 128, API v2"/></label>
    <label className="form-field span-2"><span>Прогресс · {draft.progress || 0}%</span><input className="range" type="range" min="0" max="100" step="5" value={draft.progress || 0} onChange={(e) => set("progress", Number(e.target.value))}/></label>{data.fields.filter(field => task.field_access?.[field.code]?.read !== false).map((field) => <fieldset key={field.id} disabled={task.field_access?.[field.code]?.edit === false} style={{ border: 0, padding: 0, minWidth: 0 }}><CustomField field={field} value={draft.custom_values[field.code]} onChange={(value) => set("custom_values", { ...draft.custom_values, [field.code]: value })}/></fieldset>)}<label className="toggle span-2"><input type="checkbox" checked={Boolean(draft.milestone)} onChange={(e) => set("milestone", e.target.checked)}/><i/><span><strong>Ключевая веха</strong><small>Отобразить задачу ромбом на диаграмме Ганта.</small></span></label></div>{error && <div className="form-error">{error}</div>}<div className="modal-actions">{canDelete && <button type="button" className="danger" onClick={remove} disabled={busy}><Icon name="trash" size={16}/>Удалить</button>}<span/><button type="button" className="secondary" onClick={onClose}>Закрыть</button>{canSave && <button className="primary" disabled={busy}><Icon name="save" size={16}/>{busy ? "Сохраняем…" : "Сохранить"}</button>}</div></form>{!isNew && <>{permissions['ai.project.analyze']&&<TaskAiAssistant task={task} notify={notify} canEdit={canSave} onAppend={text=>setDraft(current=>({...current,description:(current.description||'')+text}))}/>}<TaskActivity task={task} data={data} notify={notify}/><TaskDevelopment taskId={task.id}/><JiraTaskHistory taskId={task.id}/><SlaHistory taskId={task.id}/></>}</Modal>;
}

function CustomField({ field, value, onChange }) {
  const props = { value: value ?? "", onChange: (e) => onChange(e.target.value), required: Boolean(field.required) };
  if (field.field_type === "select") return <label className="form-field"><span>{field.label}</span><select {...props}><option value="">Не выбрано</option>{field.options.map((item) => <option key={item}>{item}</option>)}</select></label>;
  if (field.field_type === "boolean") return <label className="toggle"><input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)}/><i/><span>{field.label}</span></label>;
  return <label className="form-field"><span>{field.label}</span><input type={field.field_type === "number" ? "number" : field.field_type === "date" ? "date" : field.field_type === "url" ? "url" : "text"} {...props}/></label>;
}

function ProjectModal({ draft, setDraft, data, onClose, onSaved }) {
  const [error, setError] = useState("");
  async function save(e) { e.preventDefault(); try { await api("/api/projects", { method: "POST", body: JSON.stringify(draft) }); onSaved(); } catch (x) { setError(x.message); } }
  function selectTemplate(value) {
    const template = data.projectTemplates.find((item) => item.id === Number(value));
    if (!template) return setDraft({ ...draft, template_id: null });
    setDraft({ ...draft, template_id: template.id, workflow_id: template.workflow_id, group_id: template.default_group_id || null, color: template.color, target_date: dateOffset(template.duration_days || 30) });
  }
  return <Modal onClose={onClose}><ModalHead eyebrow="НОВЫЙ ПРОЕКТ" title="Создать проект" onClose={onClose}/><form onSubmit={save}><label className="form-field"><span>Шаблон</span><select value={draft.template_id || ""} onChange={(e) => selectTemplate(e.target.value)}><option value="">Пустой проект</option>{data.projectTemplates.map((template) => <option value={template.id} key={template.id}>{template.name} · {template.default_tasks.length} задач</option>)}</select></label><label className="form-field"><span>Название</span><input autoFocus value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required/></label><label className="form-field"><span>Ключ проекта</span><input value={draft.key_code} onChange={(e) => setDraft({ ...draft, key_code: e.target.value.toUpperCase() })} placeholder="NOVA" maxLength="12" required/></label><label className="form-field"><span>Группа</span><select value={draft.group_id || ""} onChange={(e) => setDraft({ ...draft, group_id: e.target.value ? Number(e.target.value) : null })}><option value="">Без группы</option>{data.groups.map((g) => <option value={g.id} key={g.id}>{g.name}</option>)}</select></label><label className="form-field"><span>Процесс</span><select value={draft.workflow_id} onChange={(e) => setDraft({ ...draft, workflow_id: Number(e.target.value) })}>{data.workflows.map((w) => <option value={w.id} key={w.id}>{w.name}</option>)}</select></label><label className="form-field span-2"><span>Описание</span><textarea rows="4" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })}/></label><div className="modal-grid"><label className="form-field"><span>Начало</span><input type="date" value={draft.start_date} onChange={(e) => setDraft({ ...draft, start_date: e.target.value })}/></label><label className="form-field"><span>Целевая дата</span><input type="date" value={draft.target_date} onChange={(e) => setDraft({ ...draft, target_date: e.target.value })}/></label></div>{error && <div className="form-error">{error}</div>}<div className="modal-actions"><span/><span/><button type="button" className="secondary" onClick={onClose}>Отмена</button><button className="primary">Создать проект</button></div></form></Modal>;
}

function GroupModal({ draft, setDraft, onClose, onSaved }) {
  const [error, setError] = useState("");
  async function save(e) { e.preventDefault(); try { await api("/api/groups", { method: "POST", body: JSON.stringify(draft) }); onSaved(); } catch (x) { setError(x.message); } }
  return <Modal onClose={onClose}><ModalHead eyebrow="ПОРТФЕЛЬ" title="Новая группа проектов" onClose={onClose}/><form onSubmit={save}><label className="form-field"><span>Название группы</span><input autoFocus value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required/></label><label className="form-field"><span>Описание</span><textarea rows="4" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })}/></label><label className="color-field"><span>Цвет группы</span><input type="color" value={draft.color} onChange={(e) => setDraft({ ...draft, color: e.target.value })}/><code>{draft.color}</code></label>{error && <div className="form-error">{error}</div>}<div className="modal-actions"><span/><span/><button type="button" className="secondary" onClick={onClose}>Отмена</button><button className="primary">Создать группу</button></div></form></Modal>;
}

function FieldModal({ draft, setDraft, onClose, onSaved }) {
  const editing = Boolean(draft.id);
  const [options, setOptions] = useState(() => (draft.options || []).join("\n")); const [error, setError] = useState("");
  async function save(e) { e.preventDefault(); try { const values = options.split("\n").map((x) => x.trim()).filter(Boolean); const payload = editing ? { label: draft.label, required: draft.required, options: values } : { ...draft, options: values }; await api(editing ? `/api/admin/fields/${draft.id}` : "/api/admin/fields", { method: editing ? "PATCH" : "POST", body: JSON.stringify(payload) }); onSaved(editing ? "Атрибут обновлён" : "Атрибут создан"); } catch (x) { setError(x.message); } }
  return <Modal onClose={onClose}><ModalHead eyebrow="МЕТАДАННЫЕ" title={editing ? "Настроить атрибут" : "Новый атрибут задачи"} onClose={onClose}/><form onSubmit={save}><label className="form-field"><span>Название</span><input autoFocus value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} placeholder="Бизнес-ценность" required/></label><label className="form-field"><span>Системный код</span><input value={draft.code} disabled={editing} onChange={(e) => setDraft({ ...draft, code: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })} placeholder="business_value" required/></label><label className="form-field"><span>Тип поля</span><select value={draft.field_type} disabled={editing} onChange={(e) => setDraft({ ...draft, field_type: e.target.value })}>{Object.entries(FIELD_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>{["select", "multiselect"].includes(draft.field_type) && <label className="form-field"><span>Варианты (по одному в строке)</span><textarea rows="5" value={options} onChange={(e) => setOptions(e.target.value)}/></label>}<label className="toggle"><input type="checkbox" checked={draft.required} onChange={(e) => setDraft({ ...draft, required: e.target.checked })}/><i/><span>Обязательное поле</span></label>{error && <div className="form-error">{error}</div>}<div className="modal-actions"><span/><span/><button type="button" className="secondary" onClick={onClose}>Отмена</button><button className="primary">{editing ? "Сохранить" : "Создать атрибут"}</button></div></form></Modal>;
}

function UserModal({ draft, setDraft, onClose, onSaved }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function save(event) {
    event.preventDefault(); setBusy(true); setError("");
    try { await api("/api/admin/users", { method: "POST", body: JSON.stringify(draft) }); onSaved(); }
    catch (e) { setError(e.message); setBusy(false); }
  }
  return <Modal onClose={onClose}><ModalHead eyebrow="ЛОКАЛЬНАЯ УЧЁТНАЯ ЗАПИСЬ" title="Новый пользователь" onClose={onClose}/><form onSubmit={save}><label className="form-field"><span>Имя</span><input autoFocus value={draft.display_name} onChange={(e) => setDraft({ ...draft, display_name: e.target.value })} required/></label><label className="form-field"><span>Электронная почта</span><input type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} required/></label><label className="form-field"><span>Роль</span><select value={draft.global_role} onChange={(e) => setDraft({ ...draft, global_role: e.target.value })}>{Object.entries(ROLE_LABELS).filter(([value]) => value !== "owner").map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label className="form-field"><span>Временный пароль (не менее 10 символов)</span><input type="password" minLength="10" value={draft.password} onChange={(e) => setDraft({ ...draft, password: e.target.value })} required/></label>{error && <div className="form-error">{error}</div>}<div className="modal-actions"><span/><span/><button type="button" className="secondary" onClick={onClose}>Отмена</button><button className="primary" disabled={busy}>{busy ? "Создаём…" : "Создать пользователя"}</button></div></form></Modal>;
}

function Empty({ text }) { return <div className="empty"><Icon name="folder" size={28}/><p>{text}</p></div>; }
