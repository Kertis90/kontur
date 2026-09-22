"use client";
import {SemanticSettings} from './SemanticSearch.jsx';
import {AiBudgetSettings} from "./AiBudget.jsx";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { conferenceDate } from "../lib/conference-collaboration.js";

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json", ...options.headers } });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || "Не удалось выполнить запрос");
  return value;
}
const formatted = (value) => value ? new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" }).format(conferenceDate(value)) : "—";
const statuses = { queued: "В очереди", running: "ИИ анализирует", completed: "Готово", failed: "Ошибка", cancelled: "Отменено" };

export function AiSettings() {
  const [config, setConfig] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [models, setModels] = useState({});
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    api("/api/admin/ai", { signal: controller.signal }).then((value) => { setConfig(value); setSelectedId(value.profiles[0]?.id); }).catch((error) => { if (!controller.signal.aborted) setNotice({ error: true, text: error.message }); });
    return () => controller.abort();
  }, []);
  const profile = config?.profiles.find((item) => item.id === selectedId);
  function change(patch) { setDirty(true); setNotice(null); setConfig((current) => ({ ...current, ...patch })); }
  function updateProfile(patch) { change({ profiles: config.profiles.map((item) => item.id === selectedId ? { ...item, ...patch } : item) }); }
  function addProfile() {
    const id = crypto.randomUUID();
    change({ profiles: [...config.profiles, { id, name: "Новое подключение", base_url: "", model: "", api_key: "", enabled: true, protocol: "chat_completions", token_parameter: "max_tokens", max_output_tokens: 3000, max_input_chars: 60000, timeout_seconds: 120, temperature: null, instructions: "" }] });
    setSelectedId(id);
  }
  async function save(event) {
    event.preventDefault(); setBusy(true); setNotice(null);
    try { const saved = await api("/api/admin/ai", { method: "PUT", body: JSON.stringify(config) }); setConfig(saved); setDirty(false); setNotice({ text: "Настройки сохранены. Ключи остаются на сервере." }); }
    catch (error) { setNotice({ error: true, text: error.message }); }
    finally { setBusy(false); }
  }
  async function test(action) {
    setBusy(true); setNotice(null);
    try {
      const result = await api(`/api/admin/ai/profiles/${selectedId}/${action}`, { method: "POST", body: "{}" });
      if (action === "models") { setModels((current) => ({ ...current, [selectedId]: result.models })); setNotice({ text: `Получено моделей: ${result.models.length}. Выберите модель или укажите её вручную.` }); }
      else setNotice({ text: `${result.message} · ${(result.duration_ms / 1000).toFixed(1)} с` });
    } catch (error) { setNotice({ error: true, text: error.message }); }
    finally { setBusy(false); }
  }
  if (!config) return <div className="ai-notice" role="status">{notice?.text || "Загружаем настройки ИИ…"}</div>;
  const readyProfiles = config.profiles.filter((item) => item.enabled && item.model);
  return <form className="ai-settings" onSubmit={save}>
    <div className="ai-section-head"><div><span className="overline">ИНТЕГРАЦИЯ</span><h2>Искусственный интеллект</h2><p>Ваши серверы и модели для анализа проектов и итогов встреч по чату или записи.</p></div><button className="primary" disabled={busy}>{busy ? "Подождите…" : "Сохранить настройки"}</button></div>
    {notice && <div className={`ai-notice ${notice.error ? "error" : ""}`} role={notice.error ? "alert" : "status"}>{notice.text}</div>}
    <fieldset disabled={busy} className="ai-fieldset">
      <div className="ai-policy-row"><label className="toggle"><input type="checkbox" checked={config.enabled} onChange={(event) => change({ enabled: event.target.checked })}/><i/><span>Включить ИИ в рабочем пространстве</span></label><label>Запусков на пользователя в сутки<input type="number" min="1" max="500" value={config.daily_user_limit} onChange={(event) => change({ daily_user_limit: Number(event.target.value) })}/></label></div>
      <SemanticSettings/><AiBudgetSettings value={config.budget} onChange={budget=>change({budget})}/>
      <div className="ai-defaults">{[["project_profile_id", "Оценка проекта"], ["conference_profile_id", "Сводка конференции"]].map(([key, label]) => <label key={key}>{label}<select value={config[key] || ""} onChange={(event) => change({ [key]: event.target.value || null })}><option value="">Выберите подключение и модель</option>{readyProfiles.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.model}</option>)}</select></label>)}</div>
      <details className="ai-speech-settings"><summary>Распознавание речи и субтитры</summary><p>Совместимый метод /audio/transcriptions. Расшифровка сохраняется и повторно используется.</p><div className="ai-config-grid">
        <label className="ai-check wide"><input type="checkbox" checked={config.speech.enabled} onChange={(e) => change({ speech: { ...config.speech, enabled: e.target.checked } })}/>Включить распознавание речи</label>
        <label className="wide">Базовый URL<input type="url" value={config.speech.base_url} placeholder="https://speech.company.ru/v1" onChange={(e) => change({ speech: { ...config.speech, base_url: e.target.value } })}/></label>
        <label>Модель<input value={config.speech.model} onChange={(e) => change({ speech: { ...config.speech, model: e.target.value } })}/></label>
        <label>Язык<input value={config.speech.language} maxLength={3} onChange={(e) => change({ speech: { ...config.speech, language: e.target.value } })}/></label>
        <label className="wide">Ключ распознавания<input type="password" autoComplete="new-password" value={config.speech.api_key || ""} placeholder={config.speech.api_key_configured ? "Ключ сохранён" : "Необязательно"} onChange={(e) => change({ speech: { ...config.speech, api_key: e.target.value, clear_api_key: false } })}/></label>
        {config.speech.api_key_configured && <label className="ai-check wide"><input type="checkbox" checked={Boolean(config.speech.clear_api_key)} onChange={(e) => change({ speech: { ...config.speech, clear_api_key: e.target.checked, api_key: "" } })}/>Удалить ключ распознавания</label>}
        <label className="ai-check wide"><input type="checkbox" checked={Boolean(config.speech.live_captions)} onChange={e=>change({speech:{...config.speech,live_captions:e.target.checked}})}/>Разрешить субтитры собственного микрофона во встречах</label>
        {[['caption_user_minutes','Минут субтитров на человека в сутки',60,1440],['caption_workspace_minutes','Минут субтитров на пространство в сутки',600,100000],['caption_concurrency','Одновременных запросов субтитров',10,50]].map(([key,label,fallback,max])=><label key={key}>{label}<input type="number" min={1} max={max} value={config.speech[key]??fallback} onChange={e=>change({speech:{...config.speech,[key]:Number(e.target.value)}})}/></label>)}
        <p className="wide ai-help">Нужно право «Субтитры собственного микрофона», разрешение организатора и включение самим сотрудником. Успешные фрагменты учитываются по длительности, неуспешные — по резерву 12 секунд. Суточные лимиты сбрасываются в 00:00 UTC.</p>
        <label>Таймаут фрагмента, секунд<input type="number" min={30} max={600} value={config.speech.timeout_seconds} onChange={(e) => change({ speech: { ...config.speech, timeout_seconds: Number(e.target.value) } })}/></label>
      </div></details>
      <div className="ai-config-layout"><aside><div className="ai-profiles-head"><strong>Подключения</strong><button type="button" className="secondary" onClick={addProfile} disabled={config.profiles.length >= 20}>+ Добавить</button></div>{config.profiles.map((item) => <button type="button" className={`ai-profile-item ${item.id === selectedId ? "active" : ""}`} onClick={() => setSelectedId(item.id)} key={item.id}><strong>{item.name}</strong><span>{item.model || "Модель не выбрана"}</span><small>{item.enabled ? "Активно" : "Выключено"}</small></button>)}{!config.profiles.length && <p>Добавьте первое подключение.</p>}</aside>
        {profile ? <section className="ai-profile-editor"><div className="ai-config-grid">
          <label>Название<input value={profile.name} maxLength={100} onChange={(event) => updateProfile({ name: event.target.value })} required/></label>
          <label>Протокол<select value={profile.protocol} onChange={(event) => updateProfile({ protocol: event.target.value })}><option value="chat_completions">OpenAI Chat Completions</option><option value="responses">OpenAI Responses</option></select></label>
          <label className="wide">Базовый URL<input type="url" value={profile.base_url} placeholder="https://llm.company.ru/v1" onChange={(event) => updateProfile({ base_url: event.target.value })} required/><small>Адрес должен быть доступен приложению и worker. Допускаются внутренние HTTP-серверы.</small></label>
          <label className="wide">API-ключ<input type="password" autoComplete="new-password" value={profile.api_key || ""} placeholder={profile.api_key_configured ? "Ключ сохранён; оставьте пустым, чтобы сохранить" : "Оставьте пустым, если ключ не нужен"} onChange={(event) => updateProfile({ api_key: event.target.value, clear_api_key: false })}/></label>
          {profile.api_key_configured && <label className="ai-check wide"><input type="checkbox" checked={Boolean(profile.clear_api_key)} onChange={(event) => updateProfile({ clear_api_key: event.target.checked, api_key: "" })}/>Удалить сохранённый ключ</label>}
          <label className="wide">Модель<input list={`ai-models-${profile.id}`} value={profile.model} placeholder="Точный ID модели на вашем сервере" onChange={(event) => updateProfile({ model: event.target.value })}/><datalist id={`ai-models-${profile.id}`}>{(models[profile.id] || []).map((model) => <option value={model} key={model}/>)}</datalist></label>
          <label>Лимит ответа, токенов<input type="number" min="128" max="32000" value={profile.max_output_tokens} onChange={(event) => updateProfile({ max_output_tokens: Number(event.target.value) })}/></label>
          <label>Данные для анализа, символов<input type="number" min="4000" max="300000" value={profile.max_input_chars} onChange={(event) => updateProfile({ max_input_chars: Number(event.target.value) })}/></label>
          <label>Таймаут, секунд<input type="number" min="10" max="300" value={profile.timeout_seconds} onChange={(event) => updateProfile({ timeout_seconds: Number(event.target.value) })}/></label>
          <label>Temperature (необязательно)<input type="number" min="0" max="2" step="0.1" value={profile.temperature ?? ""} placeholder="По умолчанию модели" onChange={(event) => updateProfile({ temperature: event.target.value === "" ? null : Number(event.target.value) })}/></label>
          {profile.protocol === "chat_completions" && <label className="wide">Параметр лимита ответа<select value={profile.token_parameter} onChange={(event) => updateProfile({ token_parameter: event.target.value })}><option value="max_tokens">max_tokens — совместимые серверы</option><option value="max_completion_tokens">max_completion_tokens — модели с рассуждением</option></select></label>}
          <label className="wide">Дополнительные правила для ИИ<textarea rows="3" maxLength={4000} value={profile.instructions || ""} placeholder="Например: уделяй внимание зависимостям и рискам сроков" onChange={(event) => updateProfile({ instructions: event.target.value })}/></label>
          <label className="ai-check wide"><input type="checkbox" checked={profile.enabled} onChange={(event) => updateProfile({ enabled: event.target.checked })}/>Подключение доступно для запуска</label>
        </div><div className="ai-profile-actions"><button type="button" className="secondary" disabled={dirty} onClick={() => test("models")}>Загрузить модели</button><button type="button" className="secondary" disabled={dirty || !profile.model} onClick={() => test("test")}>Проверить генерацию</button><button type="button" className="text-button danger-text" onClick={() => { if (!confirm(`Убрать подключение «${profile.name}»? Сохранённые результаты останутся.`)) return; change({ profiles: config.profiles.filter((item) => item.id !== profile.id), project_profile_id: config.project_profile_id === profile.id ? null : config.project_profile_id, conference_profile_id: config.conference_profile_id === profile.id ? null : config.conference_profile_id }); setSelectedId(config.profiles.find((item) => item.id !== profile.id)?.id); }}>Убрать</button></div><p className="ai-help">{dirty ? "Сохраните настройки перед загрузкой моделей и проверкой." : "Проверка генерации отправляет короткий тестовый текст и может расходовать токены провайдера."}</p></section> : <div className="ai-empty"><strong>Подключите свою модель</strong><p>Добавьте базовый URL, сохраните его и загрузите список моделей. Для сервера без /models укажите ID вручную.</p></div>}
      </div>
    </fieldset>
    <p className="ai-help">Запуски и просмотр результатов настраиваются в «Роли и группы». Данные выбранного проекта или конференции передаются указанному провайдеру только при запуске анализа. ИИ не меняет задачи и права автоматически.</p>
  </form>;
}

