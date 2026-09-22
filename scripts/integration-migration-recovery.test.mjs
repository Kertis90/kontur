import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {INTEGRATION_MIGRATION_VERSION,LEGACY_INTEGRATION_TABLE,legacyIntegrationSpec,integrationRecoverySpec,planIntegrationRecovery} from '../src/lib/integration-migration-recovery.js';
import {runMigrations,migrationChecksum} from '../src/lib/migration-runner.js';
import {migrationStatus} from '../src/lib/migration-status.js';

const file={name:INTEGRATION_MIGRATION_VERSION,sql:await fs.readFile(new URL('./migrations/021_integrations.sql',import.meta.url),'utf8')};
const spec=integrationRecoverySpec(file.sql);
const previous=Array.from({length:20},(_,i)=>({name:`${String(i+1).padStart(3,'0')}_previous.sql`,sql:'SELECT 1'}));
const files=[...previous,file,{name:'022_next.sql',sql:'SELECT NEXT_MIGRATION'}];
const collation='utf8mb4_0900_ai_ci';
function addTable(snapshot,table){
 snapshot.tables.push({table_name:table.name,table_type:'BASE TABLE',engine:'InnoDB',table_collation:collation});
 snapshot.columns.push(...table.columns.map(c=>({table_name:table.name,column_name:c.name,column_type:c.type==='tinyint'?'tinyint(1)':c.type,is_nullable:c.nullable?'YES':'NO',column_default:c.default==='current_timestamp'?'CURRENT_TIMESTAMP':c.default,extra:[c.autoIncrement?'auto_increment':'',c.default==='current_timestamp'?'DEFAULT_GENERATED':'',c.onUpdate?'on update CURRENT_TIMESTAMP':''].filter(Boolean).join(' '),generation_expression:'',character_set_name:/^(char|varchar|text|enum)/.test(c.type)?'utf8mb4':null,collation_name:/^(char|varchar|text|enum)/.test(c.type)?collation:null})));
 for(const [n,index] of table.indexes.entries())snapshot.indexes.push(...index.columns.map((column_name,i)=>({table_name:table.name,index_name:index.primary?'PRIMARY':`idx_${n}`,non_unique:index.unique?0:1,sequence_number:i+1,column_name,sub_part:null,is_visible:'YES',index_type:'BTREE',index_order:'A'})));
 snapshot.foreignKeys.push(...table.foreignKeys.map((k,i)=>({table_name:table.name,constraint_name:`fk_${i}`,ordinal_position:1,column_name:k.column,referenced_table:k.table,referenced_column:'id',table_schema:'test',referenced_schema:'test',delete_rule:k.deleteRule,update_rule:'NO ACTION'})));
}
function schema(prefix=0){
 const s={tables:[],columns:[],indexes:[],foreignKeys:[],checks:[],triggers:[],incomingReferences:[],dependentViews:[]};
 for(const name of ['workspaces','projects','users'])addTable(s,{name,columns:[{name:'id',type:'bigint unsigned',nullable:false,default:null,autoIncrement:true}],indexes:[{columns:['id'],unique:true,primary:true}],foreignKeys:[]});
 for(const t of spec.tables.slice(0,prefix))addTable(s,t);
 return s;
}
function fake({snapshot=schema(),state='failed',checksum=migrationChecksum(file.sql),appliedIntegration=false,failAt=Infinity}={}){
 const ledger=new Map(state?[[file.name,{version:file.name,checksum,status:state,error_code:'ER_TABLE_EXISTS_ERROR'}]]:[]),applied=new Set(previous.map(f=>f.name));
 if(appliedIntegration)applied.add(file.name);
 const writes=[],ddl=[];let released=false;
 const db={beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},query:async(sql,args=[])=>{
  if(sql.startsWith('SELECT GET_LOCK'))return [[{acquired:1}]];
  if(sql.startsWith('SELECT RELEASE_LOCK')){released=true;return [[]];}
  if(sql.startsWith('SELECT VERSION()'))return [[{version:'8.4',binary_logging:1,trust_creators:0}]];
  if(sql.includes('FROM information_schema.')){
   if(sql.includes("'schema_migrations','schema_migration_runs'"))return [[{table_name:'schema_migrations'},{table_name:'schema_migration_runs'}]];
   if(sql.includes('AS source_table'))return [structuredClone(snapshot.incomingReferences)];
   if(sql.includes('information_schema.VIEW_TABLE_USAGE'))return [structuredClone(snapshot.dependentViews)];
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
  if(sql===`RENAME TABLE integration_connections TO ${LEGACY_INTEGRATION_TABLE}`){
   assert.equal(ledger.get(file.name).status,'running');assert.equal(snapshot.tables.some(t=>t.table_name===LEGACY_INTEGRATION_TABLE),false);
   if(ddl.length===failAt)throw Object.assign(new Error('Connection lost'),{code:'PROTOCOL_CONNECTION_LOST'});
   for(const kind of ['tables','columns','indexes','foreignKeys','checks','triggers'])for(const row of snapshot[kind])if(row.table_name==='integration_connections')row.table_name=LEGACY_INTEGRATION_TABLE;
   ddl.push(sql);return [{}];
  }
  const table=spec.tables.find(t=>t.sql===sql);
  assert.ok(table,`Unexpected SQL: ${sql}`);assert.equal(ledger.get(file.name).status,'running');
  if(ddl.length===failAt)throw Object.assign(new Error('Connection lost'),{code:'PROTOCOL_CONNECTION_LOST'});
  assert.equal(snapshot.tables.some(t=>t.table_name===table.name),false);ddl.push(sql);addTable(snapshot,table);return [{}];
 }};
 return {db,snapshot,ledger,applied,writes,ddl,get released(){return released;}};
}

