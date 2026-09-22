import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {SESSION_MIGRATION_VERSION,sessionRecoverySpec,planSessionRecovery,recoverSessionMigration,assertTriggerCreationAvailable,canonicalTriggerBody} from '../src/lib/session-migration-recovery.js';
import {runMigrations,migrationChecksum} from '../src/lib/migration-runner.js';
import {migrationStatus} from '../src/lib/migration-status.js';

const file={name:SESSION_MIGRATION_VERSION,sql:await fs.readFile(new URL('./migrations/013_sessions_and_directory.sql',import.meta.url),'utf8')};
const spec=sessionRecoverySpec(file.sql);
const previous=Array.from({length:12},(_,i)=>({name:`${String(i+1).padStart(3,'0')}_previous.sql`,sql:'SELECT 1'}));
const files=[...previous,file,{name:'014_next.sql',sql:'SELECT NEXT_MIGRATION'}];
const baseTables=['users','workspaces','api_tokens'].map(table_name=>({table_name,table_type:'BASE TABLE',engine:'InnoDB'}));
const mysqlColumn=(table_name,c)=>({table_name,column_name:c.name,column_type:c.type==='tinyint'?'tinyint(1)':c.type,is_nullable:c.nullable?'YES':'NO',column_default:c.default==='current_timestamp'?'CURRENT_TIMESTAMP':c.default,extra:(c.default==='current_timestamp'?'DEFAULT_GENERATED ':'')+(c.onUpdate?'on update CURRENT_TIMESTAMP':''),generation_expression:'',character_set_name:/^(char|varchar|text)/.test(c.type)?'utf8mb4':null});
function emptySchema(){return {tables:structuredClone(baseTables),columns:[],indexes:[],foreignKeys:[],triggers:[],checks:[]};}
function addTable(snapshot,t){
 snapshot.tables.push({table_name:t.name,table_type:'BASE TABLE',engine:'InnoDB'});
 snapshot.columns.push(...t.columns.map(c=>mysqlColumn(t.name,c)));
 for(const [n,index] of t.indexes.entries())snapshot.indexes.push(...index.columns.map((column_name,i)=>({table_name:t.name,index_name:index.primary?'PRIMARY':`idx_${n}`,non_unique:index.unique?0:1,sequence_number:i+1,column_name,sub_part:null,is_visible:'YES',index_type:'BTREE'})));
 snapshot.foreignKeys.push(...t.foreignKeys.map(k=>({table_name:t.name,column_name:k.column,referenced_table:k.table,referenced_column:k.referenced,table_schema:'test',referenced_schema:'test',delete_rule:'CASCADE',update_rule:'NO ACTION'})));
}
function addTrigger(snapshot,t){snapshot.triggers.push({trigger_name:t.name,table_name:t.table,timing:t.timing,event_name:t.event,statement_body:t.body});}
function completeSchema(){const s=emptySchema();for(const t of spec.tables)addTable(s,t);s.columns.push(...spec.columns.map(c=>mysqlColumn('users',c)));for(const t of spec.triggers)addTrigger(s,t);return s;}
function fake({snapshot=emptySchema(),state='failed',originalCode='ER_BINLOG_CREATE_ROUTINE_NEED_SUPER',trust=1,binlog=1,grants=['GRANT ALL PRIVILEGES ON `test`.* TO `kontur`@`%`'],stopAfter=Infinity,checksum=migrationChecksum(file.sql),appliedSession=false}={}){
 const ledger=new Map(state?[[file.name,{version:file.name,checksum,status:state,error_code:originalCode}]]:[]),applied=new Set(previous.map(f=>f.name));
 if(appliedSession)applied.add(file.name);
 const reads=[],writes=[],data=[{id:'existing-session',user_agent:'Keep this session'}];let released=false,ddl=0;
 const db={beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},query:async(sql,args=[])=>{
  if(sql.startsWith('SELECT GET_LOCK'))return [[{acquired:1}]];
  if(sql.startsWith('SELECT RELEASE_LOCK')){released=true;return [[]];}
  if(sql.startsWith('SELECT @@GLOBAL')||sql.startsWith('SELECT VERSION()'))return [[{version:'8.4',binary_logging:binlog,trust_creators:trust}]];
  if(sql==='SHOW GRANTS')return [grants.map(g=>({Grants:g}))];
  if(sql.includes('FROM information_schema.')){
   reads.push(sql);
   if(sql.includes("'schema_migrations','schema_migration_runs'"))return [[{table_name:'schema_migrations'},{table_name:'schema_migration_runs'}]];
   const kind=sql.includes('information_schema.TABLE_CONSTRAINTS')?'checks':sql.includes('information_schema.TABLES')?'tables':sql.includes('information_schema.COLUMNS')?'columns':sql.includes('information_schema.STATISTICS')?'indexes':sql.includes('information_schema.KEY_COLUMN_USAGE')?'foreignKeys':'triggers';
   return [structuredClone(snapshot[kind])];
  }
  if(sql==='SELECT version FROM schema_migrations')return [[...applied].map(version=>({version}))];
  if(sql==='SELECT * FROM schema_migration_runs')return [[...ledger.values()].map(r=>({...r}))];
  writes.push(sql);
  if(sql.startsWith('CREATE TABLE IF NOT EXISTS schema_')||sql==='SET autocommit=1')return [[]];
  if(sql.startsWith('INSERT INTO schema_migration_runs')){assert.equal(ledger.has(args[0]),false);ledger.set(args[0],{version:args[0],checksum:args[1],status:sql.includes("'adopted'")?'adopted':'running'});return [{}];}
  if(sql.startsWith('UPDATE schema_migration_runs')){const row=ledger.get(args.at(-1));row.status=sql.includes("'failed'")?'failed':sql.includes("'running'")?'running':'applied';if(row.status==='failed')row.error_code=args[0];if(row.status==='applied')row.error_code=null;return [{}];}
  if(sql.startsWith('INSERT INTO schema_migrations(')){assert.equal(applied.has(args[0]),false);applied.add(args[0]);return [{}];}
  if(sql==='SELECT NEXT_MIGRATION')return [[]];
  const table=spec.tables.find(t=>t.sql===sql),column=spec.columns.find(c=>c.sql===sql),trigger=spec.triggers.find(t=>t.sql===sql);
  if(!table&&!column&&!trigger)throw new Error(`Unexpected SQL in recovery: ${sql}`);
  if(ddl++===stopAfter)throw Object.assign(new Error('Connection lost after committed DDL'),{code:'PROTOCOL_CONNECTION_LOST'});
  if(table){assert.equal(snapshot.tables.some(t=>t.table_name===table.name),false);addTable(snapshot,table);}
  if(column){assert.equal(snapshot.columns.some(c=>c.table_name==='users'&&c.column_name===column.name),false);snapshot.columns.push(mysqlColumn('users',column));}
  if(trigger){assert.equal(snapshot.triggers.some(t=>t.trigger_name===trigger.name),false);addTrigger(snapshot,trigger);}
  return [{}];
 }};
 return {db,snapshot,ledger,applied,reads,writes,data,get released(){return released;}};
}

