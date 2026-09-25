import {spawn} from 'node:child_process';
import {createReadStream} from 'node:fs';
import {stat,rm} from 'node:fs/promises';
import {basename,resolve} from 'node:path';
import {pipeline} from 'node:stream/promises';
import {backupKey,encryptBackup,decryptBackup,fileSha256} from './backup-crypto.mjs';
import {restoreSql} from './backup-sql.mjs';
import {databaseEngine} from '../src/lib/database-config.js';
import {postgresCommand} from './backup-postgres.mjs';

const [action,...args]=process.argv.slice(2),option=name=>{const i=args.indexOf(name);return i<0?null:args[i+1];};
const database=value=>{if(!/^[a-zA-Z0-9_]{1,64}$/.test(value||''))throw new Error('Database name must contain only letters, digits and underscores');return value;};
// Запускает клиент MySQL с паролем в окружении и проверкой отдельного сервера восстановления.
function mysql(program,extra,{restore=false}={}){
 const prefix=restore?'RESTORE_':'',env={...process.env,MYSQL_PWD:process.env[`${prefix}MYSQL_PASSWORD`]||''};let command=program,params;
 const flags=['--default-character-set=utf8mb4',`--user=${process.env[`${prefix}MYSQL_USER`]||'kontur'}`];
 if(args.includes('--compose')){const service=option('--service')||(restore?'mysql-restore':'mysql');if(restore&&service==='mysql')throw new Error('Use a separate mysql-restore service');command='docker';params=['compose','-f',option('--compose-file')||(restore?'deploy/compose.restore.yaml':'compose.yaml'),'exec','-T','-e','MYSQL_PWD',service,program,...flags,...extra];}
 else{const host=process.env[`${prefix}MYSQL_HOST`]||(restore?'':'127.0.0.1');if(!host)throw new Error('RESTORE_MYSQL_HOST is required');if(restore&&host===(process.env.MYSQL_HOST||'127.0.0.1'))throw new Error('Restore requires an isolated MySQL server');const defaults=process.env[`${prefix}MYSQL_DEFAULTS_FILE`];params=[...(defaults?[`--defaults-extra-file=${defaults}`]:[]),`--host=${host}`,`--port=${process.env[`${prefix}MYSQL_PORT`]||3306}`,...flags,...extra];}
 const child=spawn(command,params,{env,stdio:['pipe','pipe','pipe']});child.stderr.resume();const done=new Promise((resolve,reject)=>{child.once('error',()=>reject(new Error(`${program} could not start`)));child.once('exit',code=>code===0?resolve():reject(new Error(`${program} exited unsuccessfully; inspect server permissions and connectivity`)));});done.catch(()=>{});return {child,done};
}
// Создаёт, проверяет или восстанавливает защищённую копию в явно выбранный отдельный сервер.
async function main(){
 if(!['backup','verify','restore'].includes(action))throw new Error('Usage: node scripts/backup.mjs backup --output FILE [--compose | --input-sql FILE] [--s3] | verify --input FILE | restore --input FILE --database kontur_restore_NAME --isolated [--compose]');
 const key=backupKey(process.env.BACKUP_ENCRYPTION_KEY);
 const engine=databaseEngine(),postgres=(program,extra,options={})=>postgresCommand(program,extra,{args,option,...options});
 if(action==='backup'){
  if(engine==='postgres'&&args.includes('--pitr'))throw new Error('Для восстановления PostgreSQL на момент времени настройте отдельное архивирование WAL; pg_dump создаёт логическую копию');
  const name=database(process.env[engine==='postgres'?'POSTGRES_DATABASE':'MYSQL_DATABASE']||'kontur_work'),output=resolve(option('--output')||`kontur-${Date.now()}.kbk`),sqlPath=option('--input-sql');
  let input,command;if(sqlPath){if((await stat(sqlPath)).size<100)throw new Error('SQL dump is empty or incomplete');input=createReadStream(sqlPath);}else{command=engine==='postgres'?postgres('pg_dump',['--no-owner','--no-privileges','--encoding=UTF8',`--dbname=${name}`]):mysql('mysqldump',['--single-transaction','--quick','--no-tablespaces','--set-gtid-purged=OFF','--hex-blob','--routines','--events',...(args.includes('--pitr')?['--source-data=2']:[]),name]);command.child.stdin.end();input=command.child.stdout;}
  let created=false;try{const result=await encryptBackup(input,output,key,{engine,database:name,pitr:args.includes('--pitr'),application:'kontur-work'});created=true;if(command)await command.done;
   if(args.includes('--s3')){const target=process.env.BACKUP_S3_BUCKET;if(!target||target===(process.env.S3_BUCKET||'kontur-attachments'))throw new Error('Use a separate BACKUP_S3_BUCKET');const {storage}=await import('../src/lib/storage.js');const objectKey=`backups/${name}/${basename(output)}`;await storage().putObject(target,objectKey,createReadStream(output),result.size,{'Content-Type':'application/octet-stream','x-amz-meta-sha256':result.sha256});result.s3_key=objectKey;}
   console.log(JSON.stringify({file:output,...result}));
  }catch(e){command?.child.kill('SIGTERM');if(created&&command){try{await command.done;}catch{await rm(output,{force:true});}}throw e;}return;
 }
 const path=resolve(option('--input')||'');if(!option('--input'))throw new Error('--input is required');
 await decryptBackup(path,key,async(sql,metadata)=>{
  if(action==='verify'){console.log(JSON.stringify({authenticated:true,sql_bytes:(await stat(sql)).size,sha256:await fileSha256(path),metadata}));return;}
  if((metadata.engine||'mysql')!==engine)throw new Error('Копия создана для другой БД; восстановление не является переносом между MySQL и PostgreSQL');
  const target=database(option('--database'));if(!args.includes('--isolated')||!target.startsWith('kontur_restore_')||target===metadata.database)throw new Error('Restore requires --isolated and an empty kontur_restore_NAME database');
  if(engine==='postgres') {
   const check=postgres('psql',['--no-psqlrc','--tuples-only','--no-align','--set=ON_ERROR_STOP=1',`--dbname=${target}`,'--command',"SELECT COUNT(*) FROM information_schema.tables WHERE table_schema NOT IN ('information_schema','pg_catalog')"],{restore:true});
   check.child.stdin.end();let count='';for await(const chunk of check.child.stdout)count+=chunk.toString();await check.done;if(count.trim()!=='0')throw new Error('База восстановления не пуста');
   const restore=postgres('psql',['--no-psqlrc','--set=ON_ERROR_STOP=1','--single-transaction',`--dbname=${target}`],{restore:true});restore.child.stdout.resume();
   try{await pipeline(createReadStream(sql),restore.child.stdin);await restore.done;}catch(error){restore.child.kill('SIGTERM');throw error;}
   console.log(JSON.stringify({restored_to:target,source_database:metadata.database,engine}));return;
  }
  const check=mysql('mysql',['--batch','--skip-column-names','--execute',`SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${target}'`,target],{restore:true});check.child.stdin.end();let result='';for await(const chunk of check.child.stdout)result+=chunk.toString();await check.done;if(result.trim()!=='0')throw new Error('Restore target is not empty');
  const restore=mysql('mysql',['--binary-mode',target],{restore:true});restore.child.stdout.resume();try{await pipeline(createReadStream(sql),restoreSql,restore.child.stdin);await restore.done;}catch(e){restore.child.kill('SIGTERM');throw e;}console.log(JSON.stringify({restored_to:target,source_database:metadata.database,note:'Run migration status and application checks before accepting the restore.'}));
 });
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
