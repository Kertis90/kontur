import {readAgentIdentity} from './agent-identity-policy.js';
import crypto from "node:crypto";
import { EgressClient, EncodedFileOutput, EncodedFileType, S3Upload } from "livekit-server-sdk";
import { one, rows, transaction } from "./db.js";
import { hasProjectPermission, projectPermissionSet } from "./permissions.js";
import { bucket, objectInfo } from "./storage.js";

export class RecordingError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const recordingEnabled = () => process.env.RECORDING_ENABLED === "true";
const activeStatuses = ["starting", "recording", "stopping"];
const columns = "id, conference_id, status, stop_requested, error_text, bytes, duration_seconds, created_at, started_at, completed_at, transcript_status, transcript_error, transcript_chunks, transcript_completed_chunks, transcript_completed_at";
export function egressClient() {
  if (!process.env.LIVEKIT_API_URL || !process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET)
    throw new RecordingError(503, "Сервер конференций не настроен");
  return new EgressClient(process.env.LIVEKIT_API_URL, process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET);
}

export async function recordingConferenceAccess(user, conferenceId, permission = null, joinCode = null) {
  const conference = await one("SELECT c.* FROM conferences c JOIN projects p ON p.id=c.project_id WHERE c.id=? AND c.workspace_id=? AND p.deleted_at IS NULL", [conferenceId, user.workspace_id]);
  if (!conference) throw new RecordingError(404, "Конференция не найдена");
  const identity=await readAgentIdentity(user);if(identity&&!identity.policy.conference_ids?.includes(Number(conferenceId)))throw new RecordingError(403,'Встреча запрещена учётной записи агента');
  const invited = await one("SELECT user_id FROM conference_participants WHERE conference_id=? AND user_id=?", [conferenceId, user.id]);
  const linked = conference.join_policy === "link" && joinCode && conference.join_code === joinCode;
  if (!invited && Number(conference.created_by) !== Number(user.id) && !linked && !(await hasProjectPermission(user, conference.project_id, "conference.manage")))
    throw new RecordingError(403, "Нет доступа к конференции");
  if (permission && !(await hasProjectPermission(user, conference.project_id, permission)))
    throw new RecordingError(403, "Недостаточно прав для работы с записью конференции");
  return conference;
}

export async function assertRecording(user, conferenceId, recordingId, joinCode) {
  await recordingConferenceAccess(user, conferenceId, "conference.recording.view", joinCode);
  const recording = await one("SELECT * FROM conference_recordings WHERE id=? AND conference_id=? AND workspace_id=?", [recordingId, conferenceId, user.workspace_id]);
  if (!recording || recording.deleted_at || (recording.retained_until && Date.parse(recording.retained_until) <= Date.now())) throw new RecordingError(404, "Запись не найдена или срок хранения истёк");
  return recording;
}

export async function listRecordings(user, conferenceId, joinCode) {
  const conference = await recordingConferenceAccess(user, conferenceId, null, joinCode);
  const permissions = await projectPermissionSet(user, conference.project_id);
  const canView = permissions.has("conference.recording.view");
  const canRecord = permissions.has("conference.record");
  const active = await one(`SELECT id, status, stop_requested FROM conference_recordings WHERE conference_id=? AND status IN ('starting','recording','stopping')`, [conferenceId]);
  return { enabled: recordingEnabled(), can_record: canRecord, can_view: canView,
    can_manage: permissions.has("conference.manage"), can_transcribe: canView && permissions.has("ai.conference.summarize"),
    active, recordings: canView ? await rows(`SELECT ${columns} FROM conference_recordings WHERE conference_id=? AND deleted_at IS NULL AND (retained_until IS NULL OR retained_until>CURRENT_TIMESTAMP) ORDER BY id DESC LIMIT 100`, [conferenceId]) : [] };
}

export function egressContainsKey(info, key) {
  const visit = (value) => value && typeof value === "object" && (value.filepath === key || value.filename === key || Object.values(value).some((item) => typeof item === "object" && visit(item)));
  return Boolean(visit(info.request) || info.fileResults?.some((file) => file.filename === key));
}

