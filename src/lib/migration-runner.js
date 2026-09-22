import {createHash} from 'node:crypto';
import {SESSION_MIGRATION_VERSION,SESSION_MIGRATION_CHECKSUM,recoverSessionMigration,assertTriggerCreationAvailable} from './session-migration-recovery.js';
import {INTEGRATION_MIGRATION_VERSION,INTEGRATION_MIGRATION_CHECKSUM,recoverIntegrationMigration} from './integration-migration-recovery.js';
export const migrationChecksum=sql=>createHash('sha256').update(sql,'utf8').digest('hex');
const recoveries=[
 {name:SESSION_MIGRATION_VERSION,checksum:SESSION_MIGRATION_CHECKSUM,run:recoverSessionMigration},
 {name:INTEGRATION_MIGRATION_VERSION,checksum:INTEGRATION_MIGRATION_CHECKSUM,run:recoverIntegrationMigration}
];
const recoveryFor=file=>recoveries.find(r=>r.name===file.name&&r.checksum===file.checksum);
const isRecoverable=file=>Boolean(recoveryFor(file));
const isUnfinished=entry=>entry&&['running','failed'].includes(entry.status);
export async function runMigrations(db,files,{database='kontur_work',lockTimeout=50,log=()=>{}}={}){
 const lockName=`kontur_migrate_${migrationChecksum(database).slice(0,32)}`;
 const [[lock]]=await db.query('SELECT GET_LOCK(?,?) AS acquired',[lockName,lockTimeout]);
 if(Number(lock?.acquired)!==1)throw new Error('Не удалось получить блокировку миграций. Другое обновление ещё работает');
 try{
  await db.query('SET autocommit=1');
  await db.query("CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(120) PRIMARY KEY,applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci");
  await db.query("CREATE TABLE IF NOT EXISTS schema_migration_runs (version VARCHAR(120) PRIMARY KEY,checksum CHAR(64) NOT NULL,status ENUM('running','failed','applied','adopted') NOT NULL,started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,finished_at DATETIME NULL,error_code VARCHAR(100) NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci");
  const ordered=[...files].sort((a,b)=>a.name.localeCompare(b.name)),byName=new Map(ordered.map(f=>[f.name,{...f,checksum:migrationChecksum(f.sql)}]));
  if(!files.length||byName.size!==files.length||ordered.some((f,i)=>!new RegExp(`^${String(i+1).padStart(3,'0')}_[a-z0-9_]+\\.sql$`).test(f.name)))throw new Error('Неверная последовательность файлов миграций');
  const [applied]=await db.query('SELECT version FROM schema_migrations'),[journal]=await db.query('SELECT * FROM schema_migration_runs'),appliedSet=new Set(applied.map(r=>r.version)),journalMap=new Map(journal.map(r=>[r.version,r]));
  // Validate the entire ledger before any application migration executes.
  for(const entry of [...applied,...journal])if(!byName.has(entry.version))throw new Error(`В базе есть отсутствующая в коде миграция ${entry.version}. Откат схемы этим скриптом не поддерживается`);
  for(const entry of journal){
   if(entry.checksum!==byName.get(entry.version).checksum)throw new Error(`Изменён файл уже зарегистрированной миграции ${entry.version}. Восстановите исходный файл`);
   if(isUnfinished(entry)){
    if(!isRecoverable(byName.get(entry.version)))throw new Error(`Миграция ${entry.version} не завершена (сохранённый код: ${entry.error_code||'нет; выполнение могло быть прервано'}). Проверьте схему и восстановление по docs/DATABASE-UPGRADES.md; автоматический повтор остановлен`);
    if(applied.some(row=>row.version>entry.version))throw new Error(`${entry.version}: после незавершённой миграции зарегистрированы более поздние обновления. Нужна ручная проверка журналов`);
   }else if(!appliedSet.has(entry.version))throw new Error(`Журналы миграций не согласованы: ${entry.version}`);
  }
  let gap=false;for(const file of byName.values()){if(!appliedSet.has(file.name))gap=true;else if(gap)throw new Error(`Нарушен порядок ранее применённых миграций: ${file.name}`);}
  for(const file of byName.values()){
   const unfinished=isUnfinished(journalMap.get(file.name));
   if(appliedSet.has(file.name)&&!unfinished){
    if(!journalMap.has(file.name)){await db.query("INSERT INTO schema_migration_runs(version,checksum,status,finished_at) VALUES(?,?,'adopted',CURRENT_TIMESTAMP)",[file.name,file.checksum]);log(`Принята контрольная сумма прежней миграции: ${file.name}`);}continue;
   }
   // Reject a known server prerequisite before new DDL or changing a failure marker.
   if(/\bCREATE\s+TRIGGER\b/i.test(file.sql)&&!isRecoverable(file))await assertTriggerCreationAvailable(db);
   if(unfinished){
    log(`Восстановление ${file.name}: прежний код ошибки ${journalMap.get(file.name).error_code||'не записан'}`);
    await db.query("UPDATE schema_migration_runs SET status='running',finished_at=NULL WHERE version=?",[file.name]);
   }else await db.query("INSERT INTO schema_migration_runs(version,checksum,status) VALUES(?,?,'running')",[file.name,file.checksum]);
   try{
    // MySQL DDL commits implicitly. The running marker must already be durable.
    if(isRecoverable(file))await recoveryFor(file).run(db,file,log);
    else await db.query(file.sql);
    await db.beginTransaction();
    if(!appliedSet.has(file.name))await db.query('INSERT INTO schema_migrations(version) VALUES(?)',[file.name]);
    await db.query("UPDATE schema_migration_runs SET status='applied',finished_at=CURRENT_TIMESTAMP,error_code=NULL WHERE version=?",[file.name]);
    await db.commit();log(`Применена миграция: ${file.name}`);
   }catch(error){
    await db.rollback().catch(()=>{});
    const code=String(error.code||'UNKNOWN').slice(0,100);
    await db.query("UPDATE schema_migration_runs SET status='failed',finished_at=CURRENT_TIMESTAMP,error_code=? WHERE version=?",[code,file.name]).catch(()=>{});
    // SQL errors may contain row values. Print the code only; our own validation errors contain schema metadata.
    const detail=error.code&&!String(error.code).startsWith('KONTUR_')?'':` ${error.message}`;
    const ddlState=code==='KONTUR_INTEGRATION_SCHEMA_CONFLICT'?'В этом запуске таблицы не изменены':'DDL мог примениться частично';
    throw new Error(`Миграция ${file.name} прервана (${code}).${detail} ${ddlState}; ${isRecoverable(file)?'после устранения причины повторный запуск сверит схему и добавит недостающие объекты':'автоматический повтор заблокирован'}. См. docs/DATABASE-UPGRADES.md`);
   }
  }
 }finally{await db.query('SELECT RELEASE_LOCK(?)',[lockName]).catch(()=>{});}
}
