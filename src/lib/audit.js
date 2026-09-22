import { rows } from "./db.js";

export async function audit(user, action, entityType, entityId, details = null, request = null) {
  const forwarded = request?.headers?.get("x-forwarded-for")?.split(",")[0]?.trim();
  await rows(
    "INSERT INTO audit_log (workspace_id, actor_id, action, entity_type, entity_id, details_json, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [user.workspace_id, user.id, action, entityType, entityId == null ? null : String(entityId), details ? JSON.stringify(details) : null, forwarded || null],
  );
}