export function AiButton({ kind, sourceId, title, joinCode, permissions = {} }) {
  const [open, setOpen] = useState(false);
  if (!permissions["ai.result.view"] && !permissions[kind === "project" ? "ai.project.analyze" : "ai.conference.summarize"]) return null;
  return <><button className="secondary ai-entry" onClick={() => setOpen(true)}>✦ {kind === "project" ? "Оценить проект с ИИ" : "Сводка с ИИ"}</button>{open && <AiPanel kind={kind} sourceId={sourceId} title={title} joinCode={joinCode} onClose={() => setOpen(false)}/>}</>;
}

export function AiPanel({ kind, sourceId, title, joinCode, initialRecordingId, onClose }) {
  const [data, setData] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [recordingId, setRecordingId] = useState(initialRecordingId ? String(initialRecordingId) : "");
  const [profileId, setProfileId] = useState("");
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const dialogRef = useRef(null);
  const pendingRef = useRef(null);
  const busyRef = useRef(false);
  const path = `/api/${kind === "project" ? "projects" : "conferences"}/${sourceId}/ai`;
  const query = joinCode ? `?${new URLSearchParams({ join_code: joinCode })}` : "";
  const job = data?.jobs.find((item) => Number(item.id) === Number(selectedId));
  const pending = data?.jobs.some((item) => ["queued", "running"].includes(item.status));
  useEffect(() => {
    const previous = document.activeElement;
    dialogRef.current?.focus();
    return () => previous?.focus?.();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let loading = false;
    async function load() {
      if (loading) return;
      loading = true;
      try { const value = await api(path + query, { signal: controller.signal }); setData(value); setSelectedId((current) => current || value.jobs[0]?.id); setProfileId((current) => current || value.default_profile_id || ""); setError(""); }
      catch (failure) { if (!controller.signal.aborted) setError(failure.message); }
      finally { loading = false; }
    }
    load();
    const timer = pending ? setInterval(load, 3000) : null;
    return () => { controller.abort(); if (timer) clearInterval(timer); };
  }, [path, query, pending]);
  async function generate(regenerate) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(""); setNotice("");
    const payload = { recording_id: recordingId ? Number(recordingId) : undefined, profile_id: profileId || undefined, instructions, regenerate, ...(joinCode ? { join_code: joinCode } : {}) };
    const signature = JSON.stringify(payload);
    if (pendingRef.current?.signature !== signature) pendingRef.current = { signature, request_id: crypto.randomUUID() };
    try {
      const result = await api(path, { method: "POST", body: JSON.stringify({ ...payload, request_id: pendingRef.current.request_id }) });
      pendingRef.current = null;
      setData((current) => ({ ...current, jobs: [result.job, ...current.jobs.filter((item) => item.id !== result.job.id)].slice(0, 20) }));
      setSelectedId(result.job.id);
      setNotice(result.cached ? "Использован сохранённый запрос для тех же данных." : "Запрос поставлен в очередь. Можно закрыть окно — результат сохранится.");
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); busyRef.current = false; }
  }
  function download() {
    const meta = job.source_meta;
    const content = `${title}\n${kind === "project" ? "Оценка проекта" : "Изложение встречи"}\nМодель: ${job.model}\nСоздано: ${formatted(job.created_at)}\nОснова: ${meta.basis}\nЗаписей: ${meta.included_records} из ${meta.total_records}\n\n${job.result_text}`;
    const url = URL.createObjectURL(new Blob(["\uFEFF", content], { type: "text/plain;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `kontur-ai-${job.id}.txt`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return createPortal(<div className="ai-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="ai-dialog" role="dialog" aria-modal="true" aria-label={kind === "project" ? "Оценка проекта с ИИ" : "Сводка конференции с ИИ"} tabIndex={-1} ref={dialogRef} onKeyDown={(event) => {
    event.stopPropagation();
    if (event.key === "Escape") onClose();
    if (event.key === "Tab") { const items = [...event.currentTarget.querySelectorAll('button:not(:disabled),input,select,textarea')].filter((item) => item.getClientRects().length); const first = items[0], last = items.at(-1); if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } }
  }}><header className="ai-dialog-head"><div><span className="overline">ИИ-ПОМОЩНИК</span><h2>{kind === "project" ? "Оценка проекта" : "Сводка конференции"}</h2><p>{title}</p></div><button className="secondary" onClick={onClose} aria-label="Закрыть">×</button></header>
    <div className="ai-dialog-content">{error && <div className="ai-notice error" role="alert">{error}</div>}{notice && <div className="ai-notice" role="status">{notice}</div>}
      {!data && !error && <div className="ai-empty" role="status">Загружаем результаты…</div>}
      {data && <>{!data.enabled && <div className="ai-notice">ИИ отключён в настройках. Сохранённые результаты доступны для просмотра.</div>}{data.can_generate && <div className="ai-run-form">{kind === "conference" && <label>Источник изложения<select value={recordingId} onChange={(e) => setRecordingId(e.target.value)} disabled={busy}><option value="">Чат и вопросы встречи</option>{(data.recordings || []).map((record) => <option key={record.id} value={record.id} disabled={record.transcript_status !== "completed"}>Запись #{record.id} · {formatted(record.started_at)}{record.transcript_status !== "completed" ? " · сначала расшифруйте аудио" : ""}</option>)}</select></label>}<label>Подключение и модель<select value={profileId} disabled={busy} onChange={(event) => setProfileId(event.target.value)}><option value="">По умолчанию</option>{data.profiles.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.model}</option>)}</select></label><label>На что обратить внимание?<textarea rows="2" maxLength={2000} value={instructions} disabled={busy} onChange={(event) => setInstructions(event.target.value)} placeholder={kind === "project" ? "Например: риски сроков и задачи без исполнителей" : "Например: решения, ответственные и нерешённые вопросы"}/></label><div className="ai-run-actions"><button className="primary" disabled={busy || !data.enabled || !data.profiles.length} onClick={() => generate(false)}>{busy ? "Отправляем…" : "Сформировать"}</button>{job && <button className="secondary" disabled={busy || !data.enabled || !data.profiles.length || ["queued", "running"].includes(job.status)} onClick={() => generate(true)}>Сформировать заново</button>}</div><small>{kind === "conference" ? (recordingId ? "В модель передаётся сохранённая расшифровка аудио. Длинная запись обрабатывается по частям с объединением итогов." : "В модель передаются чат и вопросы этой встречи. Для изложения по записи выберите готовую расшифровку.") : "В модель передаются задачи и показатели выбранного проекта."}</small></div>}
        {data.jobs.length > 0 && <label className="ai-history-select">Сохранённые запросы<select value={selectedId || ""} onChange={(event) => setSelectedId(Number(event.target.value))}>{data.jobs.map((item) => <option key={item.id} value={item.id}>#{item.id} · {formatted(item.created_at)} · {item.model} · {statuses[item.status]}</option>)}</select></label>}
        {job ? <article className="ai-result"><div className="ai-result-head"><span className={`status-pill ${job.status}`} role="status">{statuses[job.status]}</span><span>{job.provider_name} · {job.model}</span>{job.status === "completed" && <button className="secondary" onClick={download}>Скачать TXT</button>}</div><p className="ai-help">{job.source_meta.basis} · {job.source_meta.included_records} из {job.source_meta.total_records} записей · {formatted(job.source_meta.captured_at)}</p>{job.source_meta.partial && <div className="ai-notice">В сводку вошла часть записей из-за лимита контекста. {kind === "conference" ? "Выбраны последние сообщения." : "Сначала выбраны открытые задачи с ближайшими сроками."}</div>}{job.incomplete && <div className="ai-notice">Ответ достиг лимита модели и может быть неполным.</div>}{job.error_text && <div className="ai-notice error" role="alert">{job.error_text}</div>}{["queued", "running"].includes(job.status) && <div className="ai-progress" role="status"><span/>{job.status === "queued" ? "Ожидаем начала обработки…" : "Модель готовит результат…"}</div>}{job.result_text && <div className="ai-result-text">{job.result_text}</div>}{job.status === "completed" && <footer className="ai-result-foot">Рекомендации ИИ — проверьте перед принятием решений.{job.input_tokens !== null && ` Вход: ${job.input_tokens} токенов.`}{job.output_tokens !== null && ` Выход: ${job.output_tokens} токенов.`}</footer>}</article> : <div className="ai-empty"><strong>Сохранённых результатов пока нет</strong><p>{data.can_generate ? "Выберите модель и запустите анализ. Результат останется здесь для пользователей с доступом." : "Попросите руководителя проекта сформировать анализ или выдать право запуска."}</p></div>}</>}
    </div></section></div>, document.body);
}
