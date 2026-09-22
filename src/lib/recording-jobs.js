import { transaction } from "./db.js";
import { getAiSettings } from "./ai-settings.js";
import { assertRecording, recordingConferenceAccess, RecordingError } from "./recordings.js";

export async function queueRecordingTranscription(user, conferenceId, recordingId, joinCode) {
  const recording = await assertRecording(user, conferenceId, recordingId, joinCode);
  await recordingConferenceAccess(user, conferenceId, "ai.conference.summarize", joinCode);
  if (recording.status !== "completed") throw new RecordingError(409, "Дождитесь сохранения записи в S3");
  if (recording.transcript_status === "completed") return { cached: true, status: "completed" };
  const { speech } = await getAiSettings(user.workspace_id);
  if (!speech?.enabled || !speech.base_url || !speech.model) throw new RecordingError(409, "Настройте распознавание речи в разделе «Искусственный интеллект»");
  return transaction(async (connection) => {
    await connection.query("SELECT id FROM workspaces WHERE id=? FOR UPDATE", [user.workspace_id]);
    const [current] = await connection.query("SELECT transcript_status FROM conference_recordings WHERE id=? FOR UPDATE", [recordingId]);
    if (["queued", "running", "completed"].includes(current[0].transcript_status)) return { cached: true, status: current[0].transcript_status };
    const [pending] = await connection.query("SELECT COUNT(*) AS value FROM conference_recordings WHERE transcript_requested_by=? AND transcript_status IN ('queued','running')", [user.id]);
    if (Number(pending[0].value) >= 2) throw new RecordingError(429, "Дождитесь завершения предыдущих расшифровок");
    await connection.query("INSERT INTO conference_participants (conference_id,user_id,participant_role,response) VALUES (?,?,'participant','accepted') ON DUPLICATE KEY UPDATE user_id=user_id", [conferenceId, user.id]);
    await connection.query("UPDATE conference_recordings SET transcript_status='queued', transcript_requested_by=?, transcript_api_token_id=?, transcript_profile_revision=?, transcript_error=NULL WHERE id=?", [user.id, user.api_token_id || null, speech.revision, recordingId]);
    return { cached: false, status: "queued" };
  });
}
