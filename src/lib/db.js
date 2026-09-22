import mysql from "mysql2/promise";
import { mysqlSslConfig } from "./mysql-config.js";

const globalForDb = globalThis;

export const db = globalForDb.__konturDb || mysql.createPool({
  host: process.env.MYSQL_HOST || "127.0.0.1",
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || "kontur",
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE || "kontur_work",
  charset: "utf8mb4",
  connectionLimit: Number(process.env.MYSQL_POOL_SIZE || 12),
  connectTimeout: Number(process.env.MYSQL_CONNECT_TIMEOUT || 10000),
  waitForConnections: true,
  queueLimit: 0,
  dateStrings: true,
  decimalNumbers: true,
  ssl: mysqlSslConfig(),
});

if (process.env.NODE_ENV !== "production") globalForDb.__konturDb = db;

export async function rows(sql, params = []) {
  const [result] = await db.query(sql, params);
  return result;
}

export async function one(sql, params = []) {
  const result = await rows(sql, params);
  return result[0] || null;
}

export async function transaction(work) {
  const connection = await db.getConnection();
  await connection.beginTransaction();
  try {
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export function parseJson(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}