test('013 recovery is pinned to the shipped SQL, including integer, boolean and timestamp semantics',()=>{
 assert.equal(spec.tables.length,5);assert.equal(spec.triggers.length,2);assert.equal(spec.columns.length,2);
 assert.equal(spec.tables.find(t=>t.name==='security_rate_limits').columns.find(c=>c.name==='attempts').type,'int unsigned');
 assert.equal(spec.columns.find(c=>c.name==='directory_disabled').default,'0');
 assert.deepEqual(planSessionRecovery(spec,completeSchema()).missing,[]);
 assert.deepEqual(planSessionRecovery(spec,completeSchema()).conflicts,[]);
 assert.throws(()=>sessionRecoverySpec(file.sql+'\n'),/неизменённого/);
});

test('every interruption point in original 013 resumes only missing objects and preserves existing data',async()=>{
 // Original order: five tables, two triggers, then one atomic ALTER with two columns.
 for(let prefix=0;prefix<=8;prefix++){
  const snapshot=emptySchema();for(const t of spec.tables.slice(0,Math.min(prefix,5)))addTable(snapshot,t);
  for(const t of spec.triggers.slice(0,Math.max(0,Math.min(2,prefix-5))))addTrigger(snapshot,t);
  if(prefix===8)snapshot.columns.push(...spec.columns.map(c=>mysqlColumn('users',c)));
  const f=fake({snapshot}),originalData=structuredClone(f.data),missing=planSessionRecovery(spec,snapshot).missing.length;
  await runMigrations(f.db,files);
  assert.equal(f.ledger.get(file.name).status,'applied');assert.equal(f.applied.has(files.at(-1).name),true);assert.equal(f.released,true);
  assert.equal(f.writes.filter(s=>/^CREATE TABLE (?!IF)|^CREATE TRIGGER|^ALTER TABLE users/.test(s)).length,missing);
  assert.deepEqual(f.data,originalData);assert.deepEqual(planSessionRecovery(spec,snapshot).conflicts,[]);
  const count=f.writes.length;await runMigrations(f.db,files);assert.equal(f.writes.slice(count).some(s=>/^CREATE TRIGGER|^ALTER TABLE/.test(s)),false);
 }
});