test('021 recovery requires the exact immutable SQL file',()=>{
 assert.throws(()=>integrationRecoverySpec(file.sql+'\n'),/неизменённого/);
 assert.deepEqual(planIntegrationRecovery(spec,schema(2)),{present:['integration_connections','integration_deliveries'],missing:[],conflicts:[]});
});

test('021 fresh, partial and complete unrecorded schemas resume from every DDL boundary',async()=>{
 for(const prefix of [0,1,2])for(const state of [null,'running','failed']){
  const f=fake({snapshot:schema(prefix),state});await runMigrations(f.db,files);
  assert.deepEqual(f.ddl,spec.tables.slice(prefix).map(t=>t.sql));
  assert.equal(f.ledger.get(file.name).status,'applied');assert.equal(f.ledger.get(file.name).error_code,null);
  assert.equal(f.applied.has(files.at(-1).name),true);assert.equal(f.released,true);
  await runMigrations(f.db,files);assert.equal(f.ddl.length,2-prefix);
 }
});

test('another interruption preserves the failed marker and the next attempt resumes remaining DDL',async()=>{
 const f=fake({failAt:1});await assert.rejects(runMigrations(f.db,files),/PROTOCOL_CONNECTION_LOST/);
 assert.equal(f.ledger.get(file.name).status,'failed');assert.equal(f.applied.has(file.name),false);assert.equal(f.released,true);
 const resumed=fake({snapshot:f.snapshot});await runMigrations(resumed.db,files);
 assert.deepEqual(resumed.ddl,[spec.tables[1].sql]);
});

