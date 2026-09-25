import test from 'node:test';
import assert from 'node:assert/strict';
import {databaseEngine,postgresConfig} from '../src/lib/database-config.js';
import {postgresSql,sqlTokens} from '../src/lib/postgres-sql.js';

// Сверяет выбор БД и отсутствие неявного переключения при опечатке.
test('database choice defaults to MySQL and rejects unknown engines',()=>{
 assert.equal(databaseEngine({}),'mysql');assert.equal(databaseEngine({DB_ENGINE:'Postgres'}),'postgres');
 assert.throws(()=>databaseEngine({DB_ENGINE:'postgresqlx'}));
 assert.equal(postgresConfig({MYSQL_PASSWORD:'never-reuse'}).password,undefined);
 assert.equal(postgresConfig({POSTGRES_SSL:'true'}).ssl.rejectUnauthorized,true);
});
// Проверяет, что кавычки, комментарии и вопросительные знаки не становятся параметрами.
test('PostgreSQL translator keeps SQL literals separate from parameters',()=>{
 const result=postgresSql("SELECT 'Что? TRUE IF(1,2,3)', 'O''Brien', `name` FROM users WHERE id=? /* ? */ AND email=? -- ?\n");
 assert.match(result,/'Что\? TRUE IF\(1,2,3\)'/);assert.match(result,/'O''Brien'/);
 assert.match(result,/"name"/);assert.match(result,/id = \$1/);assert.match(result,/email = \$2/);
 assert.equal(sqlTokens("SELECT 'a\\'b', ?")[1],"'a''b'");
 assert.throws(()=>sqlTokens("SELECT 'unfinished"));
});
// Различает логические суммы и числовые значения с вложенными условиями.
test('PostgreSQL sums keep decimal amounts and cast boolean predicates',()=>{
 assert.match(postgresSql("SELECT SUM(status='done') FROM tasks"),/SUM\(\(status = 'done'\)::integer\)/);
 assert.doesNotMatch(postgresSql('SELECT SUM(IF(user_id=?,amount,0)) FROM entries'),/::integer/);
 assert.match(postgresSql('SELECT IF(is_done,amount,0) FROM entries'),/is_done\)<>0/);
});
// Сохраняет обновление счётчика относительно существующей строки и исходные параметры.
test('PostgreSQL upsert uses verified business key and existing row references',()=>{
 const result=postgresSql('INSERT INTO user_favorites(user_id,items_json) VALUES(?,?) ON DUPLICATE KEY UPDATE items_json=VALUES(items_json),revision=revision+1',[7,'[]']);
 assert.match(result,/ON CONFLICT \(user_id\) DO UPDATE/);assert.match(result,/excluded \. items_json/);assert.match(result,/user_favorites \. revision \+ 1/);
 assert.match(postgresSql('INSERT IGNORE INTO users(workspace_id,email,display_name) VALUES(?,?,?)'),/ON CONFLICT DO NOTHING RETURNING id$/);
 assert.match(postgresSql('INSERT INTO integration_deliveries(id,connection_id,event_uuid) VALUES(?,?,?) ON DUPLICATE KEY UPDATE event_uuid=event_uuid'),/ON CONFLICT \(connection_id,event_uuid\)/);
});
// Выбирает заполненную связь плана вместо nullable-ключа другого типа зависимости.
test('PostgreSQL dependencies choose the non-null unique key',()=>{
 const sql='INSERT INTO work_plan_dependencies(item_id,depends_on_item_id,depends_on_task_id) VALUES(?,?,?) ON DUPLICATE KEY UPDATE item_id=VALUES(item_id)';
 assert.match(postgresSql(sql,[1,null,3]),/ON CONFLICT \(item_id,depends_on_task_id\)/);
 assert.match(postgresSql(sql,[1,2,null]),/ON CONFLICT \(item_id,depends_on_item_id\)/);
 assert.throws(()=>postgresSql(sql,[1,2,3]),/Неоднозначный/);
 assert.match(postgresSql(sql.replace('VALUES(?,?,?)','VALUES(COALESCE(?,?),?,?)'),[1,9,null,3]),/ON CONFLICT \(item_id,depends_on_task_id\)/);
});
// Сохраняет UTC и точность секунд, чтобы новые задания сразу становились доступными очереди.
test('PostgreSQL date expressions use statement time and parameterized intervals',()=>{
 const result=postgresSql('SELECT DATE_ADD(CURRENT_TIMESTAMP,INTERVAL ? DAY),UTC_DATE(),DATE_FORMAT(UTC_DATE(),\'%Y-%m-01\')');
 assert.match(result,/date_trunc\('second',statement_timestamp\(\) AT TIME ZONE 'UTC'\)/);
 assert.match(result,/\$1\)::double precision \* INTERVAL '1 day'/);
 assert.match(result,/date_trunc\('month',CURRENT_DATE\)/);
 assert.match(postgresSql('SELECT CURRENT_TIMESTAMP(6)'),/statement_timestamp/);
});
// Разбирает только известные пути JSON и сохраняет отдельное точное сравнение внешнего пользователя.
test('PostgreSQL JSON and binary expressions preserve data boundaries',()=>{
 assert.match(postgresSql("SELECT JSON_UNQUOTE(JSON_EXTRACT(config_json,'$.title')) FROM tasks"),/#> ARRAY\['title'\]/);
 assert.match(postgresSql('SELECT id FROM users WHERE BINARY external_subject=BINARY ?'),/external_subject COLLATE "C"/);
 assert.match(postgresSql('SELECT id FROM tasks WHERE ? IS NULL'),/\(\$1\)::text IS NULL/);
 assert.throws(()=>postgresSql("SELECT JSON_EXTRACT(config_json,'$[*]')"),/Неподдержанный путь/);
 assert.match(postgresSql("SELECT CAST('AS CHAR(80)' AS CHAR(80))"),/CAST\('AS CHAR\(80\)' AS text\)/);
});
