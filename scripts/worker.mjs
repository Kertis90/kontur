import {enqueueAgentEvent,pollAgentRuns} from '../src/lib/agent-runtime.js';
import {pollBrowserPush} from '../src/lib/browser-push.js';
import {runtimeHeartbeat} from '../src/lib/runtime-heartbeat.js';
import {pollJiraImports} from '../src/lib/work-jira-import.js';
import {pollJiraTransfers} from '../src/lib/jira-transfer-worker.js';
import {pollSemanticJobs} from '../src/lib/work-semantic.js';
import {pollExternalSync} from '../src/lib/external-sync.js';
import {scanSlaNotifications} from '../src/lib/sla-notifications.js';
import {enqueueIntegrationEvent,pollIntegrationDeliveries} from '../src/lib/integration-delivery.js';
import {deliverDashboardReports} from '../src/lib/work-analytics.js';
import { scheduledDirectorySync } from '../src/lib/work-directory.js';
import { approvalReminders } from "../src/lib/work-planning.js";
import { knowledgeReviewReminders } from "../src/lib/work-knowledge.js";
import { scheduleAutomations } from "../src/lib/work-automation.js";
import { processWorkAiJob } from "../src/lib/work-ai.js";
import { purgeExpiredRecordings } from "../src/lib/work-recordings.js";
import { deliverPersonalDigests } from "../src/lib/work-personal.js";
import { importPlan, executeImport } from "../src/lib/work-import.js";
import { Worker } from "bullmq";
import IORedis from "ioredis";
import { db, one, rows } from "../src/lib/db.js";
import { deliverWebhooks, runAutomationsForEvent } from "../src/lib/automation.js";
import { getEventsQueue, getAiQueue } from "../src/lib/queue.js";
import { processAiJob } from "../src/lib/ai-service.js";
import { readObject } from "../src/lib/storage.js";
import { emitEvent } from "../src/lib/events.js";

const stopHeartbeat=runtimeHeartbeat('worker');
const connection = new IORedis(process.env.REDIS_URL || "redis://127.0.0.1:6379", { maxRetriesPerRequest: null });

async function processEvent(job) {
  const event = await one("SELECT * FROM outbox_events WHERE event_uuid = ?", [job.data.eventUuid]);
  if (!event) return { skipped: "event_not_found" };
  await enqueueIntegrationEvent(event);
  await enqueueAgentEvent(event);
  const [automation, webhooks] = await Promise.all([runAutomationsForEvent(event), deliverWebhooks(event)]);
  return { automation, webhooks };
}

async function processImport(job) {
  const item = await one("SELECT * FROM import_jobs WHERE id=?", [job.data.importJobId]);
  if (!item || item.status === "succeeded") return { skipped: true };
  await rows("UPDATE import_jobs SET status='running',started_at=CURRENT_TIMESTAMP WHERE id=?", [item.id]);
  try {
    const user = await one("SELECT * FROM users WHERE id=? AND workspace_id=? AND status='active'", [item.requested_by,item.workspace_id]);
    if (!user) throw new Error("Пользователь импорта отключён");
    const options = typeof item.options_json === "string" ? JSON.parse(item.options_json) : item.options_json;
    const data = { project_id: options.project_id, source: item.source_type, text: (await readObject(item.object_key, 2500000)).toString("utf8"), mapping: options.mapping || {}, stages: options.stages || {} };
    const result = await executeImport(user, data, await importPlan(user, data));
    await rows("UPDATE import_jobs SET status='succeeded',result_json=?,finished_at=CURRENT_TIMESTAMP WHERE id=?", [JSON.stringify(result),item.id]);
    return result;
  } catch (error) {
    await rows("UPDATE import_jobs SET status='failed',error_text=?,finished_at=CURRENT_TIMESTAMP WHERE id=?", [error.status ? error.message : "Импорт не выполнен: проверьте файл, проект и доступ",item.id]);
    throw error;
  }
}