export async function syncRecording(recording, info) {
  if (!activeStatuses.includes(recording.status)) return;
  if (recording.egress_id && recording.egress_id !== info.egressId) return;
  if (!recording.egress_id && !egressContainsKey(info, recording.object_key)) return;
  let status = ["starting", "recording", "stopping", "completed", "failed", "failed", "completed"][info.status];
  if (!status) return;
  let bytes = null, duration = null, error = null;
  if (status === "completed") {
    // A successful Egress response alone is insufficient: the private S3 object must exist.
    const file = info.fileResults?.find((item) => item.filename === recording.object_key);
    if (!file || info.backupStorageUsed) { status = "failed"; error = "Запись не сохранена в основном S3. Проверьте Egress и резервное хранилище."; }
    else {
      try { bytes = Number((await objectInfo(recording.object_key)).size); }
      catch { return; } // A temporary storage outage is retried by reconciliation.
      duration = Math.max(0, Math.round(Number(file.duration) / 1e9));
      if (!bytes) { status = "failed"; error = "Сервис записи сохранил пустой файл"; }
      if (info.status === 6) error = "Запись остановлена по лимиту сервиса; сохранена доступная часть встречи";
    }
  }
  if (status === "failed" && !error) error = "Сервис записи завершился с ошибкой. Проверьте журналы Egress и доступ к S3.";
  // Never regress to starting/recording after a stop has been requested.
  if (recording.stop_requested && ["starting", "recording"].includes(status)) status = "stopping";
  await rows(`UPDATE conference_recordings SET egress_id=?, status=IF((stop_requested=TRUE OR status='stopping') AND ? IN ('starting','recording'),'stopping',?), bytes=COALESCE(?,bytes), duration_seconds=COALESCE(?,duration_seconds), error_text=?,
    started_at=COALESCE(started_at, ?), completed_at=IF(? IN ('completed','failed'),CURRENT_TIMESTAMP,completed_at)
    WHERE id=? AND status IN ('starting','recording','stopping')`, [info.egressId, status, status, bytes, duration, error, Number(info.startedAt) > 0 ? new Date(Number(info.startedAt) / 1e6) : null, status, recording.id]);
}

