"use client";
import {SlaNotifications} from "./SlaCalendars.jsx";
import {StaleArticleList} from "./KnowledgeCrdtEditor.jsx";
import {AnalyticsWidget,DashboardFilters,filteredDashboardData,FormulaEditor,DashboardSharing,DashboardSubscription} from "./DashboardAnalytics.jsx";
import SlaCalendars, {SlaConfig} from './SlaCalendars.jsx';
import {useWork,useAction} from './WorkUI.jsx';
import KnowledgeCollaboration from "./KnowledgeCollaboration.jsx";

import { useEffect, useRef, useState } from "react";
import { AiButton } from "./AiTools";
import { API_ENDPOINTS } from "../lib/api-docs";

async function request(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { "content-type": "application/json", ...(options.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Ошибка запроса");
  return body;
}

const PRIORITY = { critical: "Критический", high: "Высокий", medium: "Средний", low: "Низкий" };
const SPRINT_STATUS = { planned: "Запланирован", active: "Активен", completed: "Завершён", cancelled: "Отменён" };

function today(offset = 0) {
  const value = new Date();
  value.setDate(value.getDate() + offset);
  return value.toISOString().slice(0, 10);
}

function date(value, time = false) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ru-RU", time ? { dateStyle: "medium", timeStyle: "short" } : { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
}

function isoDateTime(value) {
  if (!value) return null;
  const normalized = typeof value === "string" && !value.includes("T") ? `${value.replace(" ", "T")}Z` : value;
  return new Date(normalized).toISOString();
}

function percent(done, total) { return total ? Math.round((Number(done || 0) / Number(total)) * 100) : 0; }
function taskKey(task) { return `${task.key_code}-${task.task_number}`; }
function groupBy(items, selector) {
  return items.reduce((groups, item) => {
    const key = String(selector(item));
    (groups[key] ||= []).push(item);
    return groups;
  }, {});
}
function slugify(value) {
  const map = { а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya" };
  return String(value || "").toLowerCase().split("").map((char) => map[char] ?? char).join("").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || `article-${Date.now()}`;
}

let knowledgeBlockSequence = 0;
function knowledgeBlock(type = "paragraph", text = "") { return { id: `kb-${Date.now()}-${knowledgeBlockSequence++}`, type, text }; }
function markdownToBlocks(source = "") {
  const lines = String(source).replace(/\r/g, "").split("\n");
  const blocks = [];
  const special = (line) => /^(```|#{1,3}\s|[-*]\s|\d+\.\s|>\s|---\s*$)/.test(line);
  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }
    if (line.startsWith("```")) {
      const language = line.slice(3).trim();
      const content = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith("```")) content.push(lines[index++]);
      if (index < lines.length) index += 1;
      blocks.push({ ...knowledgeBlock("code", content.join("\n")), language });
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) { blocks.push(knowledgeBlock(heading[1].length >= 3 ? "heading3" : "heading2", heading[2])); index += 1; continue; }
    if (/^[-*]\s+/.test(line)) {
      const content = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index])) content.push(lines[index++].replace(/^[-*]\s+/, ""));
      blocks.push(knowledgeBlock("bullet", content.join("\n")));
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      const content = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index])) content.push(lines[index++].replace(/^\d+\.\s+/, ""));
      blocks.push(knowledgeBlock("numbered", content.join("\n")));
      continue;
    }
    if (/^>\s?/.test(line)) {
      const content = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) content.push(lines[index++].replace(/^>\s?/, ""));
      blocks.push(knowledgeBlock("quote", content.join("\n")));
      continue;
    }
    if (/^---\s*$/.test(line)) { blocks.push(knowledgeBlock("divider")); index += 1; continue; }
    const content = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !special(lines[index])) content.push(lines[index++]);
    blocks.push(knowledgeBlock("paragraph", content.join("\n")));
  }
  return blocks.length ? blocks : [knowledgeBlock("paragraph")];
}
function blocksToMarkdown(blocks = []) {
  return blocks.map((block) => {
    const text = String(block.text || "").trim();
    if (block.type === "heading2") return `## ${text}`;
    if (block.type === "heading3") return `### ${text}`;
    if (block.type === "bullet") return text.split("\n").filter(Boolean).map((line) => `- ${line}`).join("\n");
    if (block.type === "numbered") return text.split("\n").filter(Boolean).map((line, index) => `${index + 1}. ${line}`).join("\n");
    if (block.type === "quote") return text.split("\n").map((line) => `> ${line}`).join("\n");
    if (block.type === "code") return `\`\`\`${block.language || ""}\n${String(block.text || "")}\n\`\`\``;
    if (block.type === "divider") return "---";
    return text;
  }).filter(Boolean).join("\n\n");
}
function inlineMarkdown(text) {
  return String(text || "").split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*\n]+\*|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g).filter(Boolean).map((part, index) => {
    if (/^\*\*.*\*\*$/.test(part)) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (/^`.*`$/.test(part)) return <code key={index}>{part.slice(1, -1)}</code>;
    if (/^\*.*\*$/.test(part)) return <em key={index}>{part.slice(1, -1)}</em>;
    const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/);
    if (link) return <a key={index} href={link[2]} target="_blank" rel="noreferrer">{link[1]}</a>;
    return part.split("\n").map((line, lineIndex) => <span key={`${index}-${lineIndex}`}>{lineIndex > 0 && <br/>}{line}</span>);
  });
}
function MarkdownContent({ body, className = "article-body" }) {
  const blocks = markdownToBlocks(body);
  return <div className={className}>{blocks.map((block) => {
    if (block.type === "heading2") return <h2 key={block.id}>{inlineMarkdown(block.text)}</h2>;
    if (block.type === "heading3") return <h3 key={block.id}>{inlineMarkdown(block.text)}</h3>;
    if (block.type === "bullet") return <ul key={block.id}>{block.text.split("\n").filter(Boolean).map((line, index) => <li key={index}>{inlineMarkdown(line)}</li>)}</ul>;
    if (block.type === "numbered") return <ol key={block.id}>{block.text.split("\n").filter(Boolean).map((line, index) => <li key={index}>{inlineMarkdown(line)}</li>)}</ol>;
    if (block.type === "quote") return <blockquote key={block.id}>{inlineMarkdown(block.text)}</blockquote>;
    if (block.type === "code") return <pre key={block.id}><code>{block.text}</code></pre>;
    if (block.type === "divider") return <hr key={block.id}/>;
    return <p key={block.id}>{inlineMarkdown(block.text)}</p>;
  })}</div>;
}

function PageTitle({ eyebrow, title, text, actions }) {
  return <div className="page-head"><div><span className="overline">{eyebrow}</span><h1>{title}</h1><p>{text}</p></div>{actions && <div className="head-actions">{actions}</div>}</div>;
}

function Progress({ value, color = "#675ee7" }) {
  return <div className="progress advanced-progress"><span style={{ width: `${Math.min(100, Math.max(0, value))}%`, background: color }}/></div>;
}

function TaskLine({ task, onOpen, action }) {
  return <div className={`advanced-task-line ${action ? "has-action" : ""}`}><button onClick={() => onOpen({ ...task })}><span className="issue-dot" style={{ background: task.issue_type_color || task.stage_color }}/><strong>{taskKey(task)}</strong><span>{task.title}</span></button><span className={`priority-text ${task.priority}`}>{PRIORITY[task.priority]}</span><small className="task-story-points">{task.story_points != null ? `${task.story_points} SP` : ""}</small>{action && <div className="task-line-action">{action}</div>}</div>;
}

export function PortfolioDashboard({ data, project, tasks, onOpen, setView }) {
  const dashboard = data.dashboards.find((item) => item.id === data.homeDashboardId) || data.dashboards[0];
  return <div className="view-page advanced-page">
    <PageTitle eyebrow="ПЕРСОНАЛЬНАЯ ГЛАВНАЯ" title={`Добрый день, ${data.user.display_name.split(" ")[0]}`} text={dashboard ? `${dashboard.name} · данные обновлены с учётом ваших прав` : "Создайте собственную главную страницу из виджетов."} actions={<><AiButton kind="project" sourceId={project.id} title={project.name} permissions={data.permissions.projects[String(project.id)]}/><button className="primary" onClick={() => setView("dashboards")}>Настроить виджеты</button></>}/>
    {dashboard ? <DashboardCanvas dashboard={dashboard} data={data} onOpen={onOpen}/> : <div className="surface dashboard-empty"><strong>Главная страница ещё не настроена</strong><span>Откройте конструктор и добавьте показатели задач, SLA и портфеля.</span></div>}
  </div>;
}

const WIDGET_TYPES = [
  ["sla_summary", "Контроль SLA"], ["sla_risk", "Задачи с риском SLA"], ["my_tasks", "Мои задачи"], ["overdue", "Просроченные задачи"],
  ["status_distribution", "Задачи по этапам"], ["priority_distribution", "Задачи по приоритетам"], ["project_progress", "Прогресс проектов"],
  ["workload", "Загрузка команды"], ["formula", "Формула показателя"], ["period_comparison", "Сравнение периодов"],
];
const SLA_LABELS = { on_track: "В норме", warning: "Под угрозой", breached: "Нарушено", achieved: "Выполнено" };

function widgetTasks(widget, data) {
  const projectId = Number(widget.config?.projectId || 0);
  return projectId ? data.tasks.filter((task) => Number(task.project_id) === projectId) : data.tasks;
}

function humanMinutes(value) {
  const minutes = Math.abs(Number(value || 0));
  if (minutes >= 1440) return `${Math.floor(minutes / 1440)} д ${Math.floor((minutes % 1440) / 60)} ч`;
  if (minutes >= 60) return `${Math.floor(minutes / 60)} ч ${minutes % 60} мин`;
  return `${minutes} мин`;
}

function DashboardWidget({ widget, data, onOpen, onDrilldown, filter }) {
  if (["formula","period_comparison"].includes(widget.widget_type)) return <AnalyticsWidget widget={widget} filter={filter}/>;
  const tasks = widgetTasks(widget, data);
  const taskIds = new Set(tasks.map((task) => task.id));
  const sla = data.taskSla.filter((item) => taskIds.has(item.task_id) && (!widget.config?.policyId || Number(item.policy_id) === Number(widget.config.policyId)));
  const title = widget.title;
  const tasksForSla = (items) => [...new Map(items.map((item) => data.tasks.find((task) => Number(task.id) === Number(item.task_id))).filter(Boolean).map((task) => [task.id, task])).values()];
  if (widget.widget_type === "sla_summary") {
    const values = ["on_track", "warning", "breached", "achieved"].map((status) => ({ status, items: sla.filter((item) => item.status === status) }));
    return <section className="surface dashboard-widget"><WidgetHead title={title} note={`${sla.length} таймеров SLA`} onClick={() => onDrilldown(title, tasksForSla(sla))}/><div className="sla-kpis">{values.map(({ status, items }) => <button className={status} key={status} disabled={!items.length} onClick={() => onDrilldown(`${title}: ${SLA_LABELS[status]}`, tasksForSla(items))}><strong>{tasksForSla(items).length}</strong><small>{SLA_LABELS[status]}</small></button>)}</div></section>;
  }
  if (widget.widget_type === "sla_risk") {
    const risk = sla.filter((item) => ["warning", "breached"].includes(item.status)).sort((a, b) => a.remaining_minutes - b.remaining_minutes);
    return <section className="surface dashboard-widget"><WidgetHead title={title} note={`${risk.length} требуют внимания`} onClick={() => onDrilldown(title, tasksForSla(risk))}/><div className="sla-risk-list">{risk.slice(0, 7).map((item) => { const task = data.tasks.find((entry) => entry.id === item.task_id); return task && <button key={`${item.task_id}-${item.policy_id}`} onClick={() => onOpen?.({ ...task })}><span><strong>{taskKey(task)} · {task.title}</strong><small>{item.policy_name}</small></span><b className={item.status}>{item.status === "breached" ? "−" : ""}{humanMinutes(item.remaining_minutes)}</b></button>; })}{!risk.length && <div className="empty-compact">Нарушений и рисков нет</div>}</div></section>;
  }
  if (["my_tasks", "overdue"].includes(widget.widget_type)) {
    const list = tasks.filter((task) => !task.is_done && (widget.widget_type === "my_tasks" ? Number(task.assignee_id) === Number(data.user.id) : task.due_date && task.due_date < today()));
    return <section className="surface dashboard-widget"><WidgetHead title={title} note={`${list.length} задач`} onClick={() => onDrilldown(title, list)}/><div className="task-list">{list.slice(0, 7).map((task) => <TaskLine key={task.id} task={task} onOpen={onOpen}/>)}</div>{!list.length && <div className="empty-compact">Нет задач для отображения</div>}</section>;
  }
  if (["status_distribution", "priority_distribution"].includes(widget.widget_type)) {
    const groups = widget.widget_type === "status_distribution" ? Object.entries(groupBy(tasks, (task) => task.stage_name)) : Object.entries(groupBy(tasks, (task) => task.priority));
    const max = Math.max(1, ...groups.map(([, list]) => list.length));
    return <section className="surface dashboard-widget"><WidgetHead title={title} note={`${tasks.length} задач`} onClick={() => onDrilldown(title, tasks)}/><div className="widget-bars">{groups.map(([key, list]) => <button key={key} onClick={() => onDrilldown(`${title}: ${widget.widget_type === "priority_distribution" ? PRIORITY[key] : key}`, list)}><span>{widget.widget_type === "priority_distribution" ? PRIORITY[key] : key}</span><i><b style={{ width: `${list.length / max * 100}%` }}/></i><strong>{list.length}</strong></button>)}</div></section>;
  }
  if (widget.widget_type === "project_progress") return <section className="surface dashboard-widget"><WidgetHead title={title} note={`${data.projects.length} проектов`} onClick={() => onDrilldown(title, tasks)}/><div className="widget-projects">{data.projects.slice(0, 8).map((project) => { const projectTasks = tasks.filter((task) => task.project_id === project.id); const done = projectTasks.filter((task) => task.is_done).length; return <button key={project.id} disabled={!projectTasks.length} onClick={() => onDrilldown(`${title}: ${project.name}`, projectTasks)}><span><i style={{ background: project.color }}/>{project.name}</span><Progress value={percent(done, projectTasks.length)} color={project.color}/><strong>{percent(done, projectTasks.length)}%</strong></button>; })}</div></section>;
  if (widget.widget_type === "workload") {
    const groups = Object.entries(groupBy(tasks.filter((task) => !task.is_done), (task) => task.assignee_name || "Не назначено")).sort((a, b) => b[1].length - a[1].length).slice(0, 7);
    const openTasks = tasks.filter((task) => !task.is_done);
    return <section className="surface dashboard-widget"><WidgetHead title={title} note="Открытые задачи" onClick={() => onDrilldown(title, openTasks)}/><div className="widget-bars">{groups.map(([name, list]) => <button key={name} onClick={() => onDrilldown(`${title}: ${name}`, list)}><span>{name}</span><i><b style={{ width: `${Math.min(100, list.length * 12)}%` }}/></i><strong>{list.length}</strong></button>)}</div></section>;
  }
  return <section className="surface dashboard-widget"><WidgetHead title={title} note="Недоступно"/><div className="empty-compact">Тип виджета больше не поддерживается — замените его в конструкторе</div></section>;
}

