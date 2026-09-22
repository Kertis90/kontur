import crypto from "node:crypto";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { spawn } from "node:child_process";
import { db, one, rows } from "./db.js";
import { getAiSettings, aiProfileKey } from "./ai-settings.js";
import { responseJson, normalizeAiBaseUrl } from "./ai-client.js";
import { storage, bucket, objectInfo } from "./storage.js";
import { assertRecording, recordingConferenceAccess, RecordingError } from "./recordings.js";
import { apiBackgroundAllowed } from "./api-access.js";


function runProgram(command, args, timeout = 3600_000) {
  return new Promise((resolve, reject) => {
    const process = spawn(command, args, { stdio: ["ignore", "pipe", "ignore"], shell: false });
    let output = "";
    const timer = setTimeout(() => { process.kill("SIGKILL"); reject(new RecordingError(504, "Подготовка аудио превысила отведённое время")); }, timeout);
    process.stdout.on("data", (chunk) => { if (output.length < 100000) output += chunk.toString(); });
    process.on("error", () => { clearTimeout(timer); reject(new RecordingError(503, "Для расшифровки worker должен содержать ffmpeg и ffprobe")); });
    process.on("close", (code) => { clearTimeout(timer); if (code === 0) resolve(output); else reject(new RecordingError(422, "Не удалось извлечь аудио из записи")); });
  });
}

export async function transcribeAudioChunk(speech, buffer, fetcher = fetch) {
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: "audio/mpeg" }), "meeting.mp3");
  form.append("model", speech.model); form.append("language", speech.language); form.append("response_format", "json");
  const key = aiProfileKey(speech);
  let response;
  try { response = await fetcher(`${normalizeAiBaseUrl(speech.base_url)}/audio/transcriptions`, { method: "POST", body: form, headers: key ? { Authorization: `Bearer ${key}` } : {}, signal: AbortSignal.timeout(speech.timeout_seconds * 1000), redirect: "error" }); }
  catch { throw new RecordingError(502, "Сервис распознавания речи недоступен или превысил таймаут"); }
  if (!response.ok) { await response.body?.cancel(); throw new RecordingError(502, `Распознавание речи: HTTP ${response.status}. Проверьте endpoint, модель и ключ.`); }
  const value = await responseJson(response, 1_000_000);
  if (typeof value.text !== "string" || value.text.length > 200000) throw new RecordingError(502, "Сервис распознавания вернул некорректный текст");
  return value.text.trim();
}

