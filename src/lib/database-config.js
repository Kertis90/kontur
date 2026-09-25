import {mysqlSslConfig} from './mysql-config.js';

// Выбирает одну БД для всей установки и отклоняет опечатки вместо скрытого переключения.
export function databaseEngine(env=process.env) {
 const engine=(env.DB_ENGINE||'mysql').trim().toLowerCase();
 if(!['mysql','postgres'].includes(engine))throw new Error('DB_ENGINE должен быть mysql или postgres');
 return engine;
}
// Читает отдельные настройки PostgreSQL, не используя пароль существующей MySQL.
export function postgresConfig(env=process.env) {
 const enabled=value=>/^(1|true|yes|on)$/i.test(value||'');
 return {host:env.POSTGRES_HOST||'127.0.0.1',port:Number(env.POSTGRES_PORT||5432),
  user:env.POSTGRES_USER||'kontur',password:env.POSTGRES_PASSWORD,database:env.POSTGRES_DATABASE||'kontur_work',
  max:Number(env.POSTGRES_POOL_SIZE||12),connectionTimeoutMillis:Number(env.POSTGRES_CONNECT_TIMEOUT||10000),
  options:'-c timezone=UTC -c search_path=public',
  ssl:enabled(env.POSTGRES_SSL)?{rejectUnauthorized:env.POSTGRES_SSL_REJECT_UNAUTHORIZED!=='false',...(env.POSTGRES_SSL_CA?{ca:env.POSTGRES_SSL_CA.replace(/\\n/g,'\n')}:{})}:false};
}
// Сохраняет прежние настройки подключения MySQL для существующих установок.
export function mysqlConfig() {
 return {host:process.env.MYSQL_HOST||'127.0.0.1',port:Number(process.env.MYSQL_PORT||3306),
  user:process.env.MYSQL_USER||'kontur',password:process.env.MYSQL_PASSWORD,database:process.env.MYSQL_DATABASE||'kontur_work',
  charset:'utf8mb4',connectTimeout:Number(process.env.MYSQL_CONNECT_TIMEOUT||10000),dateStrings:true,decimalNumbers:true,ssl:mysqlSslConfig()};
}