function WidgetHead({ title, note, onClick }) { return <div className="surface-head"><div><span className="overline">ВИДЖЕТ</span><h2>{title}</h2></div>{onClick ? <button className="widget-drilldown-trigger" onClick={onClick}>{note}<span aria-hidden="true">→</span></button> : <small>{note}</small>}</div>; }

function DashboardCanvas({ dashboard, data, onOpen, onFilterChange }) {
  const [personalFilter,setPersonalFilter]=useState(dashboard.layout?.filter||{});
  useEffect(()=>setPersonalFilter(dashboard.layout?.filter||{}),[dashboard.id,dashboard.revision]);
  const filter=onFilterChange?(dashboard.layout?.filter||{}):personalFilter;
  const filtered=filteredDashboardData(data,filter);
  const [drilldown, setDrilldown] = useState(null);
  const widgets = [...dashboard.widgets].sort((a, b) => Number(a.position?.y || 0) - Number(b.position?.y || 0) || Number(a.position?.x || 0) - Number(b.position?.x || 0));
  function openDrilldown(title, tasks) { if (tasks?.length) setDrilldown({ title, tasks: [...new Map(tasks.map((task) => [task.id, task])).values()] }); }
  return <><DashboardFilters data={data} value={filter} onChange={onFilterChange||setPersonalFilter}/><div className="personal-dashboard">{widgets.map((widget) => <div key={widget.id || `${widget.widget_type}-${widget.position?.y}`} style={{ gridColumn: `span ${Math.min(12, Math.max(3, Number(widget.position?.w || 6)))}` }}><DashboardWidget widget={widget} data={filtered} filter={filter} onOpen={onOpen} onDrilldown={openDrilldown}/></div>)}</div>{drilldown && <WidgetTaskDrawer title={drilldown.title} tasks={drilldown.tasks} onClose={() => setDrilldown(null)} onOpen={(task) => { setDrilldown(null); onOpen?.(task); }}/>}</>;
}

function WidgetTaskDrawer({ title, tasks, onClose, onOpen }) {
  useEffect(() => { const close = (event) => event.key === "Escape" && onClose(); window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close); }, [onClose]);
  return <div className="widget-drawer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><aside className="surface widget-task-drawer" role="dialog" aria-modal="true" aria-label={title}><header><div><span className="overline">ДЕТАЛИЗАЦИЯ ВИДЖЕТА</span><h2>{title}</h2><p>{tasks.length} {tasks.length % 10 === 1 && tasks.length % 100 !== 11 ? "задача" : [2, 3, 4].includes(tasks.length % 10) && ![12, 13, 14].includes(tasks.length % 100) ? "задачи" : "задач"}</p></div><button onClick={onClose} aria-label="Закрыть">×</button></header><div className="widget-drawer-list">{tasks.map((task) => <TaskLine key={task.id} task={task} onOpen={onOpen}/>)}</div></aside></div>;
}

export function DashboardStudio({ data, reload, notify, onOpen }) {
  const [busy,act]=useAction(notify);
  const normalize=item=>item?{...structuredClone(item),is_shared:Boolean(item.is_shared),is_template:Boolean(item.is_template)}:null;
  const [selectedId, setSelectedId] = useState(data.dashboards[0]?.id || null);
  const selected = data.dashboards.find((item) => item.id === selectedId) || data.dashboards[0];
  const [draft, setDraft] = useState(normalize(selected));
  const own = Number(selected?.owner_id) === Number(data.user.id);
  useEffect(() => { setDraft(normalize(selected)); }, [selected?.id, selected?.updated_at, selected?.revision]);
  async function create() {
    const widgets = [
      { widget_type: "sla_summary", title: "Контроль SLA", config: {}, position: { x: 0, y: 0, w: 4, h: 3 } },
      { widget_type: "my_tasks", title: "Мои задачи", config: {}, position: { x: 4, y: 0, w: 8, h: 3 } },
    ];
    try { const result = await request("/api/dashboards", { method: "POST", body: JSON.stringify({ name: "Мой дашборд", is_shared: false, layout: { columns: 12, rowHeight: 80 }, widgets }) }); await reload(); setSelectedId(result.id); notify("Дашборд создан"); } catch (error) { notify(error.message, "error"); }
  }
  async function copy() {try {const result=await request('/api/dashboards',{method:'POST',body:JSON.stringify({...draft,name:`${draft.name.slice(0,160)} — копия`,is_shared:false,share_group_id:null,is_template:false,revision:undefined})});await reload();setSelectedId(result.id);notify('Создана личная копия');}catch(error){notify(error.message,'error');}}
  async function save() { try { await request(`/api/dashboards/${draft.id}`, { method: "PUT", body: JSON.stringify(draft) }); await reload(); notify("Дашборд сохранён"); } catch (error) { notify(error.message, "error"); } }
  async function makeHome() { try { await request(`/api/dashboards/${selected.id}/home`, { method: "POST", body: "{}" }); await reload(); notify("Дашборд установлен главной страницей"); } catch (error) { notify(error.message, "error"); } }
  async function remove() { if (!confirm(`Удалить дашборд «${selected.name}»?`)) return; try { await request(`/api/dashboards/${selected.id}`, { method: "DELETE" }); setSelectedId(null); await reload(); notify("Дашборд удалён"); } catch (error) { notify(error.message, "error"); } }
  function addWidget(type) { const label = WIDGET_TYPES.find(([key]) => key === type)?.[1] || "Новый виджет"; setDraft((current) => ({ ...current, widgets: [...current.widgets, { widget_type: type, title: label, config: type === "formula" ? {expression:"done / total * 100",unit:"%"} : {}, position: { x: 0, y: current.widgets.length * 3, w: 6, h: 3 } }] })); }
  function updateWidget(index, patch) { setDraft((current) => ({ ...current, widgets: current.widgets.map((widget, itemIndex) => itemIndex === index ? { ...widget, ...patch } : widget) })); }
  function move(index, direction) { setDraft((current) => { const widgets = [...current.widgets]; const target = index + direction; if (target < 0 || target >= widgets.length) return current; [widgets[index], widgets[target]] = [widgets[target], widgets[index]]; return { ...current, widgets: widgets.map((widget, itemIndex) => ({ ...widget, position: { ...widget.position, y: itemIndex * 3 } })) }; }); }
  return <div className="view-page advanced-page"><PageTitle eyebrow="КОНСТРУКТОР" title="Мои дашборды" text="Соберите персональную главную страницу из показателей задач, проектов, команды и SLA." actions={<button className="primary" disabled={busy} onClick={()=>act(create)}>+ Новый дашборд</button>}/><div className="dashboard-tabs">{data.dashboards.map((item) => <button className={selected?.id === item.id ? "active" : ""} onClick={() => setSelectedId(item.id)} key={item.id}>{item.name}{item.is_template ? <small>Шаблон</small> : null}{item.id === data.homeDashboardId && <small>Главная</small>}</button>)}</div>{draft && <><div className="dashboard-toolbar"><label><span>Название</span><input disabled={!own} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })}/></label>{own && <DashboardSharing draft={draft} setDraft={setDraft} canShare={data.permissions.features["dashboard.share"]}/> }<button className="secondary" disabled={busy} onClick={()=>act(copy)}>Создать копию</button><DashboardSubscription dashboard={selected} notify={notify}/><button className="secondary" disabled={busy} onClick={()=>act(makeHome)}>Сделать главной</button>{own && <button className="danger" disabled={busy} onClick={()=>act(remove)}>Удалить</button>}{own && <button className="primary" disabled={busy} onClick={()=>act(save)}>Сохранить</button>}</div>{own && <div className="widget-palette"><strong>Добавить виджет</strong>{WIDGET_TYPES.map(([key, label]) => <button key={key} onClick={() => addWidget(key)}>+ {label}</button>)}</div>}<div className="dashboard-builder-layout">{own && <aside className="surface widget-editor-list"><h3>Структура</h3>{draft.widgets.map((widget, index) => <div key={`${widget.id || widget.widget_type}-${index}`}><input value={widget.title} onChange={(event) => updateWidget(index, { title: event.target.value })}/><select value={widget.config?.projectId || ""} onChange={(event) => updateWidget(index, { config: { ...widget.config, projectId: event.target.value ? Number(event.target.value) : null } })}><option value="">Все проекты</option>{data.projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>{widget.widget_type === "formula" && <FormulaEditor config={widget.config||{}} onChange={config=>updateWidget(index,{config})}/>}<select value={widget.position?.w || 6} onChange={(event) => updateWidget(index, { position: { ...widget.position, w: Number(event.target.value) } })}><option value="4">1/3 ширины</option><option value="6">1/2 ширины</option><option value="8">2/3 ширины</option><option value="12">Вся ширина</option></select><span><button onClick={() => move(index, -1)} disabled={!index}>↑</button><button onClick={() => move(index, 1)} disabled={index === draft.widgets.length - 1}>↓</button><button className="danger-text" onClick={() => setDraft((current) => ({ ...current, widgets: current.widgets.filter((_, itemIndex) => itemIndex !== index) }))}>Удалить</button></span></div>)}</aside>}<div className="dashboard-preview"><DashboardCanvas dashboard={draft} data={data} onOpen={onOpen} onFilterChange={own?filter=>setDraft({...draft,layout:{...draft.layout,filter}}):undefined}/></div></div></>}</div>;
}

export function BacklogView({ data, project, tasks, onOpen, reload, notify }) {
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ name: "Новый спринт", goal: "", start_date: today(), end_date: today(13) });
  const sprints = data.sprints.filter((item) => item.project_id === project.id && item.status !== "cancelled");
  const permissions = data.permissions.projects[String(project.id)] || {};
  const canManageSprints = permissions["sprint.manage"];
  const canEditTasks = permissions["task.edit"];
  async function create(event) { event.preventDefault(); try { await request("/api/sprints", { method: "POST", body: JSON.stringify({ ...draft, project_id: project.id }) }); setCreating(false); await reload(); notify("Спринт создан"); } catch (error) { notify(error.message, "error"); } }
  async function action(sprint, kind) { try { await request(`/api/sprints/${sprint.id}/${kind}`, { method: "POST", body: kind === "complete" ? JSON.stringify({ move_open_to_sprint_id: null }) : "{}" }); await reload(); notify(kind === "start" ? "Спринт запущен" : "Спринт завершён"); } catch (error) { notify(error.message, "error"); } }
  async function move(task, sprintId) { try { await request(`/api/tasks/${task.id}`, { method: "PATCH", body: JSON.stringify({ sprint_id: sprintId ? Number(sprintId) : null }) }); await reload(); notify("Задача перемещена"); } catch (error) { notify(error.message, "error"); } }
  const group = (sprintId) => tasks.filter((task) => Number(task.sprint_id || 0) === Number(sprintId || 0));
  return <div className="view-page advanced-page"><PageTitle eyebrow="AGILE" title="Бэклог и спринты" text={`${project.key_code} · планирование итераций и story points`} actions={canManageSprints && <button className="primary" onClick={() => setCreating(true)}>+ Создать спринт</button>}/>
    {creating && <form className="inline-create" onSubmit={create}><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} required/><input value={draft.goal} onChange={(event) => setDraft({ ...draft, goal: event.target.value })} placeholder="Цель спринта"/><input type="date" value={draft.start_date} onChange={(event) => setDraft({ ...draft, start_date: event.target.value })}/><input type="date" value={draft.end_date} onChange={(event) => setDraft({ ...draft, end_date: event.target.value })}/><button className="primary">Создать</button><button type="button" className="secondary" onClick={() => setCreating(false)}>Отмена</button></form>}
    <div className="sprint-stack">{sprints.map((sprint) => { const sprintTasks = group(sprint.id); const done = sprintTasks.filter((task) => task.is_done).length; return <section className={`sprint-box ${sprint.status}`} key={sprint.id}><div className="sprint-head"><div><span className={`status-pill ${sprint.status}`}>{SPRINT_STATUS[sprint.status]}</span><h2>{sprint.name}</h2><p>{sprint.goal || "Цель спринта не указана"}</p></div><div className="sprint-summary"><strong>{done}/{sprintTasks.length}</strong><span>{sprintTasks.reduce((sum, task) => sum + Number(task.story_points || 0), 0)} SP</span><small>{date(sprint.start_date)} — {date(sprint.end_date)}</small>{canManageSprints && sprint.status === "planned" && <button className="secondary" onClick={() => action(sprint, "start")}>Запустить</button>}{canManageSprints && sprint.status === "active" && <button className="primary" onClick={() => action(sprint, "complete")}>Завершить</button>}</div></div><Progress value={percent(done, sprintTasks.length)}/><div className="task-list">{sprintTasks.map((task) => <TaskLine key={task.id} task={task} onOpen={onOpen} action={canEditTasks && <select aria-label={`Спринт задачи ${taskKey(task)}`} value={task.sprint_id || ""} onChange={(event) => move(task, event.target.value)}><option value="">Бэклог</option>{sprints.filter((item) => item.status !== "completed").map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}/>)}</div>{!sprintTasks.length && <div className="empty-compact">В спринте пока нет задач</div>}</section>; })}
      <section className="sprint-box backlog"><div className="sprint-head"><div><span className="status-pill">ОЧЕРЕДЬ</span><h2>Бэклог</h2><p>Задачи, ещё не включённые в спринт</p></div><strong>{group(null).length} задач</strong></div><div className="task-list">{group(null).map((task) => <TaskLine key={task.id} task={task} onOpen={onOpen} action={canEditTasks && <select aria-label={`Спринт задачи ${taskKey(task)}`} value="" onChange={(event) => move(task, event.target.value)}><option value="">Выбрать спринт…</option>{sprints.filter((item) => item.status !== "completed").map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}/>)}</div></section>
    </div>
  </div>;
}

export function ReleasesView({ data, project, tasks, reload, notify }) {
  const [show, setShow] = useState(false);
  const [draft, setDraft] = useState({ name: "", description: "", start_date: today(), release_date: today(30) });
  const releases = data.releases.filter((item) => item.project_id === project.id);
  const canManage = data.permissions.projects[String(project.id)]?.["release.manage"];
  async function create(event) { event.preventDefault(); try { await request("/api/releases", { method: "POST", body: JSON.stringify({ ...draft, project_id: project.id }) }); setShow(false); await reload(); notify("Релиз создан"); } catch (error) { notify(error.message, "error"); } }
  async function publish(item) { if (!confirm(`Опубликовать релиз ${item.name}?`)) return; try { await request(`/api/releases/${item.id}/release`, { method: "POST", body: "{}" }); await reload(); notify("Релиз опубликован"); } catch (error) { notify(error.message, "error"); } }
  return <div className="view-page advanced-page"><PageTitle eyebrow="ПОСТАВКА" title="Релизы" text={`${project.name} · версии, готовность и состав поставки`} actions={canManage && <button className="primary" onClick={() => setShow(true)}>+ Новый релиз</button>}/>{show && <form className="inline-create" onSubmit={create}><input placeholder="Версия, например 2.0" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} required/><input placeholder="Описание" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })}/><input type="date" value={draft.start_date} onChange={(event) => setDraft({ ...draft, start_date: event.target.value })}/><input type="date" value={draft.release_date} onChange={(event) => setDraft({ ...draft, release_date: event.target.value })}/><button className="primary">Создать</button></form>}<div className="release-grid">{releases.map((item) => { const releaseTasks = tasks.filter((task) => task.release_id === item.id); const done = releaseTasks.filter((task) => task.is_done).length; return <article className="release-card" key={item.id}><div><span className={`status-pill ${item.status}`}>{item.status === "released" ? "ВЫПУЩЕН" : "ГОТОВИТСЯ"}</span><h2>{item.name}</h2><p>{item.description || "Описание релиза не заполнено"}</p></div><div className="release-date"><span>Дата релиза</span><strong>{date(item.release_date)}</strong></div><div><div className="release-progress"><span>Готовность</span><strong>{percent(done, releaseTasks.length)}%</strong></div><Progress value={percent(done, releaseTasks.length)} color={item.status === "released" ? "#2ea879" : project.color}/><small>{done} из {releaseTasks.length} задач</small></div>{canManage && item.status === "unreleased" && <button className="secondary wide" onClick={() => publish(item)}>Опубликовать релиз</button>}</article>; })}</div></div>;
}

