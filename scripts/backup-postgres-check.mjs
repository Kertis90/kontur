import {spawnSync} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {resolve,join,sep} from 'node:path';
import {Readable} from 'node:stream';
import assert from 'node:assert/strict';
import {encryptBackup,decryptBackup} from './backup-crypto.mjs';

const root=resolve('.'),directory=await mkdtemp(join(root,'.backup-test-'));
const target=`kontur_restore_${randomUUID().replaceAll('-','')}`;
const compose=['compose','-p','kontur-browser-check','-f','deploy/tests/browser.compose.yaml','exec','-T','postgres'];
// Выполняет штатные клиенты исключительно в одноразовом контейнере тестов.
function run(program,args,input) {
 const result=spawnSync('docker',[...compose,program,'--username=kontur_test',...args],{input,maxBuffer:64*1024*1024});
 if(result.status!==0)throw new Error(`${program}: ${result.stderr?.toString()||result.error?.message||result.status}`);
 return result.stdout;
}
// Сверяет содержимое всех таблиц, включая JSON, даты и бинарные данные.
function snapshot(database) {
 const tables=run('psql',['-X','-A','-t','--dbname='+database,'-c',"SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"]).toString().trim().split(/\r?\n/);
 const queries=tables.map(table=>{
  assert.match(table,/^[a-z_][a-z_0-9]*$/);
  return `SELECT '${table}',COUNT(*),md5(COALESCE(string_agg(row_to_json(t)::text,E'\\n' ORDER BY row_to_json(t)::text COLLATE "C"),'')) FROM "${table}" t`;
 });
 return run('psql',['-X','-A','-t','--set=ON_ERROR_STOP=1','--dbname='+database],queries.join('\nUNION ALL\n')+';').toString().trim().split(/\r?\n/).sort().join('\n');
}
// Читает определения служебных обработчиков без внутренних системных триггеров.
function triggers(database) {
 return run('psql',['-X','-A','-t','--dbname='+database,'-c',"SELECT tgname,pg_get_triggerdef(oid) FROM pg_trigger WHERE NOT tgisinternal ORDER BY tgrelid::regclass::text,tgname"]).toString();
}
try {
 const before=snapshot('kontur_browser_test'),beforeTriggers=triggers('kontur_browser_test');
 const dump=run('pg_dump',['--no-owner','--no-privileges','--encoding=UTF8','--dbname=kontur_browser_test']);
 const file=join(directory,'database.kbk'),key=randomBytes(32);
 await encryptBackup(Readable.from([dump]),file,key,{engine:'postgres',database:'kontur_browser_test'});
 let executed=false;await assert.rejects(()=>decryptBackup(file,randomBytes(32),()=>{executed=true;}));assert.equal(executed,false);
 run('createdb',[target]);
 await decryptBackup(file,key,async sql=>run('psql',['-X','--set=ON_ERROR_STOP=1','--single-transaction','--dbname='+target],await readFile(sql)));
 assert.deepEqual(snapshot(target),before);assert.equal(triggers(target),beforeTriggers);
 console.log(`PostgreSQL: защищённая копия восстановлена; совпали ${before.split('\n').length} таблиц, их содержимое и обработчики.`);
} finally {
 run('dropdb',['--if-exists',target]);
 const safe=resolve(directory);if(!safe.startsWith(root+sep)||!safe.slice(root.length+1).startsWith('.backup-test-'))throw new Error('Временная копия вне проекта');
 await rm(safe,{recursive:true,force:true});
}