test('schema drift stops before creating any missing table',async()=>{
 const changes=[
  s=>{s.columns.find(c=>c.column_name==='provider').column_type="enum('TELEGRAM','mattermost','slack','webhook')";},
  s=>{s.columns.find(c=>c.column_name==='provider').column_type="enum('slack','telegram','mattermost','webhook')";},
  s=>{s.columns.find(c=>c.column_name==='enabled').column_default='1';},
  s=>{s.columns.find(c=>c.table_name==='integration_connections'&&c.column_name==='id').extra='';},
  s=>{s.columns.find(c=>c.column_name==='name').is_nullable='YES';},
  s=>{s.columns.find(c=>c.column_name==='updated_at').extra='DEFAULT_GENERATED';},
  s=>{s.columns.find(c=>c.column_name==='name').collation_name='utf8mb4_bin';},
  s=>{s.columns.find(c=>c.column_name==='name').extra='INVISIBLE';},
  s=>{s.columns.push({...s.columns.at(-1),column_name:'unexpected'});},
  s=>{s.foreignKeys[0].delete_rule='CASCADE';},
  s=>{s.foreignKeys[0].referenced_schema='another';},
  s=>{s.foreignKeys.push({...s.foreignKeys[0],ordinal_position:2,column_name:'project_id'});},
  s=>{s.indexes.find(i=>i.index_name==='idx_1').sub_part=10;},
  s=>{s.indexes.find(i=>i.index_name==='idx_1').index_order='D';},
  s=>{s.indexes.find(i=>i.index_name==='idx_1').is_visible='NO';},
  s=>{s.indexes.push({...s.indexes.at(-1),index_name:'unexpected_unique',non_unique:0});},
  s=>{s.checks.push({table_name:'integration_connections',constraint_name:'restrict_writes'});},
  s=>{s.triggers.push({table_name:'integration_connections',trigger_name:'change_writes'});},
  s=>{s.tables.at(-1).engine='MyISAM';},
  s=>{s.tables.at(-1).table_type='VIEW';},
  s=>{s.tables.shift();},
  s=>{s.indexes.shift();}
 ];
 for(const change of changes){const f=fake({snapshot:schema(1)});change(f.snapshot);await assert.rejects(runMigrations(f.db,files),/KONTUR_INTEGRATION_SCHEMA_CONFLICT/);assert.equal(f.ddl.length,0);assert.equal(f.applied.has(file.name),false);assert.equal(f.applied.has(files.at(-1).name),false);}
});

test('missing columns, deduplication unique key and delivery cascade cannot be adopted',async()=>{
 for(const change of [s=>{s.columns=s.columns.filter(c=>c.column_name!=='payload_encrypted');},s=>{s.indexes=s.indexes.filter(i=>!(i.table_name==='integration_deliveries'&&i.index_name==='idx_1'));},s=>{s.foreignKeys.at(-1).delete_rule='RESTRICT';}]){
  const f=fake({snapshot:schema(2)});change(f.snapshot);await assert.rejects(runMigrations(f.db,files),/схема отличается/);assert.equal(f.applied.has(file.name),false);assert.equal(f.ddl.length,0);
 }
});

test('equivalent integer/timestamp metadata, FK action spelling and implicit indexes are accepted',()=>{
 const s=schema(2);
 for(const c of s.columns){c.column_type=c.column_type.replace('bigint unsigned','bigint(20) unsigned').replace('int unsigned','int(10) unsigned');if(c.column_default==='CURRENT_TIMESTAMP')c.column_default='current_timestamp()';c.extra=c.extra.replace('CURRENT_TIMESTAMP','current_timestamp()');}
 for(const key of s.foreignKeys)if(key.delete_rule==='RESTRICT')key.delete_rule='NO ACTION';
 s.indexes.push({...s.indexes[0],table_name:'integration_connections',index_name:'created_by',column_name:'created_by',non_unique:1});
 assert.deepEqual(planIntegrationRecovery(spec,s).conflicts,[]);
});

test('read-only status describes existing and missing tables without SQL, credentials or writes',async()=>{
 const f=fake({snapshot:schema(1)}),report=await migrationStatus(f.db,files);
 assert.equal(report.migrations.find(m=>m.version===file.name).error_code,'ER_TABLE_EXISTS_ERROR');
 assert.deepEqual(report.recovery_021,{present:['integration_connections'],missing:[{kind:'table',name:'integration_deliveries'}],conflicts:[]});
 assert.equal(f.writes.length,0);assert.equal(JSON.stringify(report).includes('credentials_encrypted'),false);
});

