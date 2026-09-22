import crypto from "node:crypto";
import { one, rows, parseJson, transaction } from "./db.js";
import { encryptSecret, decryptSecret } from "./crypto.js";
import { aiSettingsSchema, AiError } from "./ai-client.js";

export const EMPTY_AI_SETTINGS = { enabled: false, daily_user_limit: 30, profiles: [], project_profile_id: null, conference_profile_id: null, speech: { enabled: false, base_url: "", model: "whisper-1", language: "ru", timeout_seconds: 180 } };

export async function getAiSettings(workspaceId) {
  const value = await one("SELECT value_json FROM system_settings WHERE workspace_id=? AND category='ai'", [workspaceId]);
  return { ...EMPTY_AI_SETTINGS, ...parseJson(value?.value_json, {}) };
}

export function publicAiSettings(config) {
  const { api_key_encrypted, ...speech } = config.speech || EMPTY_AI_SETTINGS.speech;
  return { ...config, speech: { ...speech, api_key_configured: Boolean(api_key_encrypted) }, profiles: config.profiles.map(({ api_key_encrypted, ...profile }) => ({ ...profile, api_key_configured: Boolean(api_key_encrypted) })) };
}

export async function saveAiSettings(workspaceId, value, userId) {
  const parsed = aiSettingsSchema.parse(value);
  return transaction(async (connection) => {
    await connection.query("SELECT id FROM workspaces WHERE id=? FOR UPDATE", [workspaceId]);
    const [stored] = await connection.query("SELECT value_json FROM system_settings WHERE workspace_id=? AND category='ai'", [workspaceId]);
    const current = parseJson(stored[0]?.value_json, EMPTY_AI_SETTINGS);
    const next = { ...parsed, profiles: parsed.profiles.map(({ api_key, clear_api_key, ...profile }) => {
      const previous = current.profiles?.find((item) => item.id === profile.id);
      const api_key_encrypted = clear_api_key ? "" : api_key?.trim() ? encryptSecret(api_key.trim()) : previous?.api_key_encrypted || "";
      const config = { ...profile, api_key_encrypted };
      return { ...config, revision: crypto.createHash("sha256").update(JSON.stringify(config)).digest("hex") };
    }) };
    const { api_key, clear_api_key, ...speech } = parsed.speech;
    next.speech = { ...speech, api_key_encrypted: clear_api_key ? "" : api_key?.trim() ? encryptSecret(api_key.trim()) : current.speech?.api_key_encrypted || "" };
    next.speech.revision = crypto.createHash("sha256").update(JSON.stringify(next.speech)).digest("hex");
    await connection.query("INSERT INTO system_settings (workspace_id, category, value_json, updated_by) VALUES (?, 'ai', ?, ?) ON DUPLICATE KEY UPDATE value_json=VALUES(value_json), updated_by=VALUES(updated_by)", [workspaceId, JSON.stringify(next), userId]);
    return publicAiSettings(next);
  });
}

export function aiProfileKey(profile) {
  const key = decryptSecret(profile.api_key_encrypted);
  if (profile.api_key_encrypted && !key) throw new AiError(503, "Ключ ИИ не удалось расшифровать. Сохраните его заново в настройках");
  return key;
}

export function chooseAiProfile(settings, kind, profileId) {
  if (!settings.enabled) throw new AiError(409, "ИИ отключён администратором");
  const selected = profileId || settings[kind === "project" ? "project_profile_id" : "conference_profile_id"];
  const profile = settings.profiles.find((item) => item.id === selected && item.enabled);
  if (!profile?.model) throw new AiError(409, "Активное подключение ИИ не настроено");
  return profile;
}
