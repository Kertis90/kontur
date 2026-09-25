import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import vm from 'node:vm';
import pg from 'pg';
import {browserEnv} from './browser-env.mjs';
import {postgresConfig} from '../src/lib/database-config.js';
import {postgresSql,sqlTokens} from '../src/lib/postgres-sql.js';
Object.assign(process.env,browserEnv,{DB_ENGINE:'postgres'});
// Находит статические SQL-строки приложения; строки с шаблонными подстановками проверяются интеграционными сценариями.
async function files(directory) {
 const result=[];for(const entry of await readdir(directory,{withFileTypes:true})){const file=join(directory,entry.name);if(entry.isDirectory())result.push(...await files(file));else if(entry.name.endsWith('.js')&&!/postgres|migration|api-docs/.test(entry.name))result.push(file);}return result;
}
const client=new pg.Client(postgresConfig());await client.connect();let checked=0,skipped=0;const failures=[],seen=new Set();
try {
 for(const file of [...await files('src/lib'),...await files('app/api')]) {
  const text=await readFile(file,'utf8');
  for(const literal of text.matchAll(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/gs)) {
   if(!/^['"`]\s*(SELECT|INSERT|UPDATE|DELETE|WITH RECURSIVE)\s+/i.test(literal[0]))continue;
   if(literal[0].includes('${')){skipped++;continue;}
   let sql;try{sql=vm.runInNewContext(literal[0],{},{timeout:100});}catch{continue;}
   if(seen.has(sql))continue;seen.add(sql);
   if(/GET_LOCK|RELEASE_LOCK|DATABASE\(\)|INSERT INTO work_plan_dependencies\(/i.test(sql)){skipped++;continue;}
   try {
    const converted=postgresSql(sql),count=sqlTokens(sql).filter(t=>/^\$\d+$/.test(t)).length;
    await client.query('EXPLAIN '+converted,Array(count).fill(null));checked++;
   }catch(error){failures.push({file,line:text.slice(0,literal.index).split('\n').length,code:error.code||'TRANSLATION',message:error.message});}
  }
 }
 console.log(JSON.stringify({checked,skipped,failures},null,2));if(failures.length)process.exitCode=1;
}finally{await client.end();}
