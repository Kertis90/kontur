import crypto from "node:crypto";
import { Client } from "minio";

let client;

function config() {
  const endpoint = new URL(process.env.S3_ENDPOINT || "http://127.0.0.1:9000");
  return {
    endPoint: endpoint.hostname,
    port: Number(endpoint.port || (endpoint.protocol === "https:" ? 443 : 80)),
    useSSL: endpoint.protocol === "https:",
    accessKey: process.env.S3_ACCESS_KEY || "kontur-minio",
    secretKey: process.env.S3_SECRET_KEY || "development-minio-secret",
    region: process.env.S3_REGION || "us-east-1",
    pathStyle: ["1", "true", "yes", "on"].includes(String(process.env.S3_FORCE_PATH_STYLE || "true").toLowerCase()),
  };
}

export function storage() {
  if (!client) client = new Client(config());
  return client;
}

export function bucket() {
  return process.env.S3_BUCKET || "kontur-attachments";
}

export function safeFileName(value) {
  return String(value || "file").normalize("NFKC").replace(/[\\/\0\r\n]+/g, "-").replace(/[^\p{L}\p{N}._ -]+/gu, "_").slice(0, 180) || "file";
}

export function attachmentKey(workspaceId, projectId, taskId, fileName) {
  return `workspaces/${workspaceId}/projects/${projectId}/tasks/${taskId}/${crypto.randomUUID()}-${safeFileName(fileName)}`;
}

export async function presignedUpload(objectKey, expires = 900) {
  return storage().presignedPutObject(bucket(), objectKey, expires);
}

export async function presignedDownload(objectKey, expires = 300) {
  return storage().presignedGetObject(bucket(), objectKey, expires);
}

export async function objectInfo(objectKey) {
  return storage().statObject(bucket(), objectKey);
}

export async function deleteObject(objectKey) {
  return storage().removeObject(bucket(), objectKey);
}

export async function readObject(objectKey, maxBytes = 50 * 1024 * 1024) {
  const stream = await storage().getObject(bucket(), objectKey);
  const chunks = [];
  let total = 0;
  for await (const chunk of stream) {
    total += chunk.length;
    if (total > maxBytes) throw new Error("Файл превышает лимит импорта");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
