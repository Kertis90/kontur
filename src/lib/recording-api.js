import crypto from "node:crypto";
import { Readable } from "node:stream";
import { z } from "zod";
import { rows } from "./db.js";
import { audit } from "./audit.js";
import { storage, bucket, objectInfo } from "./storage.js";
import { listRecordings, startRecording, stopRecording, assertRecording, RecordingError } from "./recordings.js";
import { queueRecordingTranscription } from "./recording-jobs.js";

const id = z.coerce.number().int().positive().safe();
const send = (value, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "private, no-store" } });
export function recordingByteRange(value, size) {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) return false;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && start <= end && end < size ? { start, end } : false;
}

export async function handleRecordingApi(request, path, user) {
  const conferenceId = id.parse(path[1]);
  const url = new URL(request.url);
  const joinCode = url.searchParams.get("join_code") || undefined;
  if (path.length === 3 && request.method === "GET") return send(await listRecordings(user, conferenceId, joinCode));
  if (path.length === 3 && request.method === "POST") {
    const data = z.object({ request_id: z.string().uuid().default(() => crypto.randomUUID()), join_code: z.string().uuid().optional() }).parse(await request.json());
    const record = await startRecording(user, conferenceId, data.request_id, data.join_code || joinCode);
    await audit(user, "conference.recording.start", "conference", conferenceId, { recording_id: record.id }, request);
    return send(record, 202);
  }
  const recordingId = id.parse(path[3]);
  if (path.length === 5 && path[4] === "stop" && request.method === "POST") {
    const record = await stopRecording(user, conferenceId, recordingId, joinCode);
    await audit(user, "conference.recording.stop", "conference", conferenceId, { recording_id: recordingId }, request);
    return send(record, 202);
  }
  if (path.length === 5 && path[4] === "transcribe" && request.method === "POST") {
    const result = await queueRecordingTranscription(user, conferenceId, recordingId, joinCode);
    if (!result.cached) await audit(user, "conference.recording.transcribe", "conference", conferenceId, { recording_id: recordingId }, request);
    return send(result, result.status === "completed" ? 200 : 202);
  }
  const record = await assertRecording(user, conferenceId, recordingId, joinCode);
  if (path.length === 5 && path[4] === "transcript" && request.method === "GET") {
    if (record.transcript_status !== "completed") throw new RecordingError(409, "Расшифровка ещё не готова");
    const chunks = await rows("SELECT start_seconds,text FROM conference_recording_transcripts WHERE recording_id=? ORDER BY chunk_index", [recordingId]);
    return new Response("\ufeff" + chunks.map((part) => `[${Math.floor(part.start_seconds / 3600)}:${String(Math.floor(part.start_seconds / 60) % 60).padStart(2,"0")}:00]\n${part.text}`).join("\n\n"), { headers: { "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": `attachment; filename="conference-${conferenceId}-recording-${recordingId}.txt"`, "Cache-Control": "private, no-store" } });
  }
  if (path.length === 5 && path[4] === "file" && request.method === "GET") {
    if (record.status !== "completed") throw new RecordingError(409, "Запись ещё не готова");
    const size = Number((await objectInfo(record.object_key)).size);
    const range = recordingByteRange(request.headers.get("range"), size);
    if (range === false) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    const stream = range ? await storage().getPartialObject(bucket(), record.object_key, range.start, range.end - range.start + 1) : await storage().getObject(bucket(), record.object_key);
    request.signal.addEventListener("abort", () => stream.destroy(), { once: true });
    return new Response(Readable.toWeb(stream), { status: range ? 206 : 200, headers: { "Content-Type": "video/mp4", "Accept-Ranges": "bytes", "Content-Length": String(range ? range.end - range.start + 1 : size), ...(range ? { "Content-Range": `bytes ${range.start}-${range.end}/${size}` } : {}), "Content-Disposition": `${url.searchParams.get("download") === "1" ? "attachment" : "inline"}; filename="conference-${conferenceId}-${recordingId}.mp4"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  }
  throw new RecordingError(404, "Метод записей конференции не найден");
}
