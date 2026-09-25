import {createHash} from 'node:crypto';

// Вычисляет контрольную сумму выпущенного файла миграции.
function checksum(sql){return createHash('sha256').update(sql).digest('hex');}
// Сверяет применённые файлы и запрещает запуск при изменении истории схемы.
function checkHistory(applied,files) {
 for(const entry of applied) {
  const file=files.find(f=>f.name===entry.version);
  if(!file||checksum(file.sql)!==entry.checksum)throw new Error(`История PostgreSQL изменена: ${entry.version}`);
 }
}
// Показывает состояние схемы PostgreSQL, не создавая таблиц и не меняя данных.
export async function postgresMigrationStatus(client,files) {
 const {rows:[server]}=await client.query('SELECT version() AS version');
 const {rows:[table]}=await client.query("SELECT to_regclass('public.schema_migrations') AS name");
 const {rows:applied}=table.name?await client.query('SELECT version,checksum FROM schema_migrations'):{rows:[]};
 const {rows:[journal]}=await client.query("SELECT to_regclass('public.schema_migration_runs') AS name");
 const {rows:runs}=journal.name?await client.query('SELECT version,checksum,status,error_code FROM schema_migration_runs'):{rows:[]};
 return {engine:'postgres',server,migrations:files.map(f=>{const entry=runs.find(a=>a.version===f.name)||applied.find(a=>a.version===f.name);return {version:f.name,status:entry?.status||(entry?'applied':'pending'),error_code:entry?.error_code||null,checksum:entry?(entry.checksum===checksum(f.sql)?'ok':'mismatch'):'untracked'};}),missing_files:[...new Set([...applied,...runs].filter(a=>!files.some(f=>f.name===a.version)).map(a=>a.version))]};
}
// Применяет каждый файл атомарно под общей блокировкой установки; не допускает частичной DDL-миграции.
export async function runPostgresMigrations(client,files,{log=()=>{}}={}) {
 await client.query("SET lock_timeout='50s'");
 await client.query("SELECT pg_advisory_lock(hashtextextended('kontur:migrations',0))");
 try {
  await client.query('CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY,checksum char(64) NOT NULL,applied_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  await client.query("CREATE TABLE IF NOT EXISTS schema_migration_runs(version text PRIMARY KEY,checksum char(64) NOT NULL,status text NOT NULL CHECK(status IN ('running','failed','applied')),started_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,finished_at timestamp,error_code varchar(100))");
  const {rows:applied}=await client.query('SELECT version,checksum FROM schema_migrations');checkHistory(applied,files);
  const {rows:journal}=await client.query('SELECT version,checksum FROM schema_migration_runs');checkHistory(journal,files);
  await client.query("INSERT INTO schema_migration_runs(version,checksum,status,finished_at) SELECT version,checksum,'applied',applied_at FROM schema_migrations ON CONFLICT DO NOTHING");
  for(const file of files) {
   if(applied.some(a=>a.version===file.name))continue;
   await client.query("INSERT INTO schema_migration_runs(version,checksum,status) VALUES($1,$2,'running') ON CONFLICT(version) DO UPDATE SET status='running',started_at=CURRENT_TIMESTAMP,finished_at=NULL,error_code=NULL",[file.name,checksum(file.sql)]);
   await client.query('BEGIN');
   try {
    await client.query(file.sql);
    await client.query('INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)',[file.name,checksum(file.sql)]);
    await client.query("UPDATE schema_migration_runs SET status='applied',finished_at=CURRENT_TIMESTAMP WHERE version=$1",[file.name]);
    await client.query('COMMIT');log(`Применена миграция PostgreSQL: ${file.name}`);
   }catch(error){await client.query('ROLLBACK');await client.query("UPDATE schema_migration_runs SET status='failed',finished_at=CURRENT_TIMESTAMP,error_code=$2 WHERE version=$1",[file.name,String(error.code||'MIGRATION_FAILED').slice(0,100)]);throw error;}
  }
 }finally{await client.query("SELECT pg_advisory_unlock(hashtextextended('kontur:migrations',0))");}
}
