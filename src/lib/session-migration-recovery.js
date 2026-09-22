import {createHash} from 'node:crypto';

export const SESSION_MIGRATION_VERSION='013_sessions_and_directory.sql';
export const SESSION_MIGRATION_CHECKSUM='ec568201f8c33552033dffaa39fb2b069f273cdcbf9a7438143d908e7af4dac4';
const hash=sql=>createHash('sha256').update(sql,'utf8').digest('hex');
const currentTimestamp=value=>String(value).toLowerCase().replace(/current_timestamp\((?:0)?\)/g,'current_timestamp');
const typeName=value=>String(value).toLowerCase().replace(/\b(bigint|tinyint|int)\(\d+\)/g,'$1').replace(/\s+/g,' ').trim();
function splitDefinitions(text){
 const result=[];let depth=0,quote=false,start=0;
 for(let i=0;i<text.length;i++){const char=text[i];if(char==="'")quote=!quote;if(quote)continue;if(char==='(')depth++;if(char===')')depth--;if(char===','&&depth===0){result.push(text.slice(start,i).trim());start=i+1;}}
 result.push(text.slice(start).trim());return result;
}
function columnDefinition(definition){
 const match=/^(\w+)\s+(BIGINT(?: UNSIGNED)?|INT(?: UNSIGNED)?|CHAR\(\d+\)|VARCHAR\(\d+\)|TEXT|DATETIME|BOOLEAN|JSON)(?=\s|$)([\s\S]*)$/i.exec(definition);
 if(!match)throw new Error('Неизвестный столбец в описании восстановления 013');
 const [,name,sqlType,rest]=match,primary=/\bPRIMARY KEY\b/.test(rest),type=sqlType==='BOOLEAN'?'tinyint':sqlType.toLowerCase();
 const defaultValue=/\bDEFAULT\s+(CURRENT_TIMESTAMP|FALSE|TRUE|\d+|'[^']*')/.exec(rest)?.[1];
 return {name,type,nullable:!primary&&!/\bNOT NULL\b/.test(rest),primary,default:defaultValue===undefined?null:defaultValue==='FALSE'?'0':defaultValue==='TRUE'?'1':defaultValue.startsWith("'")?defaultValue.slice(1,-1):currentTimestamp(defaultValue),onUpdate:/ON UPDATE CURRENT_TIMESTAMP/.test(rest)};
}
export function sessionRecoverySpec(sql){
 if(hash(sql)!==SESSION_MIGRATION_CHECKSUM)throw new Error('Автовосстановление 013 доступно только для неизменённого файла поставки');
 const tables=[],triggers=[],columns=[];
 for(const statement of sql.split(';').map(s=>s.trim()).filter(Boolean)){
  let match=/^CREATE TABLE (\w+) \(([\s\S]*)\)$/.exec(statement);
  if(match){const table={name:match[1],columns:[],indexes:[],foreignKeys:[],sql:statement};for(const definition of splitDefinitions(match[2])){
   let m=/^KEY\(([^)]+)\)$/.exec(definition);if(m){table.indexes.push({columns:m[1].split(',').map(s=>s.trim()),unique:false});continue;}
   m=/^FOREIGN KEY\((\w+)\) REFERENCES (\w+)\((\w+)\) ON DELETE CASCADE$/.exec(definition);if(m){table.foreignKeys.push({column:m[1],table:m[2],referenced:m[3]});continue;}
   const column=columnDefinition(definition);table.columns.push(column);if(column.primary)table.indexes.push({columns:[column.name],unique:true,primary:true});
  }tables.push(table);continue;}
  match=/^CREATE TRIGGER (\w+) (AFTER|BEFORE) (UPDATE|INSERT|DELETE) ON (\w+) FOR EACH ROW\s+([\s\S]*)$/.exec(statement);
  if(match){triggers.push({name:match[1],timing:match[2],event:match[3],table:match[4],body:match[5],sql:statement});continue;}
  match=/^ALTER TABLE users ([\s\S]*)$/.exec(statement);
  if(match){for(const definition of splitDefinitions(match[1])){if(!definition.startsWith('ADD COLUMN '))throw new Error('Неизвестное изменение users');const column=columnDefinition(definition.slice(11));columns.push({...column,table:'users',sql:`ALTER TABLE users ${definition}`});}continue;}
  throw new Error('Неизвестная операция в описании восстановления 013');
 }
 return {tables,triggers,columns};
}
// Preserve literal and identifier case; normalize only SQL syntax used in these triggers.
export function canonicalTriggerBody(sql){
 return (String(sql).match(/'(?:''|[^'])*'|`(?:``|[^`])*`|[A-Za-z_][A-Za-z_0-9]*|[^\s]/g)||[]).map(token=>token.startsWith("'")?token:token.startsWith('`')?token.slice(1,-1).replaceAll('``','`'):/^(update|set|where|and|or|is|null|not|current_timestamp|new|old)$/i.test(token)?token.toUpperCase():token).join('').replace(/CURRENT_TIMESTAMP\((?:0)?\)/g,'CURRENT_TIMESTAMP');
}
function columnProblems(expected,actual){
 if(!actual)return ['столбец отсутствует'];const problems=[];
 if(typeName(actual.column_type)!==typeName(expected.type))problems.push(`тип ${actual.column_type}, ожидается ${expected.type}`);
 if((actual.is_nullable==='YES')!==expected.nullable)problems.push('другая допустимость NULL');
 const actualDefault=actual.column_default==null?null:expected.type==='datetime'?currentTimestamp(actual.column_default):String(actual.column_default);
 if(actualDefault!==expected.default)problems.push('другое значение DEFAULT');
 const extra=currentTimestamp(actual.extra||'').replace(/default_generated/g,'').trim();
 if(extra!==(expected.onUpdate?'on update current_timestamp':''))problems.push('другие свойства столбца');
 if(actual.generation_expression)problems.push('вычисляемый столбец');
 if(/^(char|varchar|text)/.test(expected.type)&&actual.character_set_name!=='utf8mb4')problems.push('нужна кодировка utf8mb4');
 return problems;
}
export async function readSessionSchema(db,spec){
 const names=[...spec.tables.map(t=>t.name),'users','workspaces','api_tokens'],placeholders=names.map(()=>'?').join(',');
 const [tables]=await db.query(`SELECT TABLE_NAME AS table_name,TABLE_TYPE AS table_type,ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${placeholders})`,names);
 const [columns]=await db.query(`SELECT TABLE_NAME AS table_name,COLUMN_NAME AS column_name,COLUMN_TYPE AS column_type,IS_NULLABLE AS is_nullable,COLUMN_DEFAULT AS column_default,EXTRA AS extra,CHARACTER_SET_NAME AS character_set_name,GENERATION_EXPRESSION AS generation_expression FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${placeholders})`,names);
 const [indexes]=await db.query(`SELECT TABLE_NAME AS table_name,INDEX_NAME AS index_name,NON_UNIQUE AS non_unique,SEQ_IN_INDEX AS sequence_number,COLUMN_NAME AS column_name,SUB_PART AS sub_part,IS_VISIBLE AS is_visible,INDEX_TYPE AS index_type FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${placeholders}) ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX`,names);
 const [foreignKeys]=await db.query(`SELECT k.TABLE_NAME AS table_name,k.COLUMN_NAME AS column_name,k.REFERENCED_TABLE_NAME AS referenced_table,k.REFERENCED_COLUMN_NAME AS referenced_column,k.TABLE_SCHEMA AS table_schema,k.REFERENCED_TABLE_SCHEMA AS referenced_schema,r.DELETE_RULE AS delete_rule,r.UPDATE_RULE AS update_rule FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.TABLE_NAME=k.TABLE_NAME AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME WHERE k.TABLE_SCHEMA=DATABASE() AND k.TABLE_NAME IN (${placeholders})`,names);
 const [triggers]=await db.query(`SELECT TRIGGER_NAME AS trigger_name,EVENT_OBJECT_TABLE AS table_name,ACTION_TIMING AS timing,EVENT_MANIPULATION AS event_name,ACTION_STATEMENT AS statement_body FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME IN (${spec.triggers.map(()=>'?')})`,spec.triggers.map(t=>t.name));
 const [checks]=await db.query(`SELECT TABLE_NAME AS table_name,CONSTRAINT_NAME AS constraint_name FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_TYPE='CHECK' AND TABLE_NAME IN (${placeholders})`,names);
 return {tables,columns,indexes,foreignKeys,triggers,checks};
}
export function planSessionRecovery(spec,snapshot){
 const missing=[],conflicts=[],present=[];
 for(const name of ['users','workspaces','api_tokens'])if(!snapshot.tables.some(t=>t.table_name===name&&t.table_type==='BASE TABLE'&&t.engine==='InnoDB'))conflicts.push(`${name}: необходима исходная таблица InnoDB`);
 for(const table of spec.tables){
  const actual=snapshot.tables.find(t=>t.table_name===table.name);
  if(!actual){missing.push({kind:'table',name:table.name,sql:table.sql});continue;}
  if(actual.table_type!=='BASE TABLE'||actual.engine!=='InnoDB'){conflicts.push(`${table.name}: ожидается таблица InnoDB`);continue;}
  for(const check of snapshot.checks.filter(c=>c.table_name===table.name))conflicts.push(`${table.name}: неизвестное ограничение CHECK ${check.constraint_name}`);
  for(const column of table.columns)for(const error of columnProblems(column,snapshot.columns.find(c=>c.table_name===table.name&&c.column_name===column.name)))conflicts.push(`${table.name}.${column.name}: ${error}`);
  for(const column of snapshot.columns.filter(c=>c.table_name===table.name))if(!table.columns.some(c=>c.name===column.column_name))conflicts.push(`${table.name}.${column.column_name}: неизвестный столбец`);
  const grouped=new Map();for(const index of snapshot.indexes.filter(i=>i.table_name===table.name)){if(!grouped.has(index.index_name))grouped.set(index.index_name,[]);grouped.get(index.index_name).push(index);}
  const matches=(expected,parts)=>parts.length===expected.columns.length&&parts.every((p,i)=>p.column_name===expected.columns[i]&&!p.sub_part&&p.is_visible==='YES'&&p.index_type==='BTREE'&&Number(p.non_unique)===(expected.unique?0:1))&&(!expected.primary||parts[0].index_name==='PRIMARY');
  for(const index of table.indexes)if(![...grouped.values()].some(parts=>matches(index,parts)))conflicts.push(`${table.name}: не совпадает индекс (${index.columns.join(',')})`);
  for(const parts of grouped.values())if(Number(parts[0].non_unique)===0&&!table.indexes.some(i=>i.unique&&matches(i,parts)))conflicts.push(`${table.name}: неизвестное уникальное ограничение ${parts[0].index_name}`);
  const foreignKeys=snapshot.foreignKeys.filter(f=>f.table_name===table.name);
  if(foreignKeys.length!==table.foreignKeys.length)conflicts.push(`${table.name}: другое число внешних ключей`);
  for(const key of table.foreignKeys)if(!foreignKeys.some(f=>f.column_name===key.column&&f.referenced_table===key.table&&f.referenced_column===key.referenced&&f.referenced_schema===f.table_schema&&f.delete_rule==='CASCADE'&&['NO ACTION','RESTRICT'].includes(f.update_rule)))conflicts.push(`${table.name}.${key.column}: не совпадает внешний ключ`);
  present.push({kind:'table',name:table.name});
 }
 for(const column of spec.columns){const actual=snapshot.columns.find(c=>c.table_name==='users'&&c.column_name===column.name);if(!actual)missing.push({kind:'column',name:`users.${column.name}`,sql:column.sql});else{for(const error of columnProblems(column,actual))conflicts.push(`users.${column.name}: ${error}`);present.push({kind:'column',name:`users.${column.name}`});}}
 for(const trigger of spec.triggers){const actual=snapshot.triggers.find(t=>t.trigger_name===trigger.name);if(!actual)missing.push({kind:'trigger',name:trigger.name,sql:trigger.sql});else{if(actual.table_name!==trigger.table||actual.timing!==trigger.timing||actual.event_name!==trigger.event||canonicalTriggerBody(actual.statement_body)!==canonicalTriggerBody(trigger.body))conflicts.push(`${trigger.name}: определение триггера отличается`);present.push({kind:'trigger',name:trigger.name});}}
 return {present,missing,conflicts};
}
export async function assertTriggerCreationAvailable(db){
 const [[flags]]=await db.query('SELECT @@GLOBAL.log_bin AS binary_logging,@@GLOBAL.log_bin_trust_function_creators AS trust_creators');
 if(!Number(flags.binary_logging)||Number(flags.trust_creators))return;
 const [grants]=await db.query('SHOW GRANTS');
 const globalGrant=grants.map(row=>String(Object.values(row)[0]||'')).some(grant=>/^GRANT (?:ALL PRIVILEGES|[^\n]*\bSUPER\b[^\n]*) ON \*\.\* TO /i.test(grant));
 // Roles can carry effective global privileges; let the server enforce those rather than misclassifying them.
 const roleGrant=grants.some(row=>!String(Object.values(row)[0]||'').includes(' ON '));
 if(globalGrant||roleGrant)return;
 const error=new Error('MySQL: включён binlog, но log_bin_trust_function_creators=0. Для триггеров 013/014 настройте этот параметр на сервере или используйте разрешённую DBA учётную запись мигратора. В Compose исправленной поставки параметр уже задан. Приложение само глобальные права и параметры не меняет');error.code='KONTUR_TRIGGER_PREREQUISITE';throw error;
}
export async function inspectSessionRecovery(db,sql){const spec=sessionRecoverySpec(sql);return planSessionRecovery(spec,await readSessionSchema(db,spec));}
export async function recoverSessionMigration(db,file,log=()=>{}){
 const spec=sessionRecoverySpec(file.sql),plan=planSessionRecovery(spec,await readSessionSchema(db,spec));
 if(plan.conflicts.length)throw new Error(`013: фактическая схема отличается от ожидаемой; автоматическое восстановление остановлено: ${plan.conflicts.join('; ')}`);
 if(plan.missing.some(item=>item.kind==='trigger'))await assertTriggerCreationAvailable(db);
 for(const item of plan.missing){await db.query(item.sql);log(`013: добавлен отсутствующий объект ${item.name}`);}
 const verified=planSessionRecovery(spec,await readSessionSchema(db,spec));
 if(verified.conflicts.length||verified.missing.length)throw new Error('013: итоговая схема не прошла проверку; журнал остаётся незавершённым');
 log(`013: схема сверена, сохранены существующие объекты: ${plan.present.length}, добавлены: ${plan.missing.length}`);
}