test('a second interruption during recovery can resume the remaining objects',async()=>{
 const f=fake({stopAfter:6});await assert.rejects(runMigrations(f.db,files),/PROTOCOL_CONNECTION_LOST/);
 assert.equal(f.ledger.get(file.name).status,'failed');assert.equal(f.applied.has(file.name),false);
 const next=fake({snapshot:f.snapshot});await runMigrations(next.db,files);assert.equal(next.ledger.get(file.name).status,'applied');
 assert.equal(next.writes.filter(s=>s.startsWith('CREATE TABLE user_')).length,0);
});

test('fresh, pre-journal partial, running and fully executed but unrecorded 013 are recoverable',async()=>{
 for(const state of [null,'running','failed']){
  const f=fake({state,snapshot:completeSchema(),appliedSession:state==='failed'});
  await runMigrations(f.db,files);assert.equal(f.ledger.get(file.name).status,'applied');
  assert.equal(f.writes.some(s=>/^CREATE TRIGGER|^ALTER TABLE users|^CREATE TABLE user_/.test(s)),false);
 }
});

test('drift in columns, constraints, indexes or trigger semantics blocks all recovery DDL',async()=>{
 const changes=[
  s=>{s.columns.find(c=>c.column_name==='mfa_verified').column_default='1';},
  s=>{s.columns.find(c=>c.column_name==='external_issuer').column_type='varchar(599)';},
  s=>{s.columns.find(c=>c.column_name==='expires_at').is_nullable='YES';},
  s=>{s.columns.find(c=>c.column_name==='attempts').extra='auto_increment';},
  s=>{s.foreignKeys[0].delete_rule='RESTRICT';},
  s=>{s.foreignKeys[0].referenced_schema='other_database';},
  s=>{s.indexes.find(i=>i.index_name!=='PRIMARY').is_visible='NO';},
  s=>{s.checks.push({table_name:'user_sessions',constraint_name:'unexpected_restriction'});},
  s=>{s.triggers[0].statement_body=s.triggers[0].statement_body.replace("'active'","'ACTIVE'");},
  s=>{s.tables[0].table_type='VIEW';},
 ];
 for(const change of changes){const f=fake({snapshot:completeSchema()});change(f.snapshot);await assert.rejects(runMigrations(f.db,files),/отличается|отличаются/);assert.equal(f.applied.has(file.name),false);assert.equal(f.writes.some(s=>/^CREATE TRIGGER|^ALTER TABLE users|^CREATE TABLE user_/.test(s)),false);}
});

