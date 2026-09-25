import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {browserEnv} from './browser-env.mjs';
Object.assign(process.env,browserEnv);
const {db,one,rows,transaction}=await import('../src/lib/db.js');
const tag=randomUUID().replaceAll('-',''),email=`database-${tag}@example.invalid`;
const owner=await one('SELECT * FROM users WHERE email=?',[browserEnv.ADMIN_EMAIL]);
try {
 const {AUTOMATIC_REVIEW_FILTER}=await import('../src/lib/agent-review-rules.js');
 // Реальные запросы обязаны исключать пробные запуски и ручные согласования на обеих БД.
 for(const field of ['dry_run','review_required'])for(const value of [undefined,false,true,null,0,1,'false','null']) {
  const sample=await one(`SELECT CASE WHEN ${AUTOMATIC_REVIEW_FILTER} THEN 1 ELSE 0 END AS allowed FROM (SELECT CAST(? AS JSON) AS source_meta_json) sample`,[JSON.stringify({[field]:value})]);
  assert.equal(sample.allowed,Number(value===undefined||value===false),`${field}: ${String(value)}`);
 }
 const connection=await db.getConnection();
 try {
  await connection.beginTransaction();
  const [workspace]=await connection.query('INSERT INTO workspaces(name,slug) VALUES(?,?)',['Проверка базы',tag]);
  assert.ok(workspace.insertId>1,'Следующий номер не пересекается с seed');
  const [group]=await connection.query('INSERT INTO project_groups(workspace_id,name) VALUES(?,?)',[owner.workspace_id,'Проверка группы']);assert.ok(group.insertId>2);
  await connection.rollback();
 }finally{connection.release();}
 const user=await rows("INSERT INTO users(workspace_id,email,display_name,password_hash) VALUES(?,?,?,?)",[owner.workspace_id,email,'Ёлка — проверка UTF-8','first-hash']);
 assert.equal((await one('SELECT id FROM users WHERE email=?',[email.toUpperCase()])).id,user.insertId);
 await assert.rejects(()=>rows('INSERT INTO users(workspace_id,email,display_name) VALUES(?,?,?)',[owner.workspace_id,email.toUpperCase(),'Дубликат']),{code:'ER_DUP_ENTRY'});
 const session=randomUUID();
 await rows('INSERT INTO user_sessions(id,user_id,expires_at) VALUES(?,?,DATE_ADD(CURRENT_TIMESTAMP,INTERVAL 1 DAY))',[session,user.insertId]);
 const token=await rows('INSERT INTO api_tokens(workspace_id,user_id,name,token_prefix,token_hash,scopes_json) VALUES(?,?,?,?,?,?)',[owner.workspace_id,user.insertId,'Проверка','test',tag.padEnd(64,'0'),'[]']);
 await rows('UPDATE users SET password_hash=? WHERE id=?',['second-hash',user.insertId]);
 assert.ok((await one('SELECT revoked_at FROM user_sessions WHERE id=?',[session])).revoked_at);
 assert.ok((await one('SELECT revoked_at FROM api_tokens WHERE id=?',[token.insertId])).revoked_at);
 const decimal=await one('SELECT SUM(IF(id=?,1.75,0)) AS total FROM users',[user.insertId]);assert.equal(decimal.total,1.75);
 const lockName=`check-${tag}`,left=await db.getConnection(),right=await db.getConnection();
 try {
  assert.equal((await left.query('SELECT GET_LOCK(?,0) AS acquired',[lockName]))[0][0].acquired,1);
  assert.equal((await right.query('SELECT GET_LOCK(?,0) AS acquired',[lockName]))[0][0].acquired,0);
  await left.query('SELECT RELEASE_LOCK(?)',[lockName]);
  assert.equal((await right.query('SELECT GET_LOCK(?,0) AS acquired',[lockName]))[0][0].acquired,1);
  await right.query('SELECT RELEASE_LOCK(?)',[lockName]);
 }finally{left.release();right.release();}
 const marker=new Error('Ожидаемый откат');
 await assert.rejects(()=>transaction(async c=>{await c.query('UPDATE users SET display_name=? WHERE id=?',['Не сохранять',user.insertId]);throw marker;}),error=>error===marker);
 assert.equal((await one('SELECT display_name FROM users WHERE id=?',[user.insertId])).display_name,'Ёлка — проверка UTF-8');
 const project=await one('SELECT * FROM projects WHERE workspace_id=? ORDER BY id LIMIT 1',[owner.workspace_id]);
 const [stages]=await db.query('SELECT * FROM workflow_stages WHERE workflow_id=?',[project.workflow_id]);
 const open=stages.find(s=>!s.is_done),done=stages.find(s=>s.is_done);
 const task=await transaction(async c=>{await c.query('SELECT id FROM projects WHERE id=? FOR UPDATE',[project.id]);const [[counter]]=await c.query('SELECT COALESCE(MAX(task_number),0)+1 AS number FROM tasks WHERE project_id=?',[project.id]);const [created]=await c.query('INSERT INTO tasks(project_id,stage_id,task_number,title,reporter_id) VALUES(?,?,?,?,?)',[project.id,open.id,counter.number,'История состояния',owner.id]);return created.insertId;});
 assert.equal((await one('SELECT COUNT(*) AS total FROM task_state_events WHERE task_id=?',[task])).total,1);
 await rows('UPDATE tasks SET stage_id=? WHERE id=?',[done.id,task]);assert.ok((await one('SELECT completed_at FROM tasks WHERE id=?',[task])).completed_at);
 assert.equal((await one('SELECT COUNT(*) AS total FROM task_state_events WHERE task_id=?',[task])).total,2);
 await rows('UPDATE tasks SET stage_id=? WHERE id=?',[open.id,task]);assert.equal((await one('SELECT completed_at FROM tasks WHERE id=?',[task])).completed_at,null);
 await assert.rejects(()=>rows('UPDATE tasks SET progress=101 WHERE id=?',[task]));
 await rows('DELETE FROM tasks WHERE id=?',[task]);
 await rows('DELETE FROM users WHERE id=?',[user.insertId]);
 if(browserEnv.DB_ENGINE==='postgres') {
  const {default:pg}=await import('pg'),{postgresConfig}=await import('../src/lib/database-config.js'),{runPostgresMigrations}=await import('../src/lib/postgres-migrations.js');
  const client=new pg.Client(postgresConfig()),schema=`kontur_migration_test_${tag}`;await client.connect();
  try {
   await client.query(`CREATE SCHEMA ${schema}`);await client.query(`SET search_path=${schema}`);
   const files=[{name:'001_check.sql',sql:'CREATE TABLE example(id integer); SELECT 1 / current_setting(\'kontur.test_divisor\')::integer;'}];
   await client.query("SET kontur.test_divisor='0'");await assert.rejects(()=>runPostgresMigrations(client,files));
   assert.equal((await client.query("SELECT to_regclass('example') AS name")).rows[0].name,null);
   assert.equal((await client.query('SELECT status FROM schema_migration_runs')).rows[0].status,'failed');
   await client.query("SET kontur.test_divisor='1'");await runPostgresMigrations(client,files);await runPostgresMigrations(client,files);
   assert.equal((await client.query('SELECT COUNT(*)::int AS total FROM schema_migrations')).rows[0].total,1);
   await assert.rejects(()=>runPostgresMigrations(client,[{...files[0],sql:files[0].sql+' --changed'}]),/История PostgreSQL изменена/);
  }finally{await client.query(`DROP SCHEMA ${schema} CASCADE`);await client.end();}
 }
 console.log(`${browserEnv.DB_ENGINE}: номера после seed, UTF-8, уникальность, откат, блокировки, отзыв сессий/токенов, история и ограничения задач проверены.`);
} finally {await db.end();}