export function SearchView({ data, onOpen, reload, notify }) {
  const [query, setQuery] = useState(data.savedFilters[0]?.query_text || "assignee = currentUser() AND resolution IS EMPTY ORDER BY priority ASC");
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [saveName, setSaveName] = useState("");
  async function run(event) { event?.preventDefault(); setBusy(true); try { const result = await request(`/api/search?q=${encodeURIComponent(query)}`); setResults(result.tasks); } catch (error) { notify(error.message, "error"); } finally { setBusy(false); } }
  async function applyFilter(filter) { setQuery(filter.query_text); setBusy(true); try { const result = await request(`/api/search?q=${encodeURIComponent(filter.query_text)}`); setResults(result.tasks); } catch (error) { notify(error.message, "error"); } finally { setBusy(false); } }
  async function save() { if (!saveName.trim()) return notify("Введите название фильтра", "error"); try { await request("/api/filters", { method: "POST", body: JSON.stringify({ name: saveName, query_text: query, is_favorite: true, is_shared: false }) }); setSaveName(""); await reload(); notify("Фильтр сохранён"); } catch (error) { notify(error.message, "error"); } }
  useEffect(() => { run(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return <div className="view-page advanced-page"><PageTitle eyebrow="ПОИСК" title="Задачи и фильтры" text="JQL-подобный язык запросов, сохранённые выборки и быстрые действия."/><div className="search-layout"><aside className="surface saved-filter-list"><h3>Сохранённые фильтры</h3>{data.savedFilters.map((filter) => <button key={filter.id} onClick={() => applyFilter(filter)}><strong>{filter.name}</strong><small>{filter.query_text}</small></button>)}{!data.savedFilters.length && <p>Фильтров пока нет</p>}</aside><section className="surface search-results"><form className="query-editor" onSubmit={run}><textarea value={query} onChange={(event) => setQuery(event.target.value)} rows="3"/><button className="primary" disabled={busy}>{busy ? "Ищем…" : "Выполнить"}</button></form><div className="query-help">Поля: project, status, assignee, priority, type, sprint, release, dueDate, storyPoints, resolution · операторы: =, !=, IN, ~, IS EMPTY, AND, OR, ORDER BY</div><div className="save-filter"><input value={saveName} onChange={(event) => setSaveName(event.target.value)} placeholder="Название фильтра"/><button className="secondary" onClick={save}>Сохранить запрос</button></div><div className="result-head"><strong>{results.length} задач</strong><span>по текущему запросу</span></div><div className="task-list">{results.map((task) => <TaskLine key={task.id} task={task} onOpen={onOpen}/>)}</div></section></div></div>;
}

export function KnowledgeView({ data, reload, notify }) {
  const [selected, setSelected] = useState(null);
  const [collaborationOpen, setCollaborationOpen] = useState(false);
  useEffect(() => { const articleId = Number(new URLSearchParams(window.location.search).get("article")); if (articleId) open(articleId); }, []);
  const [draft, setDraft] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  async function open(id) { try { setSelected(await request(`/api/knowledge/articles/${id}`)); } catch (error) { notify(error.message, "error"); } }
  const editableSpaces = data.knowledgeSpaces.filter((space) => space.can_edit);
  function startNew() { setDraft({ space_id: editableSpaces[0]?.id, title: "", slug: "", body: "", status: "published", blocks: [knowledgeBlock("paragraph")] }); }
  function startEdit() { if (selected) setDraft({ ...selected, blocks: markdownToBlocks(selected.body) }); }
  async function save(event) {
    event.preventDefault();
    const body = draft.body || blocksToMarkdown(draft.blocks);
    const payload = { version_number: draft.version_number, space_id: draft.space_id, parent_id: draft.parent_id || null, title: draft.title, slug: draft.slug, body, status: draft.status };
    try {
      const result = await request(draft.id ? `/api/knowledge/articles/${draft.id}` : "/api/knowledge/articles", { method: draft.id ? "PATCH" : "POST", body: JSON.stringify(payload) });
      const articleId = draft.id || result.id;
      setDraft(null);
      await reload();
      await open(articleId);
      notify(draft.id ? "Статья обновлена" : draft.status === "draft" ? "Черновик сохранён" : "Статья опубликована");
    } catch (error) { notify(error.message, "error"); }
  }
  const canManage = data.permissions.features?.["knowledge.manage"];
  const canConfigure = canManage || data.knowledgeSpaces.some((space) => space.can_admin) || data.knowledgeTeams.some((team) => team.can_manage);
  return <div className="view-page advanced-page"><PageTitle eyebrow="БАЗА ЗНАНИЙ" title="Пространства знаний" text="Отдельные базы документации для команд с собственными правами просмотра, редактирования и администрирования." actions={<div className="head-actions">{canConfigure && <button className="secondary" onClick={() => setSettingsOpen(true)}>Команды и доступ</button>}{Boolean(editableSpaces.length) && <button className="primary" onClick={startNew}>+ Новая статья</button>}</div>}/>{draft && <KnowledgeEditor draft={draft} setDraft={setDraft} spaces={editableSpaces} onSave={save} onClose={() => setDraft(null)}/>}<StaleArticleList onOpen={open}/><div className="knowledge-layout"><aside className="surface knowledge-tree">{data.knowledgeSpaces.map((space) => <div key={space.id}><header><span>{space.owner_team_color && <i style={{ background: space.owner_team_color }}/>}<strong>{space.name}</strong></span><small>{space.visibility === "workspace" ? "Всё пространство" : space.visibility === "public" ? "Публичное" : "Ограниченное"}</small></header>{space.owner_team_name && <div className="knowledge-space-team">Команда: {space.owner_team_name} · {space.access_level === "admin" ? "администратор" : space.access_level === "edit" ? "редактор" : "просмотр"}</div>}{data.knowledgeArticles.filter((article) => article.space_id === space.id).map((article) => <button className={selected?.id === article.id ? "active" : ""} key={article.id} onClick={() => open(article.id)}><span>{article.title}{article.status === "draft" && <i>Черновик</i>}</span><small>v{article.version_number}</small></button>)}{!data.knowledgeArticles.some((article) => article.space_id === space.id) && <div className="knowledge-space-empty">Статей пока нет</div>}</div>)}</aside><article className="surface article-view">{selected ? <><div className="article-view-head"><div><span className="overline">{selected.space_name} · ВЕРСИЯ {selected.version_number}</span><h1>{selected.title}</h1><div className="article-meta">Автор: {selected.author_name} · обновлено {date(selected.updated_at, true)}</div></div><div className="work-actions"><button className="secondary" onClick={() => setCollaborationOpen(true)}>Совместно и история</button>{selected.can_edit && <button className="secondary" onClick={startEdit}>Редактировать</button>}</div></div><MarkdownContent body={selected.body}/></> : <div className="article-placeholder"><strong>{data.knowledgeSpaces.length ? "Выберите статью" : "Нет доступных пространств"}</strong><span>{data.knowledgeSpaces.length ? "Содержание откроется здесь" : "Попросите администратора команды выдать доступ"}</span></div>}</article></div>{collaborationOpen && selected && <KnowledgeCollaboration articleId={selected.id} data={data} notify={notify} renderPreview={body=><MarkdownContent body={body}/>} onClose={() => { setCollaborationOpen(false); open(selected.id); reload(); }}/>} {settingsOpen && <KnowledgeSettings data={data} reload={reload} notify={notify} onClose={() => setSettingsOpen(false)}/>}</div>;
}

function KnowledgeSettings({ data, reload, notify, onClose }) {
  const canManageAll = data.permissions.features?.["knowledge.manage"];
  const [tab, setTab] = useState("spaces");
  const [teamDraft, setTeamDraft] = useState(null);
  const [spaceDraft, setSpaceDraft] = useState(null);
  const [permissionDraft, setPermissionDraft] = useState([]);
  const [busy, setBusy] = useState(false);
  function newTeam() { setTeamDraft({ name: "", slug: "", description: "", color: "#675EE7", member_ids: [data.user.id], lead_ids: [data.user.id] }); }
  function editTeam(team) {
    const members = data.knowledgeTeamMembers.filter((member) => Number(member.team_id) === Number(team.id));
    setTeamDraft({ ...team, member_ids: members.map((member) => member.user_id), lead_ids: members.filter((member) => member.team_role === "lead").map((member) => member.user_id) });
  }
  function setTeamRole(userId, role) {
    const value = Number(userId);
    setTeamDraft((current) => ({ ...current, member_ids: role === "none" ? current.member_ids.filter((idValue) => Number(idValue) !== value) : [...new Set([...current.member_ids.map(Number), value])], lead_ids: role === "lead" ? [...new Set([...current.lead_ids.map(Number), value])] : current.lead_ids.filter((idValue) => Number(idValue) !== value) }));
  }
  async function saveTeam(event) {
    event.preventDefault(); setBusy(true);
    try {
      await request(teamDraft.id ? `/api/knowledge/teams/${teamDraft.id}` : "/api/knowledge/teams", { method: teamDraft.id ? "PATCH" : "POST", body: JSON.stringify({ name: teamDraft.name, slug: teamDraft.slug, description: teamDraft.description, color: teamDraft.color, member_ids: teamDraft.member_ids.map(Number), lead_ids: teamDraft.lead_ids.map(Number) }) });
      setTeamDraft(null); await reload(); notify("Команда сохранена");
    } catch (error) { notify(error.message, "error"); } finally { setBusy(false); }
  }
  function newSpace() { setSpaceDraft({ name: "", slug: "", description: "", visibility: "restricted", owner_team_id: data.knowledgeTeams.find((team) => team.can_manage)?.id || null }); setPermissionDraft([]); }
  function editSpace(space) { setSpaceDraft({ ...space }); setPermissionDraft(data.knowledgeSpacePermissions.filter((permission) => Number(permission.space_id) === Number(space.id)).map(({ principal_type, principal_id, access_level }) => ({ principal_type, principal_id: Number(principal_id), access_level }))); }
  async function saveSpace(event) {
    event.preventDefault(); setBusy(true);
    try {
      const result = await request(spaceDraft.id ? `/api/knowledge/spaces/${spaceDraft.id}` : "/api/knowledge/spaces", { method: spaceDraft.id ? "PATCH" : "POST", body: JSON.stringify({ name: spaceDraft.name, ...(!spaceDraft.id ? { slug: spaceDraft.slug } : {}), description: spaceDraft.description, visibility: spaceDraft.visibility, owner_team_id: spaceDraft.owner_team_id ? Number(spaceDraft.owner_team_id) : null }) });
      const spaceId = spaceDraft.id || result.id;
      if (spaceDraft.id) await request(`/api/knowledge/spaces/${spaceId}/permissions`, { method: "PUT", body: JSON.stringify({ permissions: permissionDraft.map((permission) => ({ ...permission, principal_id: Number(permission.principal_id) })) }) });
      setSpaceDraft(null); setPermissionDraft([]); await reload(); notify("Пространство и права сохранены");
    } catch (error) { notify(error.message, "error"); } finally { setBusy(false); }
  }
  function addPermission() {
    const firstUser = data.users[0]?.id;
    if (!firstUser) return;
    setPermissionDraft((current) => [...current, { principal_type: "user", principal_id: firstUser, access_level: "view" }]);
  }
  function updatePermission(index, patch) { setPermissionDraft((current) => current.map((permission, itemIndex) => itemIndex === index ? { ...permission, ...patch } : permission)); }
  const canCreateSpace = canManageAll || data.knowledgeTeams.some((team) => team.can_manage);
  return <div className="knowledge-settings-overlay"><section className="surface knowledge-settings"><header><div><span className="overline">УПРАВЛЕНИЕ ДОСТУПОМ</span><h2>Команды и пространства</h2><p>Членство в команде и ACL пространства рассчитываются вместе с глобальными ролями.</p></div><button className="secondary" onClick={onClose}>Закрыть</button></header><nav><button className={tab === "spaces" ? "active" : ""} onClick={() => setTab("spaces")}>Пространства</button><button className={tab === "teams" ? "active" : ""} onClick={() => setTab("teams")}>Команды</button></nav>{tab === "teams" ? <div className="knowledge-settings-layout"><aside><div className="settings-list-head"><strong>Команды</strong>{canManageAll && <button onClick={newTeam}>+</button>}</div>{data.knowledgeTeams.map((team) => <button key={team.id} className={teamDraft?.id === team.id ? "active" : ""} onClick={() => team.can_manage && editTeam(team)} disabled={!team.can_manage}><i style={{ background: team.color }}/><span><strong>{team.name}</strong><small>{team.member_count} участников · {team.can_manage ? "можно управлять" : "просмотр"}</small></span></button>)}</aside><main>{teamDraft ? <form onSubmit={saveTeam} className="knowledge-access-form"><h3>{teamDraft.id ? "Настройка команды" : "Новая команда"}</h3><div className="knowledge-form-grid"><label><span>Название</span><input value={teamDraft.name} onChange={(event) => setTeamDraft({ ...teamDraft, name: event.target.value, slug: teamDraft.id ? teamDraft.slug : slugify(event.target.value) })} required/></label><label><span>Код</span><input value={teamDraft.slug} onChange={(event) => setTeamDraft({ ...teamDraft, slug: slugify(event.target.value) })} readOnly={Boolean(teamDraft.id)} required/></label><label className="span-2"><span>Описание</span><textarea value={teamDraft.description || ""} onChange={(event) => setTeamDraft({ ...teamDraft, description: event.target.value })}/></label><label><span>Цвет</span><input type="color" value={teamDraft.color} onChange={(event) => setTeamDraft({ ...teamDraft, color: event.target.value })}/></label></div><h4>Члены команды</h4><div className="knowledge-member-grid">{data.users.map((user) => { const role = teamDraft.lead_ids.some((idValue) => Number(idValue) === Number(user.id)) ? "lead" : teamDraft.member_ids.some((idValue) => Number(idValue) === Number(user.id)) ? "member" : "none"; return <label key={user.id}><span><i style={{ background: user.avatar_color }}>{user.display_name?.[0]}</i><b>{user.display_name}</b></span><select value={role} onChange={(event) => setTeamRole(user.id, event.target.value)}><option value="none">Нет доступа</option><option value="member">Участник</option><option value="lead">Руководитель</option></select></label>; })}</div><div className="editor-actions"><button type="button" className="secondary" onClick={() => setTeamDraft(null)}>Отмена</button><button className="primary" disabled={busy}>{busy ? "Сохраняем…" : "Сохранить команду"}</button></div></form> : <div className="article-placeholder"><strong>Выберите команду</strong><span>Настройте состав и руководителей</span></div>}</main></div> : <div className="knowledge-settings-layout"><aside><div className="settings-list-head"><strong>Пространства</strong>{canCreateSpace && <button onClick={newSpace}>+</button>}</div>{data.knowledgeSpaces.map((space) => <button key={space.id} className={spaceDraft?.id === space.id ? "active" : ""} onClick={() => space.can_admin && editSpace(space)} disabled={!space.can_admin}><i style={{ background: space.owner_team_color || "#9aa1aa" }}/><span><strong>{space.name}</strong><small>{space.owner_team_name || "Без команды"} · {space.can_admin ? "администратор" : space.access_level}</small></span></button>)}</aside><main>{spaceDraft ? <form onSubmit={saveSpace} className="knowledge-access-form"><h3>{spaceDraft.id ? "Настройка пространства" : "Новое пространство"}</h3><div className="knowledge-form-grid"><label><span>Название</span><input value={spaceDraft.name} onChange={(event) => setSpaceDraft({ ...spaceDraft, name: event.target.value, slug: spaceDraft.id ? spaceDraft.slug : slugify(event.target.value) })} required/></label>{!spaceDraft.id && <label><span>Код</span><input value={spaceDraft.slug} onChange={(event) => setSpaceDraft({ ...spaceDraft, slug: slugify(event.target.value) })} required/></label>}<label><span>Видимость</span><select value={spaceDraft.visibility} onChange={(event) => setSpaceDraft({ ...spaceDraft, visibility: event.target.value })}><option value="restricted">Только по правам</option><option value="private">Закрытое</option><option value="workspace">Всё рабочее пространство</option><option value="public">Публичное внутри портала</option></select></label><label><span>Команда-владелец</span><select value={spaceDraft.owner_team_id || ""} onChange={(event) => setSpaceDraft({ ...spaceDraft, owner_team_id: event.target.value ? Number(event.target.value) : null })}><option value="">Без команды</option>{data.knowledgeTeams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label><label className="span-2"><span>Описание</span><textarea value={spaceDraft.description || ""} onChange={(event) => setSpaceDraft({ ...spaceDraft, description: event.target.value })}/></label></div>{spaceDraft.id && <><div className="permission-editor-head"><div><h4>Права пространства</h4><small>Просмотр, редактирование или управление для пользователя либо всей команды.</small></div><button type="button" className="secondary" onClick={addPermission}>+ Правило</button></div><div className="knowledge-permission-list">{permissionDraft.map((permission, index) => <div key={`${permission.principal_type}-${permission.principal_id}-${index}`}><select value={permission.principal_type} onChange={(event) => { const type = event.target.value; updatePermission(index, { principal_type: type, principal_id: type === "team" ? data.knowledgeTeams[0]?.id : data.users[0]?.id }); }}><option value="user">Пользователь</option><option value="team">Команда</option></select><select value={permission.principal_id} onChange={(event) => updatePermission(index, { principal_id: Number(event.target.value) })}>{(permission.principal_type === "team" ? data.knowledgeTeams : data.users).map((principal) => <option key={principal.id} value={principal.id}>{principal.name || principal.display_name}</option>)}</select><select value={permission.access_level} onChange={(event) => updatePermission(index, { access_level: event.target.value })}><option value="view">Просмотр</option><option value="edit">Редактирование</option><option value="admin">Администрирование</option></select><button type="button" onClick={() => setPermissionDraft((current) => current.filter((_, itemIndex) => itemIndex !== index))}>×</button></div>)}{!permissionDraft.length && <div className="knowledge-space-empty">Отдельных правил нет. Действуют видимость пространства и права команды-владельца.</div>}</div></>}<div className="editor-actions"><button type="button" className="secondary" onClick={() => setSpaceDraft(null)}>Отмена</button><button className="primary" disabled={busy}>{busy ? "Сохраняем…" : "Сохранить пространство"}</button></div></form> : <div className="article-placeholder"><strong>Выберите пространство</strong><span>Настройте владельца, видимость и персональные права</span></div>}</main></div>}</section></div>;
}

const KNOWLEDGE_BLOCK_TYPES = [["paragraph", "Текст"], ["heading2", "Заголовок"], ["heading3", "Подзаголовок"], ["bullet", "Маркированный список"], ["numbered", "Нумерованный список"], ["quote", "Цитата"], ["code", "Код"], ["divider", "Разделитель"]];
function KnowledgeEditor({ draft, setDraft, spaces, onSave, onClose }) {
  const [mode, setMode] = useState("visual");
  function commit(blocks) { setDraft((current) => ({ ...current, blocks, body: blocksToMarkdown(blocks) })); }
  function update(index, patch) { commit(draft.blocks.map((block, itemIndex) => itemIndex === index ? { ...block, ...patch } : block)); }
  function add(type) { commit([...draft.blocks, knowledgeBlock(type)]); }
  function move(index, direction) { const blocks = [...draft.blocks]; const target = index + direction; if (target < 0 || target >= blocks.length) return; [blocks[index], blocks[target]] = [blocks[target], blocks[index]]; commit(blocks); }
  function remove(index) { const blocks = draft.blocks.filter((_, itemIndex) => itemIndex !== index); commit(blocks.length ? blocks : [knowledgeBlock("paragraph")]); }
  function changeMode(nextMode) { if (nextMode === "visual" && mode === "markdown") setDraft((current) => ({ ...current, blocks: markdownToBlocks(current.body) })); setMode(nextMode); }
  return <form className="knowledge-editor surface" onSubmit={onSave}><header><div><span className="overline">ВИЗУАЛЬНЫЙ РЕДАКТОР</span><h2>{draft.id ? "Редактирование статьи" : "Новая статья"}</h2></div><div><button type="button" className="secondary" onClick={onClose}>Закрыть</button><button className="primary">{draft.id ? "Сохранить" : draft.status === "draft" ? "Сохранить черновик" : "Опубликовать"}</button></div></header><div className="knowledge-editor-meta"><label><span>Раздел</span><select value={draft.space_id} disabled={Boolean(draft.id)} onChange={(event) => setDraft({ ...draft, space_id: Number(event.target.value) })}>{spaces.map((space) => <option value={space.id} key={space.id}>{space.name}</option>)}</select></label><label className="title-field"><span>Название</span><input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value, slug: draft.id ? draft.slug : slugify(event.target.value) })} placeholder="Название статьи" required/></label><label><span>Адрес</span><input value={draft.slug} readOnly={Boolean(draft.id)} onChange={(event) => setDraft({ ...draft, slug: slugify(event.target.value) })} placeholder="url-slug" required/></label><label><span>Статус</span><select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })}><option value="published">Опубликована</option><option value="draft">Черновик</option></select></label></div><div className="knowledge-editor-tabs"><button type="button" className={mode === "visual" ? "active" : ""} onClick={() => changeMode("visual")}>Визуально</button><button type="button" className={mode === "preview" ? "active" : ""} onClick={() => changeMode("preview")}>Предпросмотр</button><button type="button" className={mode === "markdown" ? "active" : ""} onClick={() => changeMode("markdown")}>Markdown</button></div>{mode === "visual" && <><div className="knowledge-block-toolbar"><strong>Добавить блок</strong>{KNOWLEDGE_BLOCK_TYPES.map(([type, label]) => <button type="button" key={type} onClick={() => add(type)}>+ {label}</button>)}</div><div className="knowledge-visual-layout"><div className="knowledge-block-list">{draft.blocks.map((block, index) => <div className="knowledge-block" key={block.id}><div className="knowledge-block-controls"><select value={block.type} onChange={(event) => update(index, { type: event.target.value })}>{KNOWLEDGE_BLOCK_TYPES.map(([type, label]) => <option key={type} value={type}>{label}</option>)}</select><span><button type="button" onClick={() => move(index, -1)} disabled={!index} aria-label="Переместить выше">↑</button><button type="button" onClick={() => move(index, 1)} disabled={index === draft.blocks.length - 1} aria-label="Переместить ниже">↓</button><button type="button" onClick={() => commit([...draft.blocks.slice(0, index + 1), { ...block, id: knowledgeBlock().id }, ...draft.blocks.slice(index + 1)])} aria-label="Дублировать">⧉</button><button type="button" className="danger-text" onClick={() => remove(index)} aria-label="Удалить">×</button></span></div>{block.type === "divider" ? <hr/> : <textarea className={block.type === "code" ? "code-block-input" : ""} rows={["bullet", "numbered", "code"].includes(block.type) ? 4 : block.type.startsWith("heading") ? 1 : 3} value={block.text} onChange={(event) => update(index, { text: event.target.value })} placeholder={block.type === "bullet" || block.type === "numbered" ? "Один пункт на строку" : block.type === "code" ? "Вставьте фрагмент кода" : "Начните печатать…"}/>}</div>)}</div><aside className="knowledge-live-preview"><span className="overline">ПРЕДПРОСМОТР</span><h1>{draft.title || "Название статьи"}</h1><MarkdownContent body={draft.body || blocksToMarkdown(draft.blocks)} className="article-body compact"/></aside></div></>}{mode === "preview" && <div className="knowledge-full-preview"><span className="overline">ПРЕДПРОСМОТР СТАТЬИ</span><h1>{draft.title || "Название статьи"}</h1><MarkdownContent body={draft.body || blocksToMarkdown(draft.blocks)}/></div>}{mode === "markdown" && <textarea className="knowledge-markdown-source" rows="18" value={draft.body} onChange={(event) => setDraft({ ...draft, body: event.target.value })} placeholder="Markdown статьи" required/>}</form>;
}

