import test from 'node:test';
import assert from 'node:assert/strict';
import {runMigrations,migrationChecksum} from '../src/lib/migration-runner.js';
const files=[{name:'001_first.sql',sql:'CREATE FIRST'},{name:'002_second.sql',sql:'CREATE SECOND'}];
function fake({legacy=[],journal=[],lock=1,fail=null}={}){
 const applied=new Set(legacy),ledger=new Map(journal.map(r=>[r.version,{...r}])),executed=[];let released=false;
 const db={beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},query:async(sql,args=[])=>{
  if(sql.startsWith('SELECT GET_LOCK'))return [[{acquired:lock}]];
  if(sql.startsWith('SELECT RELEASE_LOCK')){released=true;return [[]];}
  if(sql.startsWith('CREATE TABLE')||sql.startsWith('SET '))return [[]];
  if(sql==='SELECT version FROM schema_migrations')return [[...applied].map(version=>({version}))];
  if(sql==='SELECT * FROM schema_migration_runs')return [[...ledger.values()]];
  if(sql.startsWith('INSERT INTO schema_migration_runs')){ledger.set(args[0],{version:args[0],checksum:args[1],status:sql.includes("'adopted'")?'adopted':'running'});return [{}];}
  if(sql.startsWith('INSERT INTO schema_migrations(')){applied.add(args[0]);return [{}];}
  if(sql.startsWith('UPDATE schema_migration_runs')){ledger.get(args.at(-1)).status=sql.includes("'failed'")?'failed':'applied';return [{}];}
  executed.push(sql);if(sql===fail)throw Object.assign(new Error('DDL interrupted'),{code:'ER_TEST'});return [{}];
 }};return {db,applied,ledger,executed,get released(){return released;}};
}
test('migrations execute once, record checksums, and release the connection lock',async()=>{const f=fake();await runMigrations(f.db,files);await runMigrations(f.db,files);assert.deepEqual(f.executed,files.map(f=>f.sql));assert.equal(f.ledger.get(files[0].name).checksum,migrationChecksum(files[0].sql));assert.equal(f.released,true);});
test('migration lock contention performs no schema work',async()=>{const f=fake({lock:0});await assert.rejects(runMigrations(f.db,files),/блокировку/);assert.equal(f.executed.length,0);assert.equal(f.released,false);});
test('interrupted DDL leaves a durable marker and cannot be retried blindly',async()=>{const f=fake({fail:'CREATE SECOND'});await assert.rejects(runMigrations(f.db,files),/частично/);assert.equal(f.applied.has(files[0].name),true);assert.equal(f.ledger.get(files[1].name).status,'failed');const count=f.executed.length;await assert.rejects(runMigrations(f.db,files),/не завершена/);assert.equal(f.executed.length,count);assert.equal(f.released,true);});
test('checksum changes stop before applying any new file',async()=>{const f=fake();await runMigrations(f.db,[files[0]]);await assert.rejects(runMigrations(f.db,[{...files[0],sql:'ALTERED'},files[1]]),/Изменён файл/);assert.equal(f.executed.length,1);});
test('legacy history is explicitly adopted instead of pretending historical checksum proof',async()=>{const f=fake({legacy:[files[0].name]});await runMigrations(f.db,files);assert.equal(f.ledger.get(files[0].name).status,'adopted');assert.deepEqual(f.executed,['CREATE SECOND']);});
test('missing future migrations and unknown unfinished markers prevent downgrade',async()=>{for(const f of [fake({legacy:['003_missing.sql']}),fake({journal:[{version:'003_missing.sql',status:'running',checksum:'abc'}]})]){await assert.rejects(runMigrations(f.db,files),/отсутствующая/);assert.equal(f.executed.length,0);}});
test('other unfinished migrations stay blocked and expose the saved original MySQL code',async()=>{
 const f=fake({legacy:[files[0].name],journal:[{version:files[1].name,checksum:migrationChecksum(files[1].sql),status:'failed',error_code:'ER_TABLEACCESS_DENIED_ERROR'}]});
 await assert.rejects(runMigrations(f.db,files),/не завершена.*ER_TABLEACCESS_DENIED_ERROR/);assert.equal(f.executed.length,0);assert.equal(f.released,true);
});
