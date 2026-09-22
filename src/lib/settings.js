import nodemailer from "nodemailer";
import { Client } from "ldapts";
import { one, rows, parseJson } from "./db.js";
import { decryptSecret, encryptSecret } from "./crypto.js";

export async function getSettings(workspaceId, category) {
  const row = await one("SELECT value_json FROM system_settings WHERE workspace_id = ? AND category = ?", [workspaceId, category]);
  return parseJson(row?.value_json, {});
}

function preserveOrEncrypt(nextValue, currentEncrypted) {
  if (nextValue === undefined || nextValue === "••••••••") return currentEncrypted || "";
  if (nextValue === "") return "";
  return encryptSecret(nextValue);
}

export async function saveSettings(workspaceId, category, input, userId) {
  const current = await getSettings(workspaceId, category);
  let next = { ...current, ...input };
  if (category === "mail") {
    next.passwordEncrypted = preserveOrEncrypt(input.password, current.passwordEncrypted);
    delete next.password;
  }
  if (category === "authentication") {
    next = {
      ...current,
      ...input,
      ldap: { ...(current.ldap || {}), ...(input.ldap || {}) },
      oidc: { ...(current.oidc || {}), ...(input.oidc || {}) },
    };
    next.ldap.bindPasswordEncrypted = preserveOrEncrypt(input.ldap?.bindPassword, current.ldap?.bindPasswordEncrypted);
    next.oidc.clientSecretEncrypted = preserveOrEncrypt(input.oidc?.clientSecret, current.oidc?.clientSecretEncrypted);
    delete next.ldap.bindPassword;
    delete next.oidc.clientSecret;
  }
  await rows(
    `INSERT INTO system_settings (workspace_id, category, value_json, updated_by)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE value_json = VALUES(value_json), updated_by = VALUES(updated_by)`,
    [workspaceId, category, JSON.stringify(next), userId],
  );
  return publicSettings(category, next);
}

export function publicSettings(category, value) {
  const safe = structuredClone(value || {});
  if (category === "mail") {
    safe.passwordConfigured = Boolean(safe.passwordEncrypted);
    delete safe.passwordEncrypted;
  }
  if (category === "authentication") {
    safe.ldap = safe.ldap || {};
    safe.oidc = safe.oidc || {};
    safe.ldap.bindPasswordConfigured = Boolean(safe.ldap.bindPasswordEncrypted);
    safe.oidc.clientSecretConfigured = Boolean(safe.oidc.clientSecretEncrypted);
    delete safe.ldap.bindPasswordEncrypted;
    delete safe.oidc.clientSecretEncrypted;
  }
  return safe;
}

export async function testMail(workspaceId, recipient) {
  const config = await getSettings(workspaceId, "mail");
  const transport = nodemailer.createTransport({
    host: config.host,
    port: Number(config.port || 587),
    secure: Boolean(config.secure),
    auth: config.username ? { user: config.username, pass: decryptSecret(config.passwordEncrypted) } : undefined,
    tls: { rejectUnauthorized: config.rejectUnauthorized !== false },
    connectionTimeout: 8000,
  });
  await transport.verify();
  if (recipient) {
    await transport.sendMail({ from: { name: config.fromName || "Контур", address: config.fromEmail || config.username }, to: recipient, subject: "Проверка почты — Контур", text: "SMTP-подключение настроено корректно." });
  }
  return { ok: true, message: recipient ? "Соединение проверено, письмо отправлено" : "Соединение с SMTP установлено" };
}

export async function sendSystemMail(workspaceId, recipient, subject, text) {
  const config = await getSettings(workspaceId, "mail");
  if (!config.enabled || !recipient || !(config.fromEmail || config.username)) return { status: "skipped" };
  const transport = nodemailer.createTransport({
    host: config.host,
    port: Number(config.port || 587),
    secure: Boolean(config.secure),
    auth: config.username ? { user: config.username, pass: decryptSecret(config.passwordEncrypted) } : undefined,
    tls: { rejectUnauthorized: config.rejectUnauthorized !== false },
    connectionTimeout: 8000,
  });
  const info = await transport.sendMail({ from: { name: config.fromName || "Контур", address: config.fromEmail || config.username }, to: recipient, subject, text });
  return { status: "sent", messageId: info.messageId };
}

export async function testLdap(workspaceId) {
  const auth = await getSettings(workspaceId, "authentication");
  const config = auth.ldap || {};
  const client = new Client({ url: config.url, timeout: 8000, connectTimeout: 8000, tlsOptions: { rejectUnauthorized: config.rejectUnauthorized !== false } });
  try {
    await client.bind(config.bindDn, decryptSecret(config.bindPasswordEncrypted));
    await client.search(config.baseDn, { scope: "base", sizeLimit: 1 });
    return { ok: true, message: "LDAP/Active Directory доступен" };
  } finally {
    await client.unbind().catch(() => {});
  }
}

export async function oidcDiscovery(workspaceId) {
  const auth = await getSettings(workspaceId, "authentication");
  const config = auth.oidc || {};
  const issuer = String(config.issuer || "").replace(/\/$/, "");
  const response = await fetch(`${issuer}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`OIDC discovery вернул HTTP ${response.status}`);
  const discovery = await response.json();
  for (const key of ["authorization_endpoint", "token_endpoint", "jwks_uri", "issuer"]) if (!discovery[key]) throw new Error(`В OIDC discovery отсутствует ${key}`);
  return { config, discovery };
}

export async function testOidc(workspaceId) {
  const { discovery } = await oidcDiscovery(workspaceId);
  return { ok: true, message: `OIDC-провайдер доступен: ${discovery.issuer}` };
}
