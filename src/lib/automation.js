import crypto from "node:crypto";
import { db, one, parseJson, rows, transaction } from "./db.js";
import { createNotification, emitEvent } from "./events.js";
import { decryptSecret } from "./crypto.js";
import { sendSystemMail } from "./settings.js";

export { conditionsMatch } from "./automation-flow.js";
export { runAutomationsForEvent } from "./work-automation.js";

export async function deliverWebhooks(event) {
  const webhooks = await rows("SELECT * FROM webhooks WHERE workspace_id=? AND enabled=TRUE", [event.workspace_id]);
  const payload = { id: event.event_uuid, type: event.event_type, createdAt: event.created_at, data: parseJson(event.payload_json, {}) };
  const body = JSON.stringify(payload);
  const delivered = [];
  for (const webhook of webhooks) {
    const types = parseJson(webhook.event_types_json, []);
    if (!types.includes("*") && !types.includes(event.event_type)) continue;
    const secret = decryptSecret(webhook.secret_encrypted);
    const signature = secret ? crypto.createHmac("sha256", secret).update(body).digest("hex") : "";
    const response = await fetch(webhook.target_url, { method: "POST", headers: { "content-type": "application/json", "user-agent": "Kontur-Work-Webhook/1.0", "x-kontur-event": event.event_type, "x-kontur-delivery": event.event_uuid, ...(signature ? { "x-kontur-signature-256": `sha256=${signature}` } : {}) }, body, signal: AbortSignal.timeout(10000) });
    await rows("UPDATE webhooks SET last_status=?, last_delivery_at=CURRENT_TIMESTAMP WHERE id=?", [response.status, webhook.id]);
    if (!response.ok) throw new Error(`Webhook ${webhook.id} вернул HTTP ${response.status}`);
    delivered.push(webhook.id);
  }
  return delivered;
}