async function scanDeadlines() {
  const dueTasks = await rows(`SELECT t.id, t.project_id, t.assignee_id, t.title, t.due_date, p.workspace_id
                               FROM tasks t JOIN projects p ON p.id=t.project_id JOIN workflow_stages ws ON ws.id=t.stage_id
                               WHERE ws.is_done=FALSE AND t.due_date BETWEEN CURRENT_DATE AND DATE_ADD(CURRENT_DATE, INTERVAL 2 DAY)`);
  for (const task of dueTasks) await emitEvent({ workspaceId: task.workspace_id, eventType: "task.due_soon", aggregateType: "task", aggregateId: task.id, payload: { task_id: task.id, project_id: task.project_id, assignee_id: task.assignee_id, title: task.title, due_date: task.due_date } });
  return { scanned: dueTasks.length };
}

async function scanConferenceReminders() {
  const conferences = await rows(`SELECT conference.id, conference.title, conference.scheduled_start
    FROM conferences conference WHERE conference.status='scheduled' AND conference.reminder_sent_at IS NULL
      AND conference.scheduled_start BETWEEN CURRENT_TIMESTAMP AND DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 15 MINUTE)`);
  for (const conference of conferences) {
    const participants = await rows("SELECT user_id FROM conference_participants WHERE conference_id=? AND response<>'declined'", [conference.id]);
    for (const participant of participants) await rows("INSERT INTO user_notifications (user_id, event_type, title, body, entity_type, entity_id, action_url) VALUES (?, 'conference.reminder', ?, ?, 'conference', ?, '/')", [participant.user_id, `Скоро встреча: ${conference.title}`, `Начало ${conference.scheduled_start}`, conference.id]);
    await rows("UPDATE conferences SET reminder_sent_at=CURRENT_TIMESTAMP WHERE id=? AND reminder_sent_at IS NULL", [conference.id]);
  }
  return { reminded: conferences.length };
}

async function transcribeVoice(job) {
  const voice = await one("SELECT * FROM comment_voice_attachments WHERE id=?", [job.data.voiceId]);
  if (!voice) return { skipped: "voice_not_found" };
  if (voice.transcript_status === "completed") return { cached: true };
  if (!process.env.STT_API_URL) throw new Error("STT_API_URL не настроен");
  try {
    const audio = await readObject(voice.object_key, 25 * 1024 * 1024);
    const form = new FormData();
    const extension = String(voice.mime_type).includes("mp4") ? "m4a" : String(voice.mime_type).includes("ogg") ? "ogg" : "webm";
    form.append("file", new Blob([audio], { type: voice.mime_type || "audio/webm" }), `comment-${voice.comment_id}.${extension}`);
    form.append("model", process.env.STT_MODEL || "whisper-1");
    form.append("language", process.env.STT_LANGUAGE || "ru");
    const headers = process.env.STT_API_KEY ? { authorization: `Bearer ${process.env.STT_API_KEY}` } : {};
    const response = await fetch(process.env.STT_API_URL, { method: "POST", headers, body: form, signal: AbortSignal.timeout(Number(process.env.STT_TIMEOUT_MS || 120000)) });
    if (!response.ok) throw new Error(`Сервис распознавания вернул HTTP ${response.status}`);
    const payload = await response.json();
    const transcript = String(payload.text || payload.transcript || "").trim();
    if (!transcript) throw new Error("Сервис распознавания вернул пустой текст");
    await rows("UPDATE comment_voice_attachments SET transcript_status='completed', transcript_text=?, transcript_error=NULL, transcript_updated_at=CURRENT_TIMESTAMP WHERE id=?", [transcript, voice.id]);
    return { cached: false, characters: transcript.length };
  } catch (error) {
    await rows("UPDATE comment_voice_attachments SET transcript_status='failed', transcript_error=?, transcript_updated_at=CURRENT_TIMESTAMP WHERE id=?", [String(error.message || error).slice(0, 1000), voice.id]);
    throw error;
  }
}

