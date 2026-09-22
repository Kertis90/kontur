import crypto from "node:crypto";

function key() {
  const configured = process.env.APP_ENCRYPTION_KEY || "";
  if (/^[a-f0-9]{64}$/i.test(configured)) return Buffer.from(configured, "hex");
  const fallback = process.env.AUTH_SECRET || "development-only-secret";
  return crypto.createHash("sha256").update(fallback).digest();
}

export function encryptSecret(value) {
  if (!value) return "";
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptSecret(payload) {
  if (!payload) return "";
  try {
    const [version, iv, tag, encrypted] = payload.split(".");
    if (version !== "v1") return "";
    const decipher = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return "";
  }
}
