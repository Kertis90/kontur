import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";
import {runMigrations} from "../src/lib/migration-runner.js";
import {migrationStatus} from "../src/lib/migration-status.js";
import { mysqlSslConfig } from "../src/lib/mysql-config.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, "migrations");

const config = {
  host: process.env.MYSQL_HOST || "127.0.0.1",
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || "kontur",
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE || "kontur_work",
  multipleStatements: true,
  charset: "utf8mb4",
  connectTimeout: Number(process.env.MYSQL_CONNECT_TIMEOUT || 10000),
  ssl: mysqlSslConfig(),
};

async function connectWithRetry() {
  let lastError;
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      return await mysql.createConnection(config);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, Math.min(1000 * attempt, 5000)));
    }
  }
  throw lastError;
}

let db;
try {
  const args=process.argv.slice(2);
  if(args.length>1||(args.length&&!['--status','--help'].includes(args[0])))throw new Error('Параметры: node scripts/migrate.mjs [--status | --help]');
  if(args[0]==='--help'){
    console.log('node scripts/migrate.mjs — применить миграции; --status — вывести состояние и диагностику 013/021 без изменения БД.');
  }else{
    db = await connectWithRetry();
    const names = (await fs.readdir(migrationsDir)).filter(name => /^\d{3}_.+\.sql$/.test(name)).sort();
    const files = await Promise.all(names.map(async name => ({name, sql: await fs.readFile(path.join(migrationsDir,name),'utf8')})));
    if(args[0]==='--status')console.log(JSON.stringify(await migrationStatus(db,files),null,2));
    else{
      await runMigrations(db,files,{database:config.database,log:console.log});
      console.log("Миграции MySQL завершены.");
    }
  }
} catch(error) {
  console.error(error.code&&!String(error.code).startsWith('KONTUR_') ? `Ошибка подключения или миграций MySQL: ${error.code}` : error.message);
  process.exitCode=1;
} finally {
  if(db)await db.end().catch(()=>{});
}