test('021 recovery cannot bypass changed checksums or later applied migrations',async()=>{
 const changed=fake({checksum:'bad'});await assert.rejects(runMigrations(changed.db,files),/Изменён файл/);
 const later=fake({appliedIntegration:true});later.applied.add(files.at(-1).name);await assert.rejects(runMigrations(later.db,files),/021_integrations.sql.*более поздние/);
 const modified=fake({checksum:migrationChecksum(file.sql+'\n')});await assert.rejects(runMigrations(modified.db,[...previous,{...file,sql:file.sql+'\n'}]),/автоматический повтор остановлен/);
 for(const f of [changed,later,modified])assert.equal(f.ddl.length,0);
});

test('completion markers are written only after the final schema verification',async()=>{
 const f=fake(),original=f.db.query;
 f.db.query=async(sql,args)=>sql===spec.tables[1].sql?[{}]:original(sql,args);
 await assert.rejects(runMigrations(f.db,files),/итоговая схема не прошла проверку/);
 assert.equal(f.ledger.get(file.name).status,'failed');assert.equal(f.applied.has(file.name),false);assert.equal(f.applied.has(files.at(-1).name),false);
});

test('already recorded and unfinished complete 021 reconciles without reinserting its version',async()=>{
 const f=fake({snapshot:schema(2),appliedIntegration:true});await runMigrations(f.db,files);assert.equal(f.ddl.length,0);assert.equal(f.ledger.get(file.name).status,'applied');
});

