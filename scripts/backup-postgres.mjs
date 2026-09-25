import {spawn} from 'node:child_process';

// Запускает штатный клиент PostgreSQL, передавая пароль через окружение и проверяя изоляцию восстановления.
export function postgresCommand(program,extra,{args=[],option,restore=false}={}) {
 const prefix=restore?'RESTORE_':'',env={...process.env,PGPASSWORD:process.env[`${prefix}POSTGRES_PASSWORD`]||''};
 let command=program,params;
 const user=process.env[`${prefix}POSTGRES_USER`]||'kontur';
 if(args.includes('--compose')) {
  const service=option('--service')||(restore?'postgres-restore':'postgres');
  if(restore&&service==='postgres')throw new Error('Восстановление требует отдельный сервис postgres-restore');
  const files=option('--compose-file')?[option('--compose-file')]:(restore?['deploy/compose.restore.postgres.yaml']:['compose.yaml','compose.postgres.yaml']);
  command='docker';params=['compose',...files.flatMap(file=>['-f',file]),'exec','-T','-e','PGPASSWORD',service,program,`--username=${user}`,...extra];
 }else {
  const host=process.env[`${prefix}POSTGRES_HOST`]||(restore?'':'127.0.0.1'),port=process.env[`${prefix}POSTGRES_PORT`]||'5432';
  if(!host)throw new Error('Укажите RESTORE_POSTGRES_HOST отдельного сервера');
  if(restore&&host===(process.env.POSTGRES_HOST||'127.0.0.1')&&port===(process.env.POSTGRES_PORT||'5432'))throw new Error('Восстановление требует отдельный сервер PostgreSQL');
  env.PGSSLMODE=process.env[`${prefix}POSTGRES_SSLMODE`]||(/^(true|1)$/i.test(process.env[`${prefix}POSTGRES_SSL`]||'')?'verify-full':'disable');
  if(process.env[`${prefix}POSTGRES_SSL_ROOT_CERT`])env.PGSSLROOTCERT=process.env[`${prefix}POSTGRES_SSL_ROOT_CERT`];
  params=[`--host=${host}`,`--port=${port}`,`--username=${user}`,...extra];
 }
 const child=spawn(command,params,{env,stdio:['pipe','pipe','pipe']});child.stderr.resume();
 const done=new Promise((resolve,reject)=>{child.once('error',()=>reject(new Error(`Не удалось запустить ${program}`)));child.once('exit',code=>code===0?resolve():reject(new Error(`${program}: проверьте подключение, права и версию клиента`)));});
 done.catch(()=>{});return {child,done};
}