export async function processRecordingTranscription(recordingId) {
  const [claimed] = await db.query("UPDATE conference_recordings SET transcript_status='running', transcript_heartbeat_at=CURRENT_TIMESTAMP WHERE id=? AND transcript_status='queued'", [recordingId]);
  if (!claimed.affectedRows) return;
  let directory;
  const heartbeat = setInterval(() => rows("UPDATE conference_recordings SET transcript_heartbeat_at=CURRENT_TIMESTAMP WHERE id=? AND transcript_status='running'", [recordingId]).catch(() => {}), 15000);
  try {
    const recording = await one("SELECT * FROM conference_recordings WHERE id=?", [recordingId]);
    const user = await one("SELECT id, workspace_id, global_role FROM users WHERE id=? AND workspace_id=? AND status='active'", [recording.transcript_requested_by, recording.workspace_id]);
    if (!user) throw new RecordingError(403, "Пользователь больше не активен");
    const verify = async () => {
      const currentUser = await one("SELECT status,global_role FROM users WHERE id=? AND workspace_id=?", [user.id, user.workspace_id]);
      if (currentUser?.status !== "active") throw new RecordingError(403, "Пользователь больше не активен");
      Object.assign(user, currentUser);
      if (!(await apiBackgroundAllowed(user, recording.transcript_api_token_id, "ai:write"))) throw new RecordingError(403, "Доступ API-токена к ИИ отозван");
      await assertRecording(user, recording.conference_id, recording.id);
      await recordingConferenceAccess(user, recording.conference_id, "ai.conference.summarize");
      const { speech } = await getAiSettings(user.workspace_id);
      if (currentUser?.status !== "active" || !speech?.enabled || speech.revision !== recording.transcript_profile_revision) throw new RecordingError(409, "Права или настройки распознавания изменились. Повторите запрос");
      return speech;
    };
    await verify();
    const info = await objectInfo(recording.object_key);
    const maxBytes = Math.max(1, Number(process.env.RECORDING_TRANSCRIBE_MAX_GB || 20)) * 1024 ** 3;
    if (Number(info.size) > maxBytes) throw new RecordingError(422, "Запись превышает настроенный лимит размера для расшифровки");
    directory = await mkdtemp(join(process.env.RECORDING_TEMP_DIR || tmpdir(), "kontur-recording-"));
    const video = join(directory, "meeting.mp4");
    let downloaded = 0;
    await pipeline(await storage().getObject(bucket(), recording.object_key), new Transform({ transform(chunk, encoding, callback) { downloaded += chunk.length; callback(downloaded > maxBytes ? new Error("size_limit") : null, chunk); } }), createWriteStream(video), { signal: AbortSignal.timeout(3600_000) });
    const probe = JSON.parse(await runProgram("ffprobe", ["-v", "error", "-protocol_whitelist", "file,pipe", "-show_entries", "format=duration", "-of", "json", video], 60000));
    const duration = Number(probe.format?.duration);
    if (!Number.isFinite(duration) || duration <= 0 || duration > 43200) throw new RecordingError(422, "Расшифровка поддерживает записи длительностью до 12 часов");
    await runProgram("ffmpeg", ["-nostdin", "-v", "error", "-protocol_whitelist", "file,pipe", "-i", video, "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libmp3lame", "-b:a", "64k", "-f", "segment", "-segment_time", "600", "-reset_timestamps", "1", join(directory, "audio-%04d.mp3")]);
    const files = (await readdir(directory)).filter((name) => /^audio-\d{4}\.mp3$/.test(name)).sort();
    if (!files.length || files.length > 73) throw new RecordingError(422, "Не удалось подготовить аудиодорожку");
    await rows("DELETE FROM conference_recording_transcripts WHERE recording_id=? AND profile_revision<>?", [recordingId, recording.transcript_profile_revision]);
    const cached = await rows("SELECT chunk_index, text FROM conference_recording_transcripts WHERE recording_id=? ORDER BY chunk_index", [recordingId]);
    const chunks = new Map(cached.map((item) => [Number(item.chunk_index), item.text]));
    await rows("UPDATE conference_recordings SET transcript_chunks=?, transcript_completed_chunks=? WHERE id=?", [files.length, chunks.size, recordingId]);
    for (let index = 0; index < files.length; index++) {
      if (chunks.has(index)) continue;
      const speech = await verify();
      const file = join(directory, files[index]);
      if ((await stat(file)).size > 20 * 1024 ** 2) throw new RecordingError(422, "Аудиофрагмент превышает лимит распознавания");
      const text = await transcribeAudioChunk(speech, await readFile(file));
      await rows("INSERT INTO conference_recording_transcripts (recording_id,chunk_index,start_seconds,text,profile_revision) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE text=VALUES(text),profile_revision=VALUES(profile_revision)", [recordingId, index, index * 600, text, recording.transcript_profile_revision]);
      chunks.set(index, text);
      await rows("UPDATE conference_recordings SET transcript_completed_chunks=? WHERE id=? AND transcript_status='running'", [chunks.size, recordingId]);
    }
    await verify();
    if (![...chunks.values()].some((text) => text.trim())) throw new RecordingError(422, "В записи не обнаружена распознаваемая речь");
    const revision = crypto.createHash("sha256").update(JSON.stringify([...chunks].sort((a,b) => a[0]-b[0]))).digest("hex");
    await rows("UPDATE conference_recordings SET transcript_status='completed',transcript_revision=?,transcript_completed_at=CURRENT_TIMESTAMP,transcript_error=NULL WHERE id=? AND transcript_status='running'", [revision, recordingId]);
  } catch (error) {
    await rows("UPDATE conference_recordings SET transcript_status='failed',transcript_error=? WHERE id=? AND transcript_status='running'", [error instanceof RecordingError ? error.message : "Не удалось обработать запись. Проверьте S3, место на диске worker и настройки распознавания; готовые фрагменты сохранены.", recordingId]);
  } finally {
    clearInterval(heartbeat);
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}
