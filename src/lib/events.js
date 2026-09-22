import crypto from "node:crypto";
import { rows } from "./db.js";

export async function emitEvent({ workspaceId, eventType, aggregateType, aggregateId, payload }, connection = null) {
  const eventUuid = crypto.randomUUID();
  const executor = connection ? connection.query.bind(connection) : rows;
  await executor(
    "INSERT INTO outbox_events (event_uuid, workspace_id, event_type, aggregate_type, aggregate_id, payload_json) VALUES (?, ?, ?, ?, ?, ?)",
    [eventUuid, workspaceId, eventType, aggregateType, String(aggregateId), JSON.stringify(payload || {})],
  );
  return eventUuid;
}

export async function createNotification(userId, eventType, title, body, entityType = null, entityId = null, actionUrl = null, connection = null) {
  const executor = connection ? connection.query.bind(connection) : rows;
  await executor(
    "INSERT INTO user_notifications (user_id, event_type, title, body, entity_type, entity_id, action_url) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [userId, eventType, title, body || null, entityType, entityId == null ? null : String(entityId), actionUrl],
  );
}
