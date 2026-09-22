import crypto from "node:crypto";

const CALL_STATUSES = new Set([
  "queued",
  "ringing",
  "active",
  "completed",
  "failed",
  "cancelled",
  "busy",
  "no_answer",
]);

function settings() {
  const configuredTimeout = Number(process.env.TELEPHONY_TIMEOUT_MS || 15000);
  return {
    apiUrl: String(process.env.TELEPHONY_API_URL || "").replace(/\/+$/, ""),
    apiToken: process.env.TELEPHONY_API_TOKEN || "",
    webhookSecret: process.env.TELEPHONY_WEBHOOK_SECRET || "",
    fromNumber: process.env.TELEPHONY_FROM_NUMBER || "",
    timeoutMs: Number.isFinite(configuredTimeout) ? Math.max(1000, configuredTimeout) : 15000,
  };
}

export function telephonySettings() {
  const value = settings();
  let providerOrigin = null;
  try {
    const parsed = new URL(value.apiUrl);
    if (["http:", "https:"].includes(parsed.protocol)) providerOrigin = parsed.origin;
  } catch {}
  return {
    ...value,
    providerOrigin,
    configured: Boolean(providerOrigin && value.apiToken && value.webhookSecret && value.fromNumber),
  };
}

export function normalizeCallStatus(value, fallback = "queued") {
  const normalized = String(value || "").toLowerCase().replace(/[ -]+/g, "_");
  return CALL_STATUSES.has(normalized) ? normalized : fallback;
}

async function providerRequest(path, options = {}) {
  const config = telephonySettings();
  if (!config.configured) throw new Error("Телефонный провайдер не настроен");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(`${config.apiUrl}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${config.apiToken}`,
        "content-type": "application/json",
        ...(options.headers || {}),
      },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.error || body.message || `Телефонный шлюз вернул HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

export async function startOutboundCall(payload) {
  const body = await providerRequest("/calls", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  const providerCallId = body.id || body.call_id;
  if (!providerCallId) throw new Error("Телефонный шлюз не вернул идентификатор звонка");
  return {
    providerCallId: String(providerCallId),
    status: normalizeCallStatus(body.status),
  };
}

export async function hangupOutboundCall(providerCallId) {
  return providerRequest(`/calls/${encodeURIComponent(providerCallId)}/hangup`, {
    method: "POST",
    body: "{}",
  });
}

export function verifyTelephonyWebhook(rawBody, signatureHeader) {
  const secret = settings().webhookSecret;
  if (!secret || !signatureHeader) return false;
  const provided = String(signatureHeader).replace(/^sha256=/i, "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(provided)) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(provided, "hex"), Buffer.from(expected, "hex"));
}

export function maskPhone(value) {
  const phone = String(value || "");
  if (phone.length <= 4) return phone ? "••••" : "";
  return `${phone.slice(0, 2)}${"•".repeat(Math.max(3, phone.length - 4))}${phone.slice(-2)}`;
}
