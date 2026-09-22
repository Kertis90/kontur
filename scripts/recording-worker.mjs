import {runtimeHeartbeat} from '../src/lib/runtime-heartbeat.js';
import { Worker, Queue } from "bullmq";
import IORedis from "ioredis";
import { db, rows } from "../src/lib/db.js";
import { reconcileRecordings } from "../src/lib/recordings.js";
import { processRecordingTranscription } from "../src/lib/recording-transcription.js";

const stopHeartbeat=runtimeHeartbeat('recording-worker');
const connection = new IORedis(process.env.REDIS_URL || "redis://127.0.0.1:6379", { maxRetriesPerRequest: null });
const queue = new Queue("kontur-recordings", { connection, defaultJobOptions: { attempts: 1, removeOnComplete: true, removeOnFail: true } });
const worker = new Worker("kontur-recordings", (job) => processRecordingTranscription(job.data.recordingId), { connection, concurrency: Math.max(1, Math.min(4, Number(process.env.RECORDING_WORKER_CONCURRENCY || 1))), maxStalledCount: 0 });
worker.on("failed", (job) => rows("UPDATE conference_recordings SET transcript_status='failed',transcript_error='Worker прерван. Повторите запрос; готовые фрагменты сохранены.' WHERE id=? AND transcript_status IN ('queued','running')", [job?.data.recordingId || 0]).catch(() => {}));
let polling = false;
async function poll() {
  if (polling) return;
  polling = true;
  try {
    await reconcileRecordings();
    await rows("UPDATE conference_recordings SET transcript_status='failed',transcript_error='Worker недоступен. Повторите запрос; готовые фрагменты сохранены.' WHERE transcript_status='running' AND transcript_heartbeat_at<DATE_SUB(CURRENT_TIMESTAMP,INTERVAL 10 MINUTE)");
    for (const record of await rows("SELECT id FROM conference_recordings WHERE transcript_status='queued' ORDER BY id LIMIT 100")) await queue.add("transcribe", { recordingId: record.id }, { jobId: `recording-${record.id}` });
  } catch (error) { console.error("Recording reconciliation unavailable", error?.code || "connection_error"); }
  finally { polling = false; }
}
const timer = setInterval(poll, 10000);
await poll();
console.log("Kontur recording worker: Egress reconciliation and cached transcription");
async function shutdown() { await stopHeartbeat(); clearInterval(timer); await worker.close(); await queue.close(); await connection.quit(); await db.end(); process.exit(0); }
process.on("SIGTERM", shutdown); process.on("SIGINT", shutdown);
