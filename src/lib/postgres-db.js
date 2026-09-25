import pg from 'pg';
import {postgresConfig} from './database-config.js';
import {postgresSql} from './postgres-sql.js';

// Сохраняет прежние типы API: числа, строковые даты UTC и разобранные JSON.
const types={getTypeParser(oid,format) {
 if([20,1700].includes(oid))return Number;
 if([1082,1114,1184,1083].includes(oid))return value=>value;
 return pg.types.getTypeParser(oid,format);
}};
// Приводит ошибки ограничений к кодам, которые уже обрабатывают прикладные проверки.
function databaseError(error) {
 const codes={'23505':'ER_DUP_ENTRY','23503':'ER_NO_REFERENCED_ROW_2','23514':'ER_CHECK_CONSTRAINT_VIOLATED','40P01':'ER_LOCK_DEADLOCK','40001':'ER_LOCK_DEADLOCK','55P03':'ER_LOCK_WAIT_TIMEOUT'};
 if(codes[error.code]){error.postgresCode=error.code;error.code=codes[error.code];}
 return error;
}
// Выполняет параметризованный запрос и сохраняет контракт существующих mysql2-вызовов.
async function query(client,sql,params=[]) {
 try {
  const lock=/^\s*SELECT\s+(GET_LOCK|RELEASE_LOCK)\(\?,\s*0\)|^\s*SELECT\s+(RELEASE_LOCK)\(\?\)/i.exec(sql);
  if(lock) {
   const operation=(lock[1]||lock[2]).toUpperCase(),alias=/\bAS\s+(\w+)/i.exec(sql)?.[1]||'locked';
   const result=await client.query({text:`SELECT ${operation==='GET_LOCK'?'pg_try_advisory_lock':'pg_advisory_unlock'}(hashtextextended($1,0))::int AS "${alias}"`,values:params.slice(0,1),types});
   return [result.rows,result.fields];
  }
  const result=await client.query({text:postgresSql(sql,params),values:params.map(value=>typeof value==='boolean'?Number(value):value),types});
  if(['INSERT','UPDATE','DELETE'].includes(result.command))return [{insertId:result.rows[0]?.id||0,affectedRows:result.rowCount,changedRows:result.rowCount},result.fields];
  return [result.rows,result.fields];
 }catch(error){throw databaseError(error);}
}
// Закрепляет одну сессию на время транзакции или именованной блокировки.
function wrapConnection(client) {
 return {
  // Выполняет запрос в закреплённой сессии.
  query(sql,params){return query(client,sql,params);},
  // Начинает транзакцию на том же подключении.
  beginTransaction(){return client.query('BEGIN');},
  // Сохраняет изменения транзакции.
  commit(){return client.query('COMMIT');},
  // Отменяет изменения транзакции после ошибки.
  rollback(){return client.query('ROLLBACK');},
  // Очищает оставшиеся блокировки перед возвращением сессии в пул.
  release(){client.query('SELECT pg_advisory_unlock_all()').then(()=>client.release(),()=>client.release(true));},
  // Завершает выделенное подключение к PostgreSQL.
  end(){return client.end();},
 };
}
// Создаёт общий пул PostgreSQL с тем же интерфейсом, что и существующий пул MySQL.
export function createPostgresPool() {
 const pool=new pg.Pool(postgresConfig());
 // Не выводит запросы, пароли и адреса из ошибок фоновых соединений.
 pool.on('error',error=>console.error('PostgreSQL: соединение закрыто',error.code||'CONNECTION_CLOSED'));
 return {
  // Выполняет отдельный запрос через пул.
  query(sql,params){return query(pool,sql,params);},
  // Выдаёт сессию для атомарной операции.
  async getConnection(){return wrapConnection(await pool.connect());},
  // Закрывает пул при остановке процесса.
  end(){return pool.end();},
 };
}
// Открывает выделенное подключение для начального заполнения БД.
export async function createPostgresConnection() {
 const client=new pg.Client(postgresConfig());await client.connect();return wrapConnection(client);
}