const worker = new Worker("kontur-events", async (job) => {
  if (job.name === "domain-event") return processEvent(job);
  if (job.name === "import") return processImport(job);
  if (job.name === "scheduled-scan") return scanDeadlines();
  if (job.name === "transcribe-voice") return transcribeVoice(job);
  if (job.name === "work-maintenance") {
    await scanSlaNotifications();
    await scheduleAutomations();
    await approvalReminders();
    await knowledgeReviewReminders();
    await deliverPersonalDigests();
    await deliverDashboardReports();
    await scheduledDirectorySync();
    await rows("DELETE FROM knowledge_cursors WHERE seen_at<DATE_SUB(CURRENT_TIMESTAMP,INTERVAL 1 MINUTE)");
    await rows("DELETE FROM task_undo_actions WHERE expires_at<CURRENT_TIMESTAMP");
    await rows("DELETE FROM auth_challenges WHERE expires_at<CURRENT_TIMESTAMP");
    await rows("DELETE FROM security_rate_limits WHERE updated_at<DATE_SUB(CURRENT_TIMESTAMP,INTERVAL 1 DAY)");
    await rows("DELETE FROM user_sessions WHERE expires_at<DATE_SUB(CURRENT_TIMESTAMP,INTERVAL 30 DAY)");
    await purgeExpiredRecordings();
    await rows("UPDATE project_access_requests SET status='expired' WHERE status='approved' AND expires_at<=CURRENT_TIMESTAMP");
    return { ok: true };
  }
  if (job.name === "conference-reminders") return scanConferenceReminders();
  throw new Error(`Неизвестный тип фоновой задачи: ${job.name}`);
}, { connection, concurrency: Number(process.env.WORKER_CONCURRENCY || 8), limiter: { max: 100, duration: 1000 } });

worker.on("completed", (job) => console.log(`Job ${job.id} completed`));
worker.on("failed", (job, error) => console.error(`Job ${job?.id} failed`, error));

let polling = false;
async function pollOutbox() {
  if (polling) return;
  polling = true;
  try {
    const events = await rows("SELECT * FROM outbox_events WHERE processed_at IS NULL AND available_at <= CURRENT_TIMESTAMP ORDER BY id LIMIT 100");
    const queue = getEventsQueue();
    for (const event of events) {
      await queue.add("domain-event", { eventUuid: event.event_uuid }, { jobId: event.event_uuid });
      await rows("UPDATE outbox_events SET processed_at=CURRENT_TIMESTAMP, attempts=attempts+1 WHERE id=? AND processed_at IS NULL", [event.id]);
    }
  } catch (error) {
    console.error("Outbox polling failed", error);
  } finally { polling = false; }
}