export async function startRecording(user, conferenceId, requestId, joinCode) {
  const conference = await recordingConferenceAccess(user, conferenceId, "conference.record", joinCode);
  if (!recordingEnabled()) throw new RecordingError(409, "Запись отключена. Администратору нужно включить Egress и S3");
  if (["completed", "cancelled"].includes(conference.status) || !conference.media_room_ready_at)
    throw new RecordingError(409, "Сначала подключитесь к действующей конференции");
  const reservation = await transaction(async (connection) => {
    await connection.query("SELECT id FROM conferences WHERE id=? FOR UPDATE", [conferenceId]);
    const [previous] = await connection.query("SELECT * FROM conference_recordings WHERE workspace_id=? AND request_id=?", [user.workspace_id, requestId]);
    if (previous.length) {
      if (Number(previous[0].conference_id) !== conferenceId || Number(previous[0].created_by) !== Number(user.id)) throw new RecordingError(409, "request_id уже использован");
      return { record: previous[0], existing: true };
    }
    const [active] = await connection.query("SELECT id FROM conference_recordings WHERE conference_id=? AND status IN ('starting','recording','stopping')", [conferenceId]);
    if (active.length) throw new RecordingError(409, "Встреча уже записывается или запись завершается");
    const key = `workspaces/${user.workspace_id}/conferences/${conferenceId}/recordings/${crypto.randomUUID()}.mp4`;
    const [insert] = await connection.query("INSERT INTO conference_recordings (workspace_id,conference_id,created_by,request_id,object_key) VALUES (?,?,?,?,?)", [user.workspace_id, conferenceId, user.id, requestId, key]);
    const retentionDays = Number(process.env.RECORDING_RETENTION_DAYS || 0);
    if (Number.isFinite(retentionDays) && retentionDays > 0) await connection.query("UPDATE conference_recordings SET retained_until=DATE_ADD(CURRENT_TIMESTAMP,INTERVAL ? DAY) WHERE id=?", [Math.min(36500,Math.floor(retentionDays)),insert.insertId]);
    const [created] = await connection.query("SELECT * FROM conference_recordings WHERE id=?", [insert.insertId]);
    return { record: created[0], existing: false };
  });
  if (!reservation.existing) {
    const output = new EncodedFileOutput({ fileType: EncodedFileType.MP4, filepath: reservation.record.object_key, disableManifest: true,
      output: { case: "s3", value: new S3Upload({ accessKey: process.env.S3_ACCESS_KEY || "", secret: process.env.S3_SECRET_KEY || "", region: process.env.S3_REGION || "us-east-1", endpoint: process.env.S3_ENDPOINT || "", bucket: bucket(), forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false" }) } });
    try {
      const info = await egressClient().startRoomCompositeEgress(conference.room_key, output, { layout: "speaker" });
      await syncRecording(reservation.record, info);
    } catch {
      // An RPC timeout does not prove that recording failed to start. Recover by its generated S3 path.
      await rows("UPDATE conference_recordings SET error_text='Проверяем запуск записи на сервере…' WHERE id=? AND status='starting'", [reservation.record.id]);
    }
  }
  return one(`SELECT ${columns} FROM conference_recordings WHERE id=?`, [reservation.record.id]);
}

export async function stopRecording(user, conferenceId, recordingId, joinCode) {
  await recordingConferenceAccess(user, conferenceId, "conference.record", joinCode);
  const recording = await one("SELECT * FROM conference_recordings WHERE id=? AND conference_id=? AND workspace_id=?", [recordingId, conferenceId, user.workspace_id]);
  if (!recording || recording.deleted_at || (recording.retained_until && Date.parse(recording.retained_until) <= Date.now())) throw new RecordingError(404, "Запись не найдена или срок хранения истёк");
  if (activeStatuses.includes(recording.status)) {
    await rows("UPDATE conference_recordings SET stop_requested=TRUE, status='stopping' WHERE id=? AND status IN ('starting','recording','stopping')", [recording.id]);
    if (recording.egress_id) {
      try { await syncRecording({ ...recording, stop_requested: true }, await egressClient().stopEgress(recording.egress_id)); }
      catch { /* Persisted stop intent is retried independently of this browser request. */ }
    }
  }
  return one(`SELECT ${columns} FROM conference_recordings WHERE id=?`, [recording.id]);
}

export async function reconcileRecordings() {
  const pending = await rows(`SELECT r.*, c.room_key, c.status AS conference_status, p.deleted_at AS project_deleted
    FROM conference_recordings r JOIN conferences c ON c.id=r.conference_id JOIN projects p ON p.id=c.project_id
    WHERE r.status IN ('starting','recording','stopping') ORDER BY r.id LIMIT 100`);
  for (const record of pending) {
    try {
      const client = egressClient();
      const list = await client.listEgress(record.egress_id ? { egressId: record.egress_id } : { roomName: record.room_key });
      let info = list.find((item) => record.egress_id ? item.egressId === record.egress_id : egressContainsKey(item, record.object_key));
      if (!info) {
        if (!record.egress_id && Date.now() - new Date(record.created_at).getTime() > 5 * 60_000)
          await rows("UPDATE conference_recordings SET status='failed', error_text='Сервис Egress не подтвердил запуск. Проверьте его доступность и повторите.', completed_at=CURRENT_TIMESTAMP WHERE id=? AND egress_id IS NULL AND status IN ('starting','stopping')", [record.id]);
        continue;
      }
      const ended = ["completed", "cancelled"].includes(record.conference_status) || record.project_deleted;
      if ((record.stop_requested || ended) && info.status < 2) {
        await rows("UPDATE conference_recordings SET stop_requested=TRUE, status='stopping' WHERE id=? AND status IN ('starting','recording','stopping')", [record.id]);
        record.stop_requested = true;
        info = await client.stopEgress(info.egressId);
      }
      await syncRecording(record, info);
    } catch { /* Keep the last known state on media/storage outages; retry without creating another recording. */ }
  }
}