export function ReportsView({ project, notify }) {
  const [report, setReport] = useState(null);
  useEffect(() => { setReport(null); request(`/api/reports?projectId=${project.id}`).then(setReport).catch((error) => notify(error.message, "error")); }, [project.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!report) return <div className="view-page"><div className="loading-card">Формируем отчёты…</div></div>;
  const maxWork = Math.max(1, ...report.workload.map((item) => Number(item.story_points || item.task_count)));
  return <div className="view-page advanced-page"><PageTitle eyebrow="АНАЛИТИКА" title="Отчёты проекта" text={`${project.name} · распределение задач, загрузка и скорость поставки`}/><div className="report-grid"><section className="surface"><h2>Задачи по этапам</h2><div className="bar-list">{report.statusDistribution.map((item) => <div key={item.name}><span>{item.name}</span><Progress value={percent(item.value, report.statusDistribution.reduce((sum, row) => sum + Number(row.value), 0))} color={item.color}/><strong>{item.value}</strong></div>)}</div></section><section className="surface"><h2>Приоритеты</h2><div className="bar-list">{report.priorityDistribution.map((item) => <div key={item.name}><span>{PRIORITY[item.name]}</span><Progress value={percent(item.value, report.priorityDistribution.reduce((sum, row) => sum + Number(row.value), 0))}/><strong>{item.value}</strong></div>)}</div></section><section className="surface span-2"><h2>Загрузка команды</h2><div className="workload-list">{report.workload.filter((item) => item.task_count > 0).map((item) => <div key={item.id}><span><i style={{ background: item.avatar_color }}/>{item.name}</span><Progress value={(Number(item.story_points || item.task_count) / maxWork) * 100} color={item.avatar_color}/><strong>{item.story_points || item.task_count} {item.story_points ? "SP" : "задач"}</strong></div>)}</div></section><section className="surface"><h2>Прогресс спринтов</h2>{report.sprintProgress.map((item) => <div className="report-item" key={item.id}><span>{item.name}</span><strong>{percent(item.completed_points || item.completed, item.points || item.total)}%</strong><Progress value={percent(item.completed_points || item.completed, item.points || item.total)}/></div>)}</section><section className="surface"><h2>Готовность релизов</h2>{report.releaseProgress.map((item) => <div className="report-item" key={item.id}><span>{item.name}</span><strong>{percent(item.completed, item.total)}%</strong><Progress value={percent(item.completed, item.total)} color={item.status === "released" ? "#2ea879" : "#675ee7"}/></div>)}</section></div></div>;
}

export function AutomationAdmin({ data, reload, notify }) {
  const rules = data.administration?.automationRules || [];
  const [draft, setDraft] = useState(null);
  async function toggle(rule) { try { await request(`/api/admin/automation/${rule.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !rule.enabled }) }); await reload(); notify("Правило обновлено"); } catch (error) { notify(error.message, "error"); } }
  async function create(event) { event.preventDefault(); try { await request("/api/admin/automation", { method: "POST", body: JSON.stringify({ project_id: draft.project_id || null, name: draft.name, description: draft.description, enabled: true, trigger_type: draft.trigger_type, trigger_config: {}, conditions: [], actions: [{ type: "notify_assignee", title: draft.notification_title, body: "Автоматическое уведомление по задаче" }] }) }); setDraft(null); await reload(); notify("Правило автоматизации создано"); } catch (error) { notify(error.message, "error"); } }
  return <><PageTitle eyebrow="NO-CODE" title="Автоматизация" text="Триггеры, условия и действия выполняются фоновым worker через очередь Redis." actions={<button className="primary" onClick={() => setDraft({ name: "", description: "", project_id: null, trigger_type: "task.updated", notification_title: "Задача обновлена" })}>+ Новое правило</button>}/>{draft && <form className="admin-inline-form" onSubmit={create}><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Название правила" required/><select value={draft.project_id || ""} onChange={(event) => setDraft({ ...draft, project_id: event.target.value ? Number(event.target.value) : null })}><option value="">Все проекты</option>{data.projects.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select><select value={draft.trigger_type} onChange={(event) => setDraft({ ...draft, trigger_type: event.target.value })}><option value="task.created">Задача создана</option><option value="task.updated">Задача изменена</option><option value="task.due_soon">Приближается срок</option><option value="comment.created">Добавлен комментарий</option></select><input value={draft.notification_title} onChange={(event) => setDraft({ ...draft, notification_title: event.target.value })} placeholder="Тема уведомления"/><button className="primary">Создать</button></form>}<div className="automation-list">{rules.map((rule) => <div key={rule.id}><label className="toggle compact"><input type="checkbox" checked={Boolean(rule.enabled)} onChange={() => toggle(rule)}/><i/></label><span><strong>{rule.name}</strong><small>{rule.description || "Без описания"}</small></span><code>{rule.trigger_type}</code><span>{rule.actions.length} действий</span><small>Запусков: {rule.run_count}</small></div>)}</div></>;
}

function endpointCurl(endpoint, origin, token) {
  const tokenValue = token || "$KONTUR_TOKEN";
  const setup = endpoint.auth === "session" ? 'KONTUR_SESSION="СЕССИЯ_ПОСЛЕ_ВХОДА"\n\n' : token ? "" : 'KONTUR_TOKEN="ВСТАВЬТЕ_ПОЛНЫЙ_ТОКЕН"\n\n';
  const sampleIds = { taskId: 42, projectId: 1, channelId: 1, conferenceId: 1, messageId: 1, userId: 2, callId: 1, sessionId: "dad3c9e6-dfa3-45cd-9473-a591623b659c", blockId: "dad3c9e6-dfa3-45cd-9473-a591623b659c", teamId: 1, spaceId: 1, joinCode: "04bb661f-5fc8-42e8-89cd-c84d9e39da42" };
  const path = endpoint.path.replace(/\{([^}]+)\}/g, (_, key) => sampleIds[key] || 1);
  const argumentsList = [`curl --request ${endpoint.method}`, `--url "${origin}${path}"`, endpoint.auth === "session" ? '--cookie "kontur_session=$KONTUR_SESSION"' : `--header "Authorization: Bearer ${tokenValue}"`];
  if (endpoint.query?.length) {
    argumentsList.push("--get");
    for (const query of endpoint.query.filter((item) => item.example != null)) argumentsList.push(`--data-urlencode "${query.name}=${query.example}"`);
  }
  if (endpoint.body) {
    argumentsList.push(`--header "Content-Type: ${endpoint.body.contentType}"`, endpoint.body.binary ? '--data-binary "@file.bin"' : `--data '${JSON.stringify(endpoint.body.example).replaceAll("'", "'\\''")}'`);
  }
  return `${setup}${argumentsList.map((value, index) => index ? `  ${value}` : value).join(" \\\n")}`;
}

function ApiDocumentation({ issued, notify }) {
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState("Все");
  const [expanded, setExpanded] = useState("GET /api/search");
  const [origin, setOrigin] = useState("https://projects.company.ru");
  useEffect(() => setOrigin(window.location.origin), []);
  const tags = ["Все", ...new Set(API_ENDPOINTS.map((endpoint) => endpoint.tag))];
  const normalized = query.trim().toLowerCase();
  const endpoints = API_ENDPOINTS.filter((endpoint) => (tag === "Все" || endpoint.tag === tag) && (!normalized || `${endpoint.method} ${endpoint.path} ${endpoint.title} ${endpoint.description} ${endpoint.scope}`.toLowerCase().includes(normalized)));
  const quickStart = endpointCurl(API_ENDPOINTS.find(e => e.path === "/api/search"), origin, issued);
  async function copy(value, message = "Пример скопирован") {
    try {
      await navigator.clipboard.writeText(value);
      notify(message);
    } catch {
      notify("Не удалось скопировать — выделите текст вручную", "error");
    }
  }
  return <section className="api-docs">
    <div className="surface api-quickstart">
      <div className="surface-head"><div><span className="overline">БЫСТРЫЙ СТАРТ</span><h2>Первый запрос без неоднозначного токена</h2></div><button className="secondary" onClick={() => copy(quickStart)}>Копировать</button></div>
      {!issued && <p>Значение <code>ВСТАВЬТЕ_ПОЛНЫЙ_ТОКЕН</code> нужно заменить целиком. Сокращённый префикс из таблицы для авторизации не подходит.</p>}
      {issued && <p>В примере ниже уже подставлен токен, выпущенный в этой сессии. Сохраните его в менеджере секретов.</p>}
      <pre><code>{quickStart}</code></pre>
    </div>
    <div className="api-doc-head">
      <div><span className="overline">OPENAPI 3.1</span><h2>Документация методов</h2><p>{API_ENDPOINTS.length} методов для задач, проектов и коммуникаций.</p></div>
      <a className="secondary button-link" href="/api/openapi.json" target="_blank" rel="noreferrer">Открыть OpenAPI JSON ↗</a>
    </div>
    <div className="api-doc-tools">
      <label className="api-doc-search"><span>Поиск метода</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Например, конференция или telephony:write"/></label>
      <div className="api-tag-filter" aria-label="Разделы API">{tags.map((item) => <button key={item} className={tag === item ? "active" : ""} onClick={() => setTag(item)}>{item}</button>)}</div>
    </div>
    <div className="api-endpoint-list">{endpoints.map((endpoint) => {
      const key = `${endpoint.method} ${endpoint.path}`;
      const open = expanded === key;
      const curl = endpointCurl(endpoint, origin, issued);
      return <article className={`surface api-endpoint ${open ? "open" : ""}`} key={key}>
        <button className="api-endpoint-toggle" onClick={() => setExpanded(open ? "" : key)} aria-expanded={open}>
          <b className={`http-method ${endpoint.method.toLowerCase()}`}>{endpoint.method}</b><code>{endpoint.path}</code><span>{endpoint.title}</span><small>{endpoint.scope}</small><i>⌄</i>
        </button>
        {open && <div className="api-endpoint-body">
          <p>{endpoint.description}</p>
          <div className="api-requirements"><span>Scope <code>{endpoint.scope}</code></span>{endpoint.permission && <span>Разрешение <code>{endpoint.permission}</code></span>}</div>
          {endpoint.query?.length > 0 && <div className="api-parameters"><strong>Query-параметры</strong>{endpoint.query.map((item) => <span key={item.name}><code>{item.name}</code>{item.required ? "обязательный" : "необязательный"}{item.example != null && <small>{item.example}</small>}</span>)}</div>}
          <div className="api-code-head"><strong>cURL</strong><button className="text-button" onClick={() => copy(curl)}>Копировать</button></div><pre><code>{curl}</code></pre>
        </div>}
      </article>;
    })}{!endpoints.length && <div className="surface api-empty">Методы по этому запросу не найдены.</div>}</div>
  </section>;
}

export function ApiTokensView({ data, reload, notify }) {
  const [draft, setDraft] = useState(null);
  const [issued, setIssued] = useState("");
  const policy = data.api.access;
  async function issue(event) {
    event.preventDefault();
    try {
      const result = await request("/api/tokens", { method: "POST", body: JSON.stringify({ ...draft, expires_at: draft.expires_at ? new Date(`${draft.expires_at}T23:59:59Z`).toISOString() : null }) });
      setIssued(result.token);
      setDraft(null);
      await reload();
      notify("Токен выпущен");
    } catch (error) { notify(error.message, "error"); }
  }
  async function revoke(token) {
    if (!confirm(`Отозвать токен «${token.name}»?`)) return;
    try { await request(`/api/tokens/${token.id}`, { method: "DELETE" }); await reload(); notify("Токен отозван"); }
    catch (error) { notify(error.message, "error"); }
  }
  function toggle(scope) { setDraft((current) => ({ ...current, scopes: current.scopes.includes(scope) ? current.scopes.filter((item) => item !== scope) : [...current.scopes, scope] })); }
  async function copyToken() {
    try { await navigator.clipboard.writeText(issued); notify("Токен скопирован"); }
    catch { notify("Не удалось скопировать токен", "error"); }
  }
  return <div className="view-page advanced-page api-page">
    <PageTitle eyebrow="ПЕРСОНАЛЬНЫЙ ДОСТУП" title="Мой API" text="Выпускайте токены с минимальными scope. Обычные роли и разрешения проекта продолжают действовать для каждого API-запроса." actions={<button className="primary" disabled={!policy.enabled} onClick={() => setDraft({ name: "", scopes: policy.allowed_scopes.filter((scope) => scope.endsWith(":read")), expires_at: today(Math.min(Number(policy.max_token_ttl_days), 90)) })}>+ Создать токен</button>}/>
    {!policy.enabled && <div className="info-box api-disabled"><span>API-доступ отключён администратором. Существующие токены не смогут выполнять запросы.</span></div>}
    {issued && <div className="secret-once token-reveal"><span><strong>Скопируйте токен сейчас</strong><small>Повторно полный токен не показывается</small></span><code>{issued}</code><button onClick={copyToken}>Копировать</button></div>}
    {draft && <form className="surface token-editor" onSubmit={issue}><label><span>Название токена</span><input autoFocus value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Например, интеграция BI" required/></label><label><span>Действует до</span><input type="date" min={today(1)} max={today(Number(policy.max_token_ttl_days))} value={draft.expires_at} onChange={(event) => setDraft({ ...draft, expires_at: event.target.value })} required/></label><div className="scope-grid">{data.api.scopeCatalog.filter((scope) => policy.allowed_scopes.includes(scope.key)).map((scope) => <label key={scope.key}><input type="checkbox" checked={draft.scopes.includes(scope.key)} onChange={() => toggle(scope.key)}/><span><strong>{scope.name}</strong><small>{scope.key} · {scope.mode}</small></span></label>)}</div><div className="editor-actions"><button type="button" className="secondary" onClick={() => setDraft(null)}>Отмена</button><button className="primary" disabled={!draft.scopes.length}>Выпустить токен</button></div></form>}
    <div className="surface token-table"><div className="table-row table-head"><span>Токен</span><span>Разрешения</span><span>Последнее использование</span><span>Состояние</span><span/></div>{data.api.tokens.map((token) => <div className="table-row" key={token.id}><span><strong>{token.name}</strong><small>{token.token_prefix}… · создан {date(token.created_at)}</small></span><span><small>{token.scopes.join(", ")}</small></span><span>{date(token.last_used_at, true)}</span><span className={`status-pill ${token.revoked_at ? "" : "active"}`}>{token.revoked_at ? "Отозван" : token.expires_at && new Date(token.expires_at) < new Date() ? "Истёк" : "Активен"}</span><span>{!token.revoked_at && <button className="text-button danger-text" onClick={() => revoke(token)}>Отозвать</button>}</span></div>)}</div>
    <ApiDocumentation issued={issued} notify={notify}/>
  </div>;
}

export function SlaAdmin({ data, reload, notify }) {
  const calendars=useWork("sla/calendars");
  const policies = data.administration?.taskSlaPolicies || [];
  const [draft, setDraft] = useState(null);
  const fields = [["priority", "Приоритет"], ["issue_type_code", "Тип задачи"], ["project_id", "Проект"], ["status_category", "Категория этапа"], ["assignee_id", "Исполнитель"], ["component_id", "Компонент"], ["story_points", "Story points"], ...data.fields.map((field) => [`custom.${field.code}`, field.label])];
  function edit(policy = null) { setDraft(policy ? structuredClone(policy) : { name: "", description: "", project_id: null, goal_minutes: 1440, warning_percent: 80, conditions: [{ field: "priority", operator: "equals", value: "high" }], enabled: true, position: (policies.at(-1)?.position || 0) + 100 }); }
  function condition(index, patch) { setDraft((current) => ({ ...current, conditions: current.conditions.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) })); }
  async function save(event) { event.preventDefault(); try { await request(draft.id ? `/api/admin/task-sla/${draft.id}` : "/api/admin/task-sla", { method: draft.id ? "PATCH" : "POST", body: JSON.stringify(draft) }); setDraft(null); await reload(); notify("Правило SLA сохранено"); } catch (error) { notify(error.message, "error"); } }
  async function remove(policy) { if (!confirm(`Удалить правило «${policy.name}»?`)) return; try { await request(`/api/admin/task-sla/${policy.id}`, { method: "DELETE" }); await reload(); notify("Правило SLA удалено"); } catch (error) { notify(error.message, "error"); } }
  return <><PageTitle eyebrow="УПРАВЛЕНИЕ УРОВНЕМ СЕРВИСА" title="SLA задач" text="Первое совпадение выбирается отдельно для каждого таймера. Учитываются календарь, паузы и повторное открытие." actions={<button className="primary" onClick={() => edit()}>+ Новое правило</button>}/><SlaCalendars notify={notify} onChange={()=>{calendars.reload();reload();}}/>{draft && <form className="surface sla-editor" onSubmit={save}><div className="sla-main-fields"><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Название правила" required/><select value={draft.project_id || ""} onChange={(event) => setDraft({ ...draft, project_id: event.target.value ? Number(event.target.value) : null })}><option value="">Все проекты</option>{data.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select><input type="number" min="1" value={draft.goal_minutes} onChange={(event) => setDraft({ ...draft, goal_minutes: Number(event.target.value) })} title="Цель, минуты"/><input type="number" min="1" max="99" value={draft.warning_percent} onChange={(event) => setDraft({ ...draft, warning_percent: Number(event.target.value) })} title="Предупреждение, %"/><textarea value={draft.description || ""} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="Описание и назначение правила"/></div><SlaConfig draft={draft} setDraft={setDraft} data={data} calendars={calendars.value||[]}/><h3>Все условия должны совпасть</h3><div className="sla-condition-list">{draft.conditions.map((item, index) => <div key={index}><select value={item.field} onChange={(event) => condition(index, { field: event.target.value, value: "" })}>{fields.map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select><select value={item.operator} onChange={(event) => condition(index, { operator: event.target.value })}><option value="equals">равно</option><option value="not_equals">не равно</option><option value="contains">содержит</option><option value="in">одно из</option><option value="gte">не меньше</option><option value="lte">не больше</option></select><input value={item.value ?? ""} onChange={(event) => condition(index, { value: event.target.value })} placeholder="Значение"/><button type="button" onClick={() => setDraft((current) => ({ ...current, conditions: current.conditions.filter((_, itemIndex) => itemIndex !== index) }))}>×</button></div>)}</div><button type="button" className="add-row" onClick={() => setDraft((current) => ({ ...current, conditions: [...current.conditions, { field: "priority", operator: "equals", value: "" }] }))}>+ Добавить условие</button><div className="editor-actions"><label className="toggle compact"><input type="checkbox" checked={Boolean(draft.enabled)} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}/><i/><span>Правило включено</span></label><button type="button" className="secondary" onClick={() => setDraft(null)}>Отмена</button><button className="primary">Сохранить</button></div></form>}{draft?.id&&<SlaNotifications key={draft.id} policyId={draft.id} data={data} notify={notify}/>}<div className="sla-policy-list">{policies.map((policy) => <article className="surface" key={policy.id}><div><span className={`status-pill ${policy.enabled ? "active" : ""}`}>{policy.enabled ? "ВКЛЮЧЕНО" : "ВЫКЛЮЧЕНО"}</span><strong>{policy.name}</strong><small>{policy.description || "Без описания"}</small></div><div><strong>{humanMinutes(policy.goal_minutes)}</strong><small>предупреждение с {policy.warning_percent}%</small></div><div><strong>{policy.conditions.length || "Все"}</strong><small>{policy.conditions.length ? "условий" : "задачи"} · приоритет {policy.position}</small></div><span><button className="secondary" onClick={() => edit(policy)}>Изменить</button><button className="text-button danger-text" onClick={() => remove(policy)}>Удалить</button></span></article>)}</div></>;
}

export function ApiAccessAdmin({ data, reload, notify }) {
  const [drafts, setDrafts] = useState(() => Object.fromEntries((data.administration?.apiAccessPolicies || []).map((policy) => [policy.user_id, { enabled: Boolean(policy.enabled), allowed_scopes: policy.allowed_scopes, max_token_ttl_days: policy.max_token_ttl_days }])));
  useEffect(() => setDrafts(Object.fromEntries((data.administration?.apiAccessPolicies || []).map((policy) => [policy.user_id, { enabled: Boolean(policy.enabled), allowed_scopes: policy.allowed_scopes, max_token_ttl_days: policy.max_token_ttl_days }]))), [data.administration?.apiAccessPolicies]);
  function change(userId, patch) { setDrafts((current) => ({ ...current, [userId]: { ...current[userId], ...patch } })); }
  function toggle(userId, scope) { const current = drafts[userId]; change(userId, { allowed_scopes: current.allowed_scopes.includes(scope) ? current.allowed_scopes.filter((item) => item !== scope) : [...current.allowed_scopes, scope] }); }
  async function save(userId) { try { await request(`/api/admin/api-access/${userId}`, { method: "PATCH", body: JSON.stringify(drafts[userId]) }); await reload(); notify("Политика API сохранена"); } catch (error) { notify(error.message, "error"); } }
  const policies = data.administration?.apiAccessPolicies || [];
  return <><PageTitle eyebrow="БЕЗОПАСНОСТЬ API" title="Доступ пользователей к API" text="Разрешайте API отдельно для каждого пользователя, задавайте набор операций и максимальный срок действия токенов."/><div className="api-policy-list">{policies.map((policy) => { const draft = drafts[policy.user_id] || { enabled: false, allowed_scopes: [], max_token_ttl_days: 365 }; return <article className="surface" key={policy.user_id}><div className="api-policy-head"><span><strong>{policy.display_name}</strong><small>{policy.email} · активных токенов: {policy.active_tokens}</small></span><label className="toggle compact"><input type="checkbox" checked={draft.enabled} onChange={(event) => change(policy.user_id, { enabled: event.target.checked })}/><i/><span>API разрешён</span></label><label><span>Максимальный срок, дней</span><input type="number" min="1" max="3650" value={draft.max_token_ttl_days} onChange={(event) => change(policy.user_id, { max_token_ttl_days: Number(event.target.value) })}/></label><button className="primary" onClick={() => save(policy.user_id)}>Сохранить</button></div><div className="scope-grid compact-scopes">{data.api.scopeCatalog.map((scope) => <label key={scope.key}><input type="checkbox" checked={draft.allowed_scopes.includes(scope.key)} onChange={() => toggle(policy.user_id, scope.key)}/><span><strong>{scope.name}</strong><small>{scope.key}</small></span></label>)}</div></article>; })}</div></>;
}

export function IntegrationsAdmin({ data, reload, notify }) {
  const admin = data.administration || {};
  const [webhook, setWebhook] = useState(null);
  const [token, setToken] = useState(null);
  const [issued, setIssued] = useState("");
  async function addHook(event) { event.preventDefault(); try { await request("/api/admin/webhooks", { method: "POST", body: JSON.stringify({ ...webhook, event_types: webhook.event_types.split(",").map((item) => item.trim()).filter(Boolean), enabled: true }) }); setWebhook(null); await reload(); notify("Webhook создан"); } catch (error) { notify(error.message, "error"); } }
  async function addToken(event) { event.preventDefault(); try { const result = await request("/api/admin/api-tokens", { method: "POST", body: JSON.stringify({ name: token.name, scopes: token.scopes.split(",").map((item) => item.trim()), expires_at: token.expires_at ? new Date(`${token.expires_at}T23:59:59Z`).toISOString() : null }) }); setIssued(result.token); setToken(null); await reload(); } catch (error) { notify(error.message, "error"); } }
  async function revoke(id) { try { await request(`/api/admin/api-tokens/${id}`, { method: "DELETE" }); await reload(); notify("Токен отозван"); } catch (error) { notify(error.message, "error"); } }
  return <><PageTitle eyebrow="API И СОБЫТИЯ" title="Интеграции" text="Webhook-подписки и подключения к внешним системам. Личные токены выпускаются в разделе «Мой API»." actions={<><button className="secondary" onClick={() => setWebhook({ name: "", target_url: "", secret: "", event_types: "task.created, task.updated" })}>+ Webhook</button><button className="primary" onClick={() => setToken({ name: "", scopes: "workspace:read,tasks:read", expires_at: today(90) })}>+ Мой API-токен</button></>}/>{issued && <div className="secret-once"><strong>Скопируйте токен сейчас — повторно он не показывается</strong><code>{issued}</code><button onClick={() => navigator.clipboard?.writeText(issued)}>Копировать</button></div>}{webhook && <form className="admin-inline-form" onSubmit={addHook}><input value={webhook.name} onChange={(event) => setWebhook({ ...webhook, name: event.target.value })} placeholder="Название" required/><input type="url" value={webhook.target_url} onChange={(event) => setWebhook({ ...webhook, target_url: event.target.value })} placeholder="https://…" required/><input value={webhook.event_types} onChange={(event) => setWebhook({ ...webhook, event_types: event.target.value })}/><input type="password" value={webhook.secret} onChange={(event) => setWebhook({ ...webhook, secret: event.target.value })} placeholder="Секрет подписи"/><button className="primary">Создать</button></form>}{token && <form className="admin-inline-form" onSubmit={addToken}><input value={token.name} onChange={(event) => setToken({ ...token, name: event.target.value })} placeholder="Название токена" required/><input value={token.scopes} onChange={(event) => setToken({ ...token, scopes: event.target.value })}/><input type="date" value={token.expires_at} onChange={(event) => setToken({ ...token, expires_at: event.target.value })}/><button className="primary">Выпустить</button></form>}<div className="integration-grid"><section><h3>Webhooks</h3>{(admin.webhooks || []).map((hook) => <div className="integration-row" key={hook.id}><span><strong>{hook.name}</strong><small>{hook.target_url}</small></span><code>{hook.last_status || "—"}</code></div>)}</section><section><h3>API-токены администратора</h3>{(admin.apiTokens || []).map((item) => <div className="integration-row" key={item.id}><span><strong>{item.name}</strong><small>{item.token_prefix}… · {item.scopes.join(", ")}</small></span>{!item.revoked_at && <button className="text-button danger-text" onClick={() => revoke(item.id)}>Отозвать</button>}</div>)}</section></div></>;
}

export function PermissionsAdmin({ data, reload, notify }) {
  const admin = data.administration || {};
  const groups = admin.accessGroups || [];
  const roles = admin.accessRoles || [];
  const catalog = admin.permissionCatalog || [];
  const canManageGroups = data.permissions.features?.["group.manage"];
  const canManageRoles = data.permissions.features?.["role.manage"];
  const [section, setSection] = useState(canManageGroups ? "groups" : "roles");
  const [memberSearch, setMemberSearch] = useState("");
  const [groupDraft, setGroupDraft] = useState(null);
  const [roleDraft, setRoleDraft] = useState(null);
  const [assignmentDraft, setAssignmentDraft] = useState({ principal_type: "group", principal_id: "", scope_type: "project", scope_id: "", expires_at: "" });

  function groupForm(group = null) {
    setMemberSearch("");
    setGroupDraft(group ? { code: group.code, name: group.name, description: group.description || "", parent_group_id: group.parent_group_id || null, source: group.source, external_key: group.external_key || "", active: Boolean(group.active), id: group.id, members: group.members.map((member) => member.user_id) } : { code: "", name: "", description: "", parent_group_id: null, source: "local", external_key: "", members: [] });
  }
  async function saveGroup(event) {
    event.preventDefault();
    try {
      await request(groupDraft.id ? `/api/admin/access-groups/${groupDraft.id}` : "/api/admin/access-groups", { method: groupDraft.id ? "PATCH" : "POST", body: JSON.stringify(groupDraft) });
      setGroupDraft(null); await reload(); notify("Группа доступа сохранена");
    } catch (error) { notify(error.message, "error"); }
  }
  async function deleteGroup(group) {
    if (!confirm(`Удалить группу «${group.name}» и её назначения?`)) return;
    try { await request(`/api/admin/access-groups/${group.id}`, { method: "DELETE" }); await reload(); notify("Группа удалена"); } catch (error) { notify(error.message, "error"); }
  }

  function roleForm(role = null) {
    setRoleDraft(role ? { id: role.id, code: role.code, name: role.name, description: role.description || "", scope: role.scope, active: Boolean(role.active), permissions: role.permissions.map((permission) => ({ permission_key: permission.permission_key, effect: permission.effect })), assignments: role.assignments.map((assignment) => ({ principal_type: assignment.principal_type, principal_id: assignment.principal_id, scope_type: assignment.scope_type, scope_id: assignment.scope_id, valid_from: isoDateTime(assignment.valid_from), expires_at: isoDateTime(assignment.expires_at) })) } : { code: "", name: "", description: "", scope: "project", active: true, permissions: [], assignments: [] });
    setAssignmentDraft({ principal_type: "group", principal_id: "", scope_type: "project", scope_id: "", expires_at: "" });
  }
  function togglePermission(permissionKey, checked) {
    setRoleDraft((current) => ({ ...current, permissions: checked ? [...current.permissions, { permission_key: permissionKey, effect: "allow" }] : current.permissions.filter((permission) => permission.permission_key !== permissionKey) }));
  }
  function permissionEffect(permissionKey, effect) {
    setRoleDraft((current) => ({ ...current, permissions: current.permissions.map((permission) => permission.permission_key === permissionKey ? { ...permission, effect } : permission) }));
  }
  function addAssignment() {
    if (!assignmentDraft.principal_id) return notify("Выберите пользователя или группу", "error");
    const scopeId = assignmentDraft.scope_type === "workspace" ? 0 : Number(assignmentDraft.scope_id);
    if (assignmentDraft.scope_type !== "workspace" && !scopeId) return notify("Выберите область назначения", "error");
    setRoleDraft((current) => ({ ...current, assignments: [...current.assignments, { ...assignmentDraft, principal_id: Number(assignmentDraft.principal_id), scope_id: scopeId, valid_from: null, expires_at: assignmentDraft.expires_at ? new Date(assignmentDraft.expires_at).toISOString() : null }] }));
    setAssignmentDraft({ principal_type: "group", principal_id: "", scope_type: roleDraft.scope === "workspace" ? "workspace" : "project", scope_id: "", expires_at: "" });
  }
  async function saveRole(event) {
    event.preventDefault();
    try {
      await request(roleDraft.id ? `/api/admin/access-roles/${roleDraft.id}` : "/api/admin/access-roles", { method: roleDraft.id ? "PATCH" : "POST", body: JSON.stringify(roleDraft) });
      setRoleDraft(null); await reload(); notify("Роль и назначения сохранены");
    } catch (error) { notify(error.message, "error"); }
  }
  async function deleteRole(role) {
    if (!confirm(`Удалить роль «${role.name}»?`)) return;
    try { await request(`/api/admin/access-roles/${role.id}`, { method: "DELETE" }); await reload(); notify("Роль удалена"); } catch (error) { notify(error.message, "error"); }
  }
  function principalName(assignment) {
    if (assignment.principal_type === "user") return data.users.find((user) => user.id === Number(assignment.principal_id))?.display_name || `Пользователь #${assignment.principal_id}`;
    return groups.find((group) => group.id === Number(assignment.principal_id))?.name || `Группа #${assignment.principal_id}`;
  }
  function scopeName(assignment) {
    if (assignment.scope_type === "workspace") return "Всё пространство";
    if (assignment.scope_type === "project") return data.projects.find((project) => project.id === Number(assignment.scope_id))?.name || `Проект #${assignment.scope_id}`;
    return data.groups.find((group) => group.id === Number(assignment.scope_id))?.name || `Группа проектов #${assignment.scope_id}`;
  }

  return <div className="access-admin">
    <PageTitle eyebrow="МОДЕЛЬ ДОСТУПА" title="Роли, группы и функции" text="Назначайте права пользователям и группам на пространство, группу проектов или проект. Запрет имеет приоритет; владелец сохраняет аварийный полный доступ." actions={<div className="provider-switch">{canManageGroups && <button className={section === "groups" ? "active" : ""} onClick={() => setSection("groups")}>Группы</button>}{canManageRoles && <button className={section === "roles" ? "active" : ""} onClick={() => setSection("roles")}>Роли</button>}</div>}/>
    {canManageGroups && section === "groups" && <><div className="access-toolbar"><span>{groups.length} групп · вложенность и источники членства LOCAL/LDAP/OIDC/SCIM</span><button className="primary" onClick={() => groupForm()}>+ Новая группа</button></div>{groupDraft && <form className="access-editor surface" onSubmit={saveGroup}><input value={groupDraft.name} onChange={(event) => setGroupDraft({ ...groupDraft, name: event.target.value })} placeholder="Название группы" required/><input value={groupDraft.code} onChange={(event) => setGroupDraft({ ...groupDraft, code: event.target.value.toLowerCase().replace(/[^a-z0-9_.-]/g, "-") })} placeholder="group-code" required/><select value={groupDraft.source} onChange={(event) => setGroupDraft({ ...groupDraft, source: event.target.value })}><option value="local">Локальная</option><option value="ldap">LDAP</option><option value="oidc">OIDC</option><option value="scim">SCIM</option></select><select value={groupDraft.parent_group_id || ""} onChange={(event) => setGroupDraft({ ...groupDraft, parent_group_id: event.target.value ? Number(event.target.value) : null })}><option value="">Без родительской группы</option>{groups.filter((group) => group.id !== groupDraft.id).map((group) => <option value={group.id} key={group.id}>{group.name}</option>)}</select><textarea value={groupDraft.description || ""} onChange={(event) => setGroupDraft({ ...groupDraft, description: event.target.value })} placeholder="Назначение группы"/><div className="group-member-picker"><label>Участники · выбрано {groupDraft.members.length}<input type="search" value={memberSearch} onChange={(event) => setMemberSearch(event.target.value)} placeholder="Поиск сотрудника по имени или почте"/></label><div className="group-member-options">{data.users.filter((user) => user.status === "active" && `${user.display_name} ${user.email || ""}`.toLocaleLowerCase("ru").includes(memberSearch.toLocaleLowerCase("ru"))).map((user) => <label key={user.id}><input type="checkbox" checked={groupDraft.members.some((id) => Number(id) === Number(user.id))} onChange={(event) => setGroupDraft({ ...groupDraft, members: event.target.checked ? [...groupDraft.members, user.id] : groupDraft.members.filter((id) => Number(id) !== Number(user.id)) })}/><span>{user.display_name}<small>{user.email || ""}</small></span></label>)}</div></div><div className="editor-actions"><button type="button" className="secondary" onClick={() => setGroupDraft(null)}>Отмена</button><button className="primary">Сохранить</button></div></form>}<div className="access-card-grid">{groups.map((group) => <article className="surface access-card" key={group.id}><div><span className="source-badge">{group.source.toUpperCase()}</span><strong>{group.name}</strong><code>{group.code}</code></div><p>{group.description || "Без описания"}</p><small>{group.parent_name ? `Входит в «${group.parent_name}» · ` : ""}{group.members.length} участников</small><div className="member-chips">{group.members.slice(0, 6).map((member) => <span key={member.user_id}>{member.display_name}</span>)}</div><div className="editor-actions"><button className="secondary" onClick={() => groupForm(group)}>Изменить</button><button className="text-button danger-text" onClick={() => deleteGroup(group)}>Удалить</button></div></article>)}</div></>}
    {canManageRoles && section === "roles" && <><div className="access-toolbar"><span>{roles.length} ролей · allow/deny · временный доступ</span><button className="primary" onClick={() => roleForm()}>+ Новая роль</button></div>{roleDraft && <form className="role-editor surface" onSubmit={saveRole}><div className="role-main-fields"><input value={roleDraft.name} onChange={(event) => setRoleDraft({ ...roleDraft, name: event.target.value })} placeholder="Название роли" required/><input value={roleDraft.code} onChange={(event) => setRoleDraft({ ...roleDraft, code: event.target.value.toLowerCase().replace(/[^a-z0-9_.-]/g, "-") })} placeholder="role-code" required/><select value={roleDraft.scope} onChange={(event) => { const scope = event.target.value; setRoleDraft({ ...roleDraft, scope, permissions: [], assignments: [] }); setAssignmentDraft({ principal_type: "group", principal_id: "", scope_type: scope === "workspace" ? "workspace" : "project", scope_id: "", expires_at: "" }); }}><option value="workspace">Рабочее пространство</option><option value="project">Проекты</option></select><input value={roleDraft.description || ""} onChange={(event) => setRoleDraft({ ...roleDraft, description: event.target.value })} placeholder="Описание роли"/></div><h3>Доступ к функциям</h3><div className="permission-matrix">{catalog.filter((permission) => permission.scope === roleDraft.scope).map((permission) => { const selected = roleDraft.permissions.find((item) => item.permission_key === permission.key); return <label key={permission.key}><input type="checkbox" checked={Boolean(selected)} onChange={(event) => togglePermission(permission.key, event.target.checked)}/><span><strong>{permission.name}</strong><code>{permission.key}</code></span>{selected && <select value={selected.effect} onChange={(event) => permissionEffect(permission.key, event.target.value)}><option value="allow">Разрешить</option><option value="deny">Запретить</option></select>}</label>; })}</div><h3>Назначения роли</h3><div className="assignment-builder"><select value={assignmentDraft.principal_type} onChange={(event) => setAssignmentDraft({ ...assignmentDraft, principal_type: event.target.value, principal_id: "" })}><option value="group">Группа</option><option value="user">Пользователь</option></select><select value={assignmentDraft.principal_id} onChange={(event) => setAssignmentDraft({ ...assignmentDraft, principal_id: event.target.value })}><option value="">Выберите…</option>{(assignmentDraft.principal_type === "group" ? groups : data.users.filter((user) => user.status === "active")).map((item) => <option value={item.id} key={item.id}>{item.name || item.display_name}</option>)}</select><select value={assignmentDraft.scope_type} disabled={roleDraft.scope === "workspace"} onChange={(event) => setAssignmentDraft({ ...assignmentDraft, scope_type: event.target.value, scope_id: "" })}><option value="workspace">Всё пространство</option>{roleDraft.scope === "project" && <><option value="project_group">Группа проектов</option><option value="project">Проект</option></>}</select>{assignmentDraft.scope_type !== "workspace" && <select value={assignmentDraft.scope_id} onChange={(event) => setAssignmentDraft({ ...assignmentDraft, scope_id: event.target.value })}><option value="">Выберите область…</option>{(assignmentDraft.scope_type === "project" ? data.projects : data.groups).map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select>}<input type="datetime-local" value={assignmentDraft.expires_at} onChange={(event) => setAssignmentDraft({ ...assignmentDraft, expires_at: event.target.value })} title="Срок действия"/><button type="button" className="secondary" onClick={addAssignment}>Добавить</button></div><div className="assignment-list">{roleDraft.assignments.map((assignment, index) => <div key={`${assignment.principal_type}-${assignment.principal_id}-${assignment.scope_type}-${assignment.scope_id}-${index}`}><span><strong>{principalName(assignment)}</strong><small>{scopeName(assignment)}{assignment.expires_at ? ` · до ${date(assignment.expires_at, true)}` : " · бессрочно"}</small></span><button type="button" className="text-button danger-text" onClick={() => setRoleDraft((current) => ({ ...current, assignments: current.assignments.filter((_, itemIndex) => itemIndex !== index) }))}>Убрать</button></div>)}</div><div className="editor-actions"><button type="button" className="secondary" onClick={() => setRoleDraft(null)}>Отмена</button><button className="primary">Сохранить роль</button></div></form>}<div className="access-card-grid">{roles.map((role) => <article className="surface access-card" key={role.id}><div><span className={`status-pill ${role.active ? "active" : ""}`}>{role.scope === "workspace" ? "ПРОСТРАНСТВО" : "ПРОЕКТ"}</span><strong>{role.name}</strong><code>{role.code}</code></div><p>{role.description || "Без описания"}</p><small>{role.permissions.length} разрешений · {role.assignments.length} назначений</small><div className="editor-actions"><button className="secondary" onClick={() => roleForm(role)}>Настроить</button>{!role.is_system && <button className="text-button danger-text" onClick={() => deleteRole(role)}>Удалить</button>}</div></article>)}</div></>}
  </div>;
}

export function AuditAdmin({ notify }) {
  const [entries, setEntries] = useState(null);
  useEffect(() => { request("/api/admin/audit").then(setEntries).catch((error) => notify(error.message, "error")); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return <><PageTitle eyebrow="БЕЗОПАСНОСТЬ" title="Журнал аудита" text="Последние административные и пользовательские изменения в рабочем пространстве."/>{!entries ? <div className="loading-card">Загружаем журнал…</div> : <div className="table audit-table"><div className="table-row table-head"><span>Время</span><span>Пользователь</span><span>Действие</span><span>Объект</span><span>Детали</span></div>{entries.map((entry) => <div className="table-row" key={entry.id}><span>{date(entry.created_at, true)}</span><span>{entry.actor_name || "Система"}</span><code>{entry.action}</code><span>{entry.entity_type}{entry.entity_id ? ` #${entry.entity_id}` : ""}</span><small>{entry.details_json ? JSON.stringify(entry.details_json) : "—"}</small></div>)}</div>}</>;
}

export function ProjectTemplatesAdmin({ data, reload, notify }) {
  const [draft, setDraft] = useState(null);
  const templates = data.projectTemplates || [];
  async function save(event) { event.preventDefault(); try { await request(draft.id ? `/api/admin/project-templates/${draft.id}` : "/api/admin/project-templates", { method: draft.id ? "PATCH" : "POST", body: JSON.stringify(draft) }); setDraft(null); await reload(); notify("Шаблон проекта сохранён"); } catch (error) { notify(error.message, "error"); } }
  async function remove(template) { if (!confirm(`Архивировать шаблон «${template.name}»?`)) return; try { await request(`/api/admin/project-templates/${template.id}`, { method: "DELETE" }); await reload(); notify("Шаблон архивирован"); } catch (error) { notify(error.message, "error"); } }
  function edit(template = null) { setDraft(template ? { id: template.id, name: template.name, description: template.description || "", workflow_id: template.workflow_id, issue_type_scheme_id: template.issue_type_scheme_id || null, permission_scheme_id: template.permission_scheme_id || null, default_group_id: template.default_group_id || null, color: template.color, duration_days: template.duration_days, default_tasks: template.default_tasks || [], active: Boolean(template.active) } : { name: "", description: "", workflow_id: data.workflows[0]?.id, default_group_id: data.groups[0]?.id || null, color: "#675EE7", duration_days: 30, default_tasks: [], active: true }); }
  function addTask() { setDraft((current) => ({ ...current, default_tasks: [...current.default_tasks, { title: "Новая задача", description: "", stage_code: data.workflows.find((workflow) => workflow.id === current.workflow_id)?.stages[0]?.code || "backlog", issue_type_code: "task", priority: "medium", start_offset_days: 0, due_offset_days: 7 }] })); }
  return <><PageTitle eyebrow="СТАНДАРТИЗАЦИЯ" title="Шаблоны проектов" text="Создавайте проекты с готовым процессом, схемами, сроками и стартовым набором задач." actions={<button className="primary" onClick={() => edit()}>+ Новый шаблон</button>}/>{draft && <form className="template-editor surface" onSubmit={save}><div className="role-main-fields"><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Название шаблона" required/><select value={draft.workflow_id} onChange={(event) => setDraft({ ...draft, workflow_id: Number(event.target.value) })}>{data.workflows.map((workflow) => <option value={workflow.id} key={workflow.id}>{workflow.name}</option>)}</select><select value={draft.default_group_id || ""} onChange={(event) => setDraft({ ...draft, default_group_id: event.target.value ? Number(event.target.value) : null })}><option value="">Без группы по умолчанию</option>{data.groups.map((group) => <option value={group.id} key={group.id}>{group.name}</option>)}</select><input type="number" min="1" max="3650" value={draft.duration_days} onChange={(event) => setDraft({ ...draft, duration_days: Number(event.target.value) })} title="Длительность, дней"/><input value={draft.description || ""} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="Описание"/></div><h3>Стартовые задачи</h3><div className="template-task-list">{draft.default_tasks.map((task, index) => <div key={index}><input value={task.title} onChange={(event) => setDraft({ ...draft, default_tasks: draft.default_tasks.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item) })}/><select value={task.priority} onChange={(event) => setDraft({ ...draft, default_tasks: draft.default_tasks.map((item, itemIndex) => itemIndex === index ? { ...item, priority: event.target.value } : item) })}>{Object.entries(PRIORITY).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><input type="number" min="0" value={task.due_offset_days} onChange={(event) => setDraft({ ...draft, default_tasks: draft.default_tasks.map((item, itemIndex) => itemIndex === index ? { ...item, due_offset_days: Number(event.target.value) } : item) })} title="Срок от старта, дней"/><button type="button" className="text-button danger-text" onClick={() => setDraft({ ...draft, default_tasks: draft.default_tasks.filter((_, itemIndex) => itemIndex !== index) })}>Удалить</button></div>)}</div><button type="button" className="add-row" onClick={addTask}>+ Добавить стартовую задачу</button><div className="editor-actions"><button type="button" className="secondary" onClick={() => setDraft(null)}>Отмена</button><button className="primary">Сохранить шаблон</button></div></form>}<div className="access-card-grid">{templates.map((template) => <article className="surface access-card" key={template.id}><div><span className="project-glyph" style={{ background: template.color }}>Ш</span><strong>{template.name}</strong></div><p>{template.description}</p><small>{template.duration_days} дней · {template.default_tasks.length} стартовых задач</small><div className="editor-actions"><button className="secondary" onClick={() => edit(template)}>Изменить</button><button className="text-button danger-text" onClick={() => remove(template)}>Архивировать</button></div></article>)}</div></>;
}

export function ImportAdmin({ data, reload, notify }) {
  const [busy, setBusy] = useState(false);
  async function upload(event) { const file = event.target.files?.[0]; if (!file) return; setBusy(true); try { const sourceType = file.name.endsWith(".json") ? "jira_json" : "jira_csv"; const presign = await request("/api/imports/presign", { method: "POST", body: JSON.stringify({ file_name: file.name, source_type: sourceType }) }); const uploaded = await fetch(presign.upload_url, { method: "PUT", body: file, headers: { "content-type": file.type || "application/octet-stream" } }); if (!uploaded.ok) throw new Error("Не удалось загрузить файл в хранилище"); await request("/api/imports/complete", { method: "POST", body: JSON.stringify({ object_key: presign.object_key, source_type: sourceType, options: {} }) }); await reload(); notify("Импорт поставлен в очередь"); } catch (error) { notify(error.message, "error"); } finally { setBusy(false); event.target.value = ""; } }
  return <><PageTitle eyebrow="МИГРАЦИЯ" title="Импорт из Jira" text="Загрузите Jira JSON или CSV. Обработка идёт асинхронно и не блокирует интерфейс." actions={<label className={`primary file-action ${busy ? "disabled" : ""}`}>{busy ? "Загружаем…" : "Выбрать файл"}<input type="file" accept=".json,.csv,application/json,text/csv" onChange={upload} disabled={busy}/></label>}/><div className="table import-table"><div className="table-row table-head"><span>ID</span><span>Источник</span><span>Статус</span><span>Создан</span><span>Результат</span></div>{(data.administration?.importJobs || []).map((job) => <div className="table-row" key={job.id}><span>#{job.id}</span><span>{job.source_type}</span><span><span className={`status-pill ${job.status}`}>{job.status}</span></span><span>{date(job.created_at, true)}</span><span>{job.error_text || (job.result ? JSON.stringify(job.result) : "—")}</span></div>)}</div></>;
}

export function NotificationCenter({ data, reload, close, notify }) {
  async function mark(item) { try { await request(`/api/notifications/${item.id}`, { method: "PATCH", body: JSON.stringify({ read: true }) }); await reload(); } catch (error) { notify(error.message, "error"); } }
  return <div className="notification-panel"><div className="surface-head"><div><span className="overline">ЦЕНТР СОБЫТИЙ</span><h2>Уведомления</h2></div><button className="icon-button" onClick={close} aria-label="Закрыть уведомления" title="Закрыть">×</button></div>{data.notifications.map((item) => <button className={item.read_at ? "read" : ""} key={item.id} onClick={() => mark(item)}><strong>{item.title}</strong><span>{item.body}</span><small>{date(item.created_at, true)}</small></button>)}{!data.notifications.length && <div className="empty-compact">Новых уведомлений нет</div>}</div>;
}

export function TaskActivity({ task, data, notify }) {
  const [details, setDetails] = useState(null);
  const [tab, setTab] = useState("comments");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordedSeconds, setRecordedSeconds] = useState(0);
  const recorderRef = useRef(null);
  const recordingStartedRef = useRef(0);
  const permissions = data.permissions.projects[String(task.project_id)] || {};
  async function load() { try { setDetails(await request(`/api/tasks/${task.id}/details`)); } catch (error) { notify?.(error.message, "error"); } }
  useEffect(() => { load(); }, [task.id]); // eslint-disable-line react-hooks/exhaustive-deps
  async function comment(event) { event.preventDefault(); if (!text.trim()) return; setBusy(true); try { await request(`/api/tasks/${task.id}/comments`, { method: "POST", body: JSON.stringify({ body: text, is_internal: false }) }); setText(""); await load(); } catch (error) { notify?.(error.message, "error"); } finally { setBusy(false); } }
  async function checklist(event) { event.preventDefault(); if (!text.trim()) return; setBusy(true); try { await request(`/api/tasks/${task.id}/checklist`, { method: "POST", body: JSON.stringify({ title: text }) }); setText(""); await load(); } catch (error) { notify?.(error.message, "error"); } finally { setBusy(false); } }
  async function toggle(item) { await request(`/api/checklist/${item.id}`, { method: "PATCH", body: JSON.stringify({ completed: !item.completed }) }); await load(); }
  async function worklog(event) { event.preventDefault(); const form = new FormData(event.currentTarget); try { await request(`/api/tasks/${task.id}/worklogs`, { method: "POST", body: JSON.stringify({ minutes_spent: Number(form.get("minutes")), work_date: form.get("date"), description: form.get("description") }) }); event.currentTarget.reset(); await load(); } catch (error) { notify?.(error.message, "error"); } }
  async function upload(event) { const file = event.target.files?.[0]; if (!file) return; setBusy(true); try { const presign = await request(`/api/tasks/${task.id}/attachments/presign`, { method: "POST", body: JSON.stringify({ file_name: file.name, size_bytes: file.size, mime_type: file.type || "application/octet-stream" }) }); const result = await fetch(presign.upload_url, { method: "PUT", body: file, headers: { "content-type": file.type || "application/octet-stream" } }); if (!result.ok) throw new Error("Ошибка загрузки файла"); await request(`/api/tasks/${task.id}/attachments/complete`, { method: "POST", body: JSON.stringify({ object_key: presign.object_key, file_name: file.name, mime_type: file.type || "application/octet-stream" }) }); await load(); } catch (error) { notify?.(error.message, "error"); } finally { setBusy(false); } }
  async function startVoice() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks = [];
      const recorder = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" }) : new MediaRecorder(stream);
      recorder.ondataavailable = (event) => event.data.size && chunks.push(event.data);
      recorder.onstop = async () => { stream.getTracks().forEach((track) => track.stop()); const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" }); const duration = Math.max(1, Math.round((Date.now() - recordingStartedRef.current) / 1000)); setRecording(false); setRecordedSeconds(duration); setBusy(true); try { const presign = await request(`/api/tasks/${task.id}/voice-comments/presign`, { method: "POST", body: JSON.stringify({ mime_type: blob.type, size_bytes: blob.size }) }); const uploaded = await fetch(presign.upload_url, { method: "PUT", body: blob, headers: { "content-type": blob.type } }); if (!uploaded.ok) throw new Error("Не удалось загрузить голосовой комментарий"); await request(`/api/tasks/${task.id}/voice-comments/complete`, { method: "POST", body: JSON.stringify({ object_key: presign.object_key, mime_type: blob.type, duration_seconds: duration }) }); await load(); notify?.("Голосовой комментарий добавлен"); } catch (error) { notify?.(error.message, "error"); } finally { setBusy(false); } };
      recorderRef.current = recorder; recordingStartedRef.current = Date.now(); recorder.start(500); setRecording(true); setRecordedSeconds(0);
    } catch (error) { notify?.(`Нет доступа к микрофону: ${error.message}`, "error"); }
  }
  function stopVoice() { if (recorderRef.current?.state === "recording") recorderRef.current.stop(); }
  async function transcribe(comment) { try { const result = await request(`/api/comments/${comment.id}/transcribe`, { method: "POST", body: "{}" }); if (result.status === "completed") await load(); else { notify?.("Расшифровка поставлена в очередь"); setTimeout(load, 3500); } } catch (error) { notify?.(error.message, "error"); } }
  if (!details) return <div className="activity-loading">Загружаем историю задачи…</div>;
  const tabs = [["comments", `Комментарии ${details.comments.length}`], ["checklist", `Чек-лист ${details.checklist.length}`], ["files", `Файлы ${details.attachments.length}`], ["worklogs", "Учёт времени"], ["history", "История"]];
  return <section className="task-activity"><nav>{tabs.map(([key, label]) => <button type="button" className={tab === key ? "active" : ""} key={key} onClick={() => { setTab(key); setText(""); }}>{label}</button>)}</nav>{tab === "comments" && <div><div className="activity-list">{details.comments.map((item) => <article key={item.id}><strong>{item.author_name}</strong><small>{date(item.created_at, true)}</small><p>{item.body}</p>{item.voice_id && <div className="voice-comment"><audio controls preload="metadata" src={`/api/comments/${item.id}/voice/download`}/><span>{item.duration_seconds ? `${item.duration_seconds} сек.` : "Голосовая запись"}</span>{item.transcript_status === "completed" ? <blockquote>{item.transcript_text}</blockquote> : <button className="text-button" onClick={() => transcribe(item)} disabled={item.transcript_status === "processing"}>{item.transcript_status === "processing" ? "Расшифровываем…" : item.transcript_status === "failed" ? "Повторить расшифровку" : "Расшифровать в текст"}</button>}</div>}</article>)}</div>{permissions["comment.create"] && <><form className="activity-form" onSubmit={comment}><textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="Добавить комментарий…"/><button className="primary" disabled={busy}>Отправить</button></form><div className="voice-recorder"><button className={recording ? "danger" : "secondary"} onClick={recording ? stopVoice : startVoice} disabled={busy}>{recording ? "■ Остановить запись" : "🎙 Записать голосом"}</button><span>{recording ? "Идёт запись с микрофона телефона…" : recordedSeconds ? `Записано ${recordedSeconds} сек.` : "После загрузки запись можно расшифровать один раз"}</span></div></>}</div>}{tab === "checklist" && <div><div className="checklist-list">{details.checklist.map((item) => <label key={item.id}><input type="checkbox" disabled={!permissions["task.edit"]} checked={Boolean(item.completed)} onChange={() => toggle(item)}/><span>{item.title}</span></label>)}</div>{permissions["task.edit"] && <form className="activity-form compact-form" onSubmit={checklist}><input value={text} onChange={(event) => setText(event.target.value)} placeholder="Новый пункт…"/><button className="secondary">Добавить</button></form>}</div>}{tab === "files" && <div>{permissions["attachment.manage"] && <label className="file-drop">{busy ? "Загружаем…" : "Перетащите или выберите файл до 25 МБ"}<input type="file" onChange={upload} disabled={busy}/></label>}<div className="file-list">{details.attachments.map((item) => <a key={item.id} href={`/api/attachments/${item.id}/download`} target="_blank"><strong>{item.file_name}</strong><span>{Math.ceil(item.size_bytes / 1024)} КБ · {item.uploaded_by_name}</span></a>)}</div></div>}{tab === "worklogs" && <div>{permissions["worklog.create"] && <form className="worklog-form" onSubmit={worklog}><input name="minutes" type="number" min="1" placeholder="Минуты" required/><input name="date" type="date" defaultValue={today()} required/><input name="description" placeholder="Что сделано"/><button className="secondary">Списать время</button></form>}<div className="activity-list">{details.worklogs.map((item) => <article key={item.id}><strong>{item.user_name} · {item.minutes_spent} мин.</strong><small>{date(item.work_date)}</small><p>{item.description}</p></article>)}</div></div>}{tab === "history" && <div className="activity-list">{details.revisions.map((item) => <article key={item.id}><strong>Версия {item.version_number} · {item.changed_by_name || "Система"}</strong><small>{date(item.created_at, true)}</small><pre>{JSON.stringify(item.changes, null, 2)}</pre></article>)}</div>}</section>;
}
