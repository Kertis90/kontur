import mysql from "mysql2/promise";
import { databaseEngine, mysqlConfig } from "./database-config.js";
import { createPostgresPool } from "./postgres-db.js";

const globalForDb = globalThis;

export const db = globalForDb.__konturDb || (databaseEngine()==='postgres' ? createPostgresPool() : mysql.createPool({
  ...mysqlConfig(),
  connectionLimit: Number(process.env.MYSQL_POOL_SIZE || 12),
  connectTimeout: Number(process.env.MYSQL_CONNECT_TIMEOUT || 10000),
  waitForConnections: true,
  queueLimit: 0,
  dateStrings: true,
  decimalNumbers: true,
}));

if (process.env.NODE_ENV !== "production") globalForDb.__konturDb = db;

// Возвращает строки или результат изменения независимо от выбранной БД.
export async function rows(sql, params = []) {
  const [result] = await db.query(sql, params);
  return result;
}

// Возвращает первую строку результата либо null.
export async function one(sql, params = []) {
  const result = await rows(sql, params);
  return result[0] || null;
}

// Выполняет действие атомарно на одном подключении и освобождает его после завершения.
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

// Читает JSON обоих драйверов, сохраняя значение по умолчанию при повреждённых данных.
export function parseJson(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}
