import {migrationChecksum} from './migration-runner.js';
import {SESSION_MIGRATION_VERSION,inspectSessionRecovery} from './session-migration-recovery.js';
import {INTEGRATION_MIGRATION_VERSION,inspectIntegrationRecovery} from './integration-migration-recovery.js';

// Read-only diagnostics: no CREATE, UPDATE, seed or session/user data queries.
export async function migrationStatus(db,files){
 const [[server]]=await db.query('SELECT VERSION() AS version,@@GLOBAL.log_bin AS binary_logging,@@GLOBAL.log_bin_trust_function_creators AS trust_creators');
 const [tables]=await db.query("SELECT TABLE_NAME AS table_name FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('schema_migrations','schema_migration_runs')");
 const has=name=>tables.some(t=>t.table_name===name);
 const [applied]=has('schema_migrations')?await db.query('SELECT version FROM schema_migrations'):[[]];
 const [journal]=has('schema_migration_runs')?await db.query('SELECT * FROM schema_migration_runs'):[[]];
 const byName=new Map(files.map(f=>[f.name,f])),allNames=[...new Set([...byName.keys(),...applied.map(r=>r.version),...journal.map(r=>r.version)])].sort();
 const migrations=allNames.map(version=>{
  const entry=journal.find(r=>r.version===version),file=byName.get(version),registered=applied.some(r=>r.version===version);
  return {version,status:entry?.status||(registered?'legacy':'pending'),registered,error_code:entry?.error_code||null,checksum:file?(entry?entry.checksum===migrationChecksum(file.sql)?'ok':'mismatch':'untracked'):'file_missing'};
 });
 const report={server,migrations};
 const session=migrations.find(m=>m.version===SESSION_MIGRATION_VERSION),file=byName.get(SESSION_MIGRATION_VERSION);
 if(file&&session&&(!session.registered||['failed','running'].includes(session.status))){
  try{const plan=await inspectSessionRecovery(db,file.sql);report.recovery_013={present:plan.present,missing:plan.missing.map(({kind,name})=>({kind,name})),conflicts:plan.conflicts};}
  catch(error){report.recovery_013={error:error.code||error.message};}
 }
 const integration=migrations.find(m=>m.version===INTEGRATION_MIGRATION_VERSION),integrationFile=byName.get(INTEGRATION_MIGRATION_VERSION);
 if(integrationFile&&integration&&(!integration.registered||['failed','running'].includes(integration.status))){
  try{const plan=await inspectIntegrationRecovery(db,integrationFile.sql);report.recovery_021={present:plan.present,missing:plan.missing.map(({kind,name})=>({kind,name})),conflicts:plan.conflicts,...(plan.legacy?{legacy:plan.legacy}:{})};}
  catch(error){report.recovery_021={error:error.code||error.message};}
 }
 return report;
}
