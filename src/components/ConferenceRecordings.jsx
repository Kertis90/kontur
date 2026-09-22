"use client";
import { useEffect, useRef, useState } from "react";
import { RecordingWorkbench } from "./MeetingWorkbench.jsx";
import ToolDialog, { toolApi } from "./ToolDialog.jsx";
import { AiPanel } from "./AiTools.jsx";
import { conferenceDate } from "../lib/conference-collaboration.js";

const statuses = { starting: "Запускается запись", recording: "Идёт запись", stopping: "Сохраняется в S3", completed: "Сохранено в S3", failed: "Ошибка записи" };
const transcripts = { none: "Нет расшифровки", queued: "В очереди", running: "Распознаём речь", completed: "Расшифровка готова", failed: "Ошибка распознавания" };
const date = (value) => new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" }).format(conferenceDate(value));
export default function ConferenceRecordings({ conference, inRoom = false, liveRecording }) {
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(null);
  const [summary, setSummary] = useState(null);
  const [workbench, setWorkbench] = useState(null);
  const requestId = useRef(null);
  const api = `/api/conferences/${conference.id}/recordings`;
  const query = conference.join_code ? `?${new URLSearchParams({ join_code: conference.join_code })}` : "";
  useEffect(() => {
    if (!open && (!inRoom || liveRecording !== undefined)) return;
    const controller = new AbortController(); let loading = false;
    const load = async () => { if (loading || document.hidden) return; loading = true; try { setData(await toolApi(api + query, { signal: controller.signal })); setError(""); } catch (failure) { if (!controller.signal.aborted) { setError(failure.message); setData(null); setPlaying(null); } } finally { loading = false; } };
    load(); const timer = setInterval(load, 10000); document.addEventListener("visibilitychange", load);
    return () => { controller.abort(); clearInterval(timer); document.removeEventListener("visibilitychange", load); };
  }, [api, query, inRoom, open, liveRecording]);
  async function action(path, body = {}) {
    if (busy) return; setBusy(true); setError("");
    try { await toolApi(api + path + query, { method: "POST", body: JSON.stringify(body) }); requestId.current = null; setData(await toolApi(api + query)); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  const active = data?.active;
  const badge = inRoom && !open && liveRecording !== undefined ? (liveRecording ? "recording" : null) : active?.status;
  return <><button className={`secondary recording-entry ${badge ? "is-recording" : ""}`} onClick={() => setOpen(true)}><span aria-hidden="true">●</span> {badge ? statuses[badge] : "Записи встречи"}</button>
    {inRoom && error && !open && <small role="status">Статус записи недоступен</small>}
    {open && <ToolDialog title="Записи встречи" subtitle={conference.title} onClose={() => { setOpen(false); setPlaying(null); }}>
      {error && <div className="ai-notice error" role="alert">{error}</div>}
      {!data && !error && <p role="status">Проверяем записи…</p>}
      {data && <><div className="recording-policy"><p>Запись включается вручную. В файл входят звук и видео встречи, включая демонстрацию экрана. Чат сохраняется отдельно в истории конференции.</p>{active && <strong className="recording-status" role="status">● {statuses[active.status]}</strong>}
        {data.can_record && <div className="ai-run-actions">{active ? <button className="secondary" disabled={busy || active.stop_requested} onClick={() => action(`/${active.id}/stop`)}>{active.stop_requested ? "Ожидаем сохранения…" : "Остановить запись"}</button> : <button className="primary" disabled={busy || !data.enabled || ["completed","cancelled"].includes(conference.status)} onClick={() => { requestId.current ||= crypto.randomUUID(); action("", { request_id: requestId.current, join_code: conference.join_code || undefined }); }}>● Начать запись сейчас</button>}</div>}
        {!data.enabled && <small>Запуск новых записей отключён в конфигурации платформы.</small>}</div>
        {!data.can_view && <div className="ai-notice">Для просмотра файлов и расшифровок нужно право «Просмотр записей и расшифровок конференций».</div>}
        {data.can_view && !data.recordings.length && <div className="ai-empty">У этой встречи пока нет записей.</div>}
        {data.recordings.map((record) => <article className="recording-card" key={record.id}><div className="ai-section-head"><div><strong>Запись #{record.id}</strong><p>{date(record.created_at)} · {statuses[record.status]}{record.duration_seconds ? ` · ${Math.ceil(record.duration_seconds / 60)} мин` : ""}{record.bytes ? ` · ${(record.bytes / 1024 ** 2).toFixed(1)} МБ` : ""}</p></div></div>{record.error_text && <div className="ai-notice">{record.error_text}</div>}
          {record.status === "completed" && <><div className="ai-run-actions"><button className="secondary" onClick={() => setPlaying(playing === record.id ? null : record.id)}>{playing === record.id ? "Закрыть видео" : "Смотреть"}</button><button className="secondary" onClick={() => setWorkbench(record.id)}>Главы и текст</button><a className="secondary" href={`${api}/${record.id}/file${query}${query ? "&" : "?"}download=1`}>Скачать MP4</a></div>{playing === record.id && <video className="recording-player" controls playsInline preload="metadata" src={`${api}/${record.id}/file${query}`}/>}
          <div className="recording-transcript"><strong>{transcripts[record.transcript_status]}</strong>{record.transcript_status === "running" && <span role="status">{record.transcript_completed_chunks} из {record.transcript_chunks || "…"} фрагментов</span>}{record.transcript_error && <p className="error" role="alert">{record.transcript_error}</p>}<div className="ai-run-actions">{data.can_transcribe && ["none","failed"].includes(record.transcript_status) && <button className="secondary" disabled={busy} onClick={() => action(`/${record.id}/transcribe`)}>{record.transcript_status === "failed" ? "Продолжить расшифровку" : "Расшифровать аудио"}</button>}{record.transcript_status === "completed" && <><a className="secondary" href={`${api}/${record.id}/transcript${query}`}>Скачать текст</a>{data.can_transcribe && <button className="primary" onClick={() => setSummary(record.id)}>✦ Изложить встречу с ИИ</button>}</>}</div><small>Готовая расшифровка общая для пользователей с доступом. ИИ анализирует речь; изображение и демонстрация экрана в изложение не входят.</small></div></>}
        </article>)}</>}
    </ToolDialog>}
    {workbench && <RecordingWorkbench conferenceId={conference.id} recordingId={workbench} canManage={data?.can_manage} notify={(text) => setError(text)} onClose={() => setWorkbench(null)}/> }
    {summary && <AiPanel kind="conference" sourceId={conference.id} title={conference.title} joinCode={conference.join_code} initialRecordingId={summary} onClose={() => setSummary(null)}/>}
  </>;
}