test('SQL formatting changes are accepted but literals and revoked-session conditions remain significant',()=>{
 const body=spec.triggers[0].body;
 assert.equal(canonicalTriggerBody(body),canonicalTriggerBody(body.replace('UPDATE user_sessions','update `user_sessions`').replaceAll('CURRENT_TIMESTAMP','current_timestamp()')));
 assert.notEqual(canonicalTriggerBody(body),canonicalTriggerBody(body.replace('revoked_at IS NULL','revoked_at IS NOT NULL')));
});

test('binlog prerequisite failure creates no session schema objects and gives an actionable error',async()=>{
 const f=fake({trust:0});await assert.rejects(runMigrations(f.db,files),/log_bin_trust_function_creators=0/);
 assert.equal(f.writes.some(s=>/^CREATE TRIGGER|^ALTER TABLE users|^CREATE TABLE user_/.test(s)),false);
 assert.equal(f.applied.has(file.name),false);
 for(const options of [{trust:1},{trust:0,binlog:0},{trust:0,grants:['GRANT ALL PRIVILEGES ON *.* TO `admin`@`%`']},{trust:0,grants:['GRANT SUPER, TRIGGER ON *.* TO `admin`@`%`']}])await assertTriggerCreationAvailable(fake(options).db);
});

test('complete schema recovery needs no trigger creation privilege',async()=>{
 const f=fake({snapshot:completeSchema(),trust:0});await recoverSessionMigration(f.db,file);assert.equal(f.writes.length,0);
});

test('checksum mismatch and later applied migrations cannot use the recovery exception',async()=>{
 const changed=fake({checksum:'bad'});await assert.rejects(runMigrations(changed.db,files),/Изменён файл/);
 const later=fake({appliedSession:true});later.applied.add(files.at(-1).name);await assert.rejects(runMigrations(later.db,files),/более поздние/);
 for(const f of [changed,later])assert.equal(f.writes.some(s=>/^CREATE TABLE user_|^ALTER TABLE users/.test(s)),false);
});

test('status surfaces stored cause and missing objects without writing, migrating or exposing data',async()=>{
 const f=fake({trust:0});const report=await migrationStatus(f.db,files);
 assert.equal(report.migrations.find(m=>m.version===file.name).error_code,'ER_BINLOG_CREATE_ROUTINE_NEED_SUPER');
 assert.equal(report.server.trust_creators,0);assert.equal(report.recovery_013.missing.length,9);
 assert.equal(f.writes.length,0);assert.equal(JSON.stringify(report).includes('existing-session'),false);
 assert.equal(report.recovery_013.missing.some(m=>'sql' in m),false);
});

test('final schema verification must succeed before either completion marker is written',async()=>{
 const f=fake(),original=f.db.query;
 f.db.query=async(sql,args)=>sql===spec.columns[0].sql?[{}]:original(sql,args);
 await assert.rejects(runMigrations(f.db,files),/итоговая схема не прошла проверку/);
 assert.equal(f.applied.has(file.name),false);assert.equal(f.ledger.get(file.name).status,'failed');
 assert.equal(f.applied.has(files.at(-1).name),false);
});

test('preflight prevents a new subsequent trigger migration from starting DDL or its marker',async()=>{
 const f=fake({snapshot:completeSchema(),trust:0,state:'applied',appliedSession:true});
 const next={name:'014_next.sql',sql:'CREATE TABLE another_table(id INT); CREATE TRIGGER next_trigger AFTER UPDATE ON users FOR EACH ROW SET @x=1;'};
 await assert.rejects(runMigrations(f.db,[...previous,file,next]),/log_bin_trust_function_creators=0/);
 assert.equal(f.ledger.has(next.name),false);assert.equal(f.writes.includes(next.sql),false);
});