const timer = setInterval(pollOutbox, Number(process.env.OUTBOX_POLL_MS || 2000));
// AI has its own queue so a slow model does not occupy notification workers.
const aiWorker = new Worker("kontur-ai", (job) => job.name === "work-generate" ? processWorkAiJob(job.data.workAiJobId) : processAiJob(job.data.aiJobId), {
  connection,
  concurrency: Math.max(1, Math.min(8, Number(process.env.AI_WORKER_CONCURRENCY || 2))),
  maxStalledCount: 0,
});
aiWorker.on("failed", (job) => {
  rows("UPDATE ai_jobs SET status='failed', error_text='Обработка прервана. Запустите анализ заново', input_json=NULL, completed_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('queued','running')", [job?.data.aiJobId || 0]).catch(() => {});
});
let aiPolling = false;
async function pollAiJobs() {
  if (aiPolling) return;
  aiPolling = true;
  try {
    await rows("UPDATE ai_jobs SET status='failed', error_text='Обработка прервана. Запустите анализ заново', input_json=NULL, completed_at=CURRENT_TIMESTAMP WHERE status='running' AND COALESCE(heartbeat_at,started_at)<DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 20 MINUTE)");
    await rows("UPDATE work_ai_jobs SET status='failed',error_text='Обработка прервана. Запустите извлечение заново' WHERE status='running' AND heartbeat_at<DATE_SUB(CURRENT_TIMESTAMP,INTERVAL 20 MINUTE)");
    const pendingWork = await rows("SELECT id FROM work_ai_jobs WHERE status='queued' ORDER BY id LIMIT 100");
    for (const job of pendingWork) await getAiQueue().add("work-generate", { workAiJobId: job.id }, { jobId: `work-ai-${job.id}` });
    const pending = await rows("SELECT id FROM ai_jobs WHERE status='queued' ORDER BY id LIMIT 100");
    for (const job of pending) await getAiQueue().add("generate", { aiJobId: job.id }, { jobId: `ai-${job.id}` });
  } catch (error) { console.error("AI queue polling failed", error?.code || "unavailable"); }
  finally { aiPolling = false; }
}
let integrationPolling=null;
function pollIntegrations(){
  if(integrationPolling)return integrationPolling;
  integrationPolling=pollIntegrationDeliveries().catch(()=>console.error('Integration delivery polling failed')).finally(()=>{integrationPolling=null;});
  return integrationPolling;
}
let jiraPolling=null;
// Продолжает импорт из файлов и поэтапный переезд Jira, не допуская пересечения проходов.
function pollJira(){if(jiraPolling)return jiraPolling;jiraPolling=Promise.all([pollJiraImports(),pollJiraTransfers()]).catch(()=>console.error('Jira import polling failed')).finally(()=>{jiraPolling=null;});return jiraPolling;}
let pushPolling=null;
function pollPush(){if(pushPolling)return pushPolling;pushPolling=pollBrowserPush().catch(()=>console.error('Browser push polling failed')).finally(()=>{pushPolling=null;});return pushPolling;}
let agentPolling=null;
function pollAgents(){if(agentPolling)return agentPolling;agentPolling=pollAgentRuns().catch(()=>console.error('AI agent polling failed')).finally(()=>{agentPolling=null;});return agentPolling;}
const agentTimer=setInterval(pollAgents,15000);
const pushTimer=setInterval(pollPush,15000);
const jiraTimer=setInterval(pollJira,1000);
let semanticPolling=null;
function pollSemantic(){if(semanticPolling)return semanticPolling;semanticPolling=pollSemanticJobs().catch(()=>console.error('Semantic indexing polling failed')).finally(()=>{semanticPolling=null;});return semanticPolling;}
const semanticTimer=setInterval(pollSemantic,3000);
let syncPolling=null;
function pollSync(){if(syncPolling)return syncPolling;syncPolling=pollExternalSync().catch(()=>console.error('External sync polling failed')).finally(()=>{syncPolling=null;});return syncPolling;}
const syncTimer=setInterval(pollSync,10000);
const integrationTimer=setInterval(pollIntegrations,2000);
await pollIntegrations();
const aiTimer = setInterval(pollAiJobs, 5000);
await pollAiJobs();
await pollOutbox();
await getEventsQueue().add("scheduled-scan", {}, { jobId: "daily-deadline-scan", repeat: { pattern: "0 8 * * *" } });
await getEventsQueue().add("conference-reminders", {}, { jobId: "conference-reminders", repeat: { pattern: "*/1 * * * *" } });
await getEventsQueue().add("work-maintenance", {}, { jobId: "work-maintenance", repeat: { pattern: "*/1 * * * *" } });
console.log("Kontur worker запущен: automation, webhooks, notifications, imports, voice transcription");

async function shutdown(signal) {
  await stopHeartbeat();
  console.log(`Получен ${signal}, завершаем worker`);
  clearInterval(timer);
  clearInterval(aiTimer);
  clearInterval(integrationTimer);
  clearInterval(syncTimer);
  clearInterval(semanticTimer);
  clearInterval(jiraTimer);
  clearInterval(pushTimer);
  clearInterval(agentTimer);
  await agentPolling;
  await pushPolling;
  await jiraPolling;
  await semanticPolling;
  await syncPolling;
  await integrationPolling;
  await aiWorker.close();
  await worker.close();
  await connection.quit();
  await db.end();
  process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