test('the original 002 SQL defines the colliding table with the legacy manifest shape',async()=>{
 const sql=await fs.readFile(new URL('./migrations/002_platform_modules.sql',import.meta.url),'utf8');
 const ddl=sql.match(/CREATE TABLE IF NOT EXISTS integration_connections \([\s\S]*?;/)[0];
 const columns=ddl.split('\n').slice(1).filter(line=>/^  [a-z]/.test(line)).map(line=>line.trim().split(' ')[0]);
 assert.deepEqual(columns,legacyIntegrationSpec().columns.map(c=>c.name));
 assert.match(ddl,/provider VARCHAR\(80\)/);assert.match(ddl,/name VARCHAR\(180\)/);
 assert.match(ddl,/secrets_encrypted TEXT NULL/);assert.match(ddl,/enabled BOOLEAN NOT NULL DEFAULT TRUE/);
 assert.match(ddl,/created_at TIMESTAMP/);assert.match(ddl,/ON DELETE CASCADE/);
});

test('002 collision is preserved and every interrupted rename/create boundary resumes',async()=>{
 for(const state of [null,'running','failed'])for(const boundary of [0,1,2,3]){
  const snapshot=schema();addTable(snapshot,legacyIntegrationSpec('integration_connections'));
  const f=fake({snapshot,state,failAt:boundary});
  if(boundary<3)await assert.rejects(runMigrations(f.db,files),/PROTOCOL_CONNECTION_LOST/);
  else await runMigrations(f.db,files);
  if(boundary<3){assert.equal(f.applied.has(file.name),false);const resumed=fake({snapshot:f.snapshot});await runMigrations(resumed.db,files);assert.equal(resumed.ledger.get(file.name).status,'applied');assert.equal(resumed.ddl.length,3-boundary);}
  const plan=planIntegrationRecovery(spec,snapshot);assert.deepEqual(plan.conflicts,[]);assert.deepEqual(plan.missing,[]);assert.equal(plan.legacy.state,'preserved');
  assert.equal(snapshot.columns.find(c=>c.table_name===LEGACY_INTEGRATION_TABLE&&c.column_name==='provider').column_type,'varchar(80)');
 }
});

test('committed rename with lost acknowledgement resumes without renaming or losing the archive',async()=>{
 const snapshot=schema();addTable(snapshot,legacyIntegrationSpec('integration_connections'));const f=fake({snapshot}),original=f.db.query;
 f.db.query=async(sql,args)=>{const result=await original(sql,args);if(sql.startsWith('RENAME TABLE'))throw Object.assign(new Error('Lost acknowledgement'),{code:'PROTOCOL_CONNECTION_LOST'});return result;};
 await assert.rejects(runMigrations(f.db,files),/PROTOCOL_CONNECTION_LOST/);
 const resumed=fake({snapshot});await runMigrations(resumed.db,files);assert.equal(resumed.ddl.some(s=>s.startsWith('RENAME')),false);assert.equal(resumed.ddl.length,2);
});

test('drift, occupied archive name and dependent objects stop legacy recovery before any DDL',async()=>{
 for(const change of [
  s=>{s.columns.find(c=>c.column_name==='name').column_type='varchar(181)';},
  s=>{s.columns.find(c=>c.column_name==='enabled').column_default='0';},
  s=>{s.foreignKeys[0].delete_rule='RESTRICT';},
  s=>{s.tables.at(-1).table_collation='utf8mb4_bin';},
  s=>{addTable(s,legacyIntegrationSpec());},
  s=>{addTable(s,spec.tables[1]);},
  s=>{s.incomingReferences.push({source_table:'custom_reference',referenced_table:'integration_connections'});},
  s=>{s.dependentViews.push({source_view:'custom_view'});},
  s=>{s.triggers.push({table_name:'integration_connections',trigger_name:'custom_trigger'});}
 ]){const snapshot=schema();addTable(snapshot,legacyIntegrationSpec('integration_connections'));change(snapshot);const f=fake({snapshot});await assert.rejects(runMigrations(f.db,files),/KONTUR_INTEGRATION_SCHEMA_CONFLICT/);assert.equal(f.ddl.length,0);}
});

test('archive drift after an interrupted rename cannot be silently accepted',async()=>{
 const snapshot=schema();addTable(snapshot,legacyIntegrationSpec());snapshot.columns.find(c=>c.column_name==='secrets_encrypted').is_nullable='NO';
 const f=fake({snapshot});await assert.rejects(runMigrations(f.db,files),/secrets_encrypted/);assert.equal(f.ddl.length,0);
});

test('status reports legacy preservation without leaking its DDL or data',async()=>{
 const snapshot=schema();addTable(snapshot,legacyIntegrationSpec('integration_connections'));const f=fake({snapshot});
 const report=await migrationStatus(f.db,files);
 assert.deepEqual(report.recovery_021.legacy,{source:'integration_connections',target:LEGACY_INTEGRATION_TABLE,state:'rename_pending'});
 assert.deepEqual(report.recovery_021.present,['integration_connections']);
 assert.deepEqual(report.recovery_021.missing.map(t=>t.name),['integration_connections','integration_deliveries']);assert.deepEqual(report.recovery_021.conflicts,[]);
 assert.equal(f.writes.length,0);assert.equal(JSON.stringify(report).includes('RENAME TABLE'),false);
});

test('all shipped CREATE TABLE name collisions have an explicit recovery path',async()=>{
 const names=await fs.readdir(new URL('./migrations/',import.meta.url)),definitions=new Map();
 for(const name of names.filter(n=>n.endsWith('.sql')).sort()){
  const sql=await fs.readFile(new URL(`./migrations/${name}`,import.meta.url),'utf8');
  for(const match of sql.matchAll(/CREATE TABLE(?: IF NOT EXISTS)?\s+(\w+)/gi)){const occurrences=definitions.get(match[1])||[];occurrences.push(name);definitions.set(match[1],occurrences);}
 }
 assert.deepEqual([...definitions].filter(([,versions])=>versions.length>1),[['integration_connections',['002_platform_modules.sql','021_integrations.sql']]]);
});
