import {createHash} from 'node:crypto';

export const INTEGRATION_MIGRATION_VERSION='021_integrations.sql';
export const INTEGRATION_MIGRATION_CHECKSUM='1fa7890a7e3ced002c2f5cf98c8408760a76885e1e61e47eab0c85189333b3e8';
export const LEGACY_INTEGRATION_TABLE='integration_connections_legacy_002';
const timestamp=value=>String(value).toLowerCase().replace(/current_timestamp\((?:0)?\)/g,'current_timestamp');
// ENUM literals are case-sensitive schema metadata: never lowercase their values.
const typeName=value=>String(value).replace(/\b(bigint|tinyint|int)\(\d+\)/g,'$1');
const column=(name,type,options={})=>({name,type,nullable:false,default:null,autoIncrement:false,onUpdate:false,...options});
const id=name=>column(name,'bigint unsigned');
const text=(name,size,options)=>column(name,`varchar(${size})`,options);
const date=(name,options)=>column(name,'datetime',options);
const index=(columns,unique=false,primary=false)=>({columns:columns.split(','),unique,primary});
const foreignKey=(name,table,deleteRule='RESTRICT')=>({column:name,table,deleteRule});

// Exact shape shipped in 002_platform_modules.sql. Old providers/configuration
// have no project or notification event mapping: preserve them, never coerce them.
export function legacyIntegrationSpec(name=LEGACY_INTEGRATION_TABLE){
 return {name,collation:'utf8mb4_0900_ai_ci',columns:[
  column('id','bigint unsigned',{autoIncrement:true}),id('workspace_id'),text('provider',80),text('name',180),
  column('config_json','json'),column('secrets_encrypted','text',{nullable:true}),column('enabled','tinyint',{default:'1'}),
  column('last_sync_at','timestamp',{nullable:true}),column('last_error','text',{nullable:true}),id('created_by'),
  column('created_at','timestamp',{default:'current_timestamp'}),column('updated_at','timestamp',{default:'current_timestamp',onUpdate:true})
 ],indexes:[index('id',true,true)],foreignKeys:[foreignKey('workspace_id','workspaces','CASCADE'),foreignKey('created_by','users')]};
}

// A deliberately narrow manifest, bound to one immutable release file. This is
// not an IF NOT EXISTS wrapper or a general SQL parser for arbitrary migrations.
export function integrationRecoverySpec(sql){
 if(createHash('sha256').update(sql,'utf8').digest('hex')!==INTEGRATION_MIGRATION_CHECKSUM)throw new Error('Автовосстановление 021 доступно только для неизменённого файла поставки');
 const statements=sql.split(';').map(s=>s.trim()).filter(Boolean);
 return {tables:[
  {name:'integration_connections',sql:statements[0],columns:[
   column('id','bigint unsigned',{autoIncrement:true}),id('workspace_id'),id('project_id'),
   column('provider',"enum('telegram','mattermost','slack','webhook')"),text('name',160),text('destination_label',255),
   column('config_json','json'),column('credentials_encrypted','text'),column('event_types_json','json'),
   column('enabled','tinyint',{default:'0'}),column('version_number','int unsigned',{default:'1'}),id('created_by'),
   date('created_at',{default:'current_timestamp'}),date('updated_at',{default:'current_timestamp',onUpdate:true})
  ],indexes:[index('id',true,true),index('workspace_id,project_id')],foreignKeys:[foreignKey('workspace_id','workspaces'),foreignKey('project_id','projects'),foreignKey('created_by','users')]},
  {name:'integration_deliveries',sql:statements[1],columns:[
   column('id','char(36)'),id('connection_id'),column('event_uuid','char(36)'),text('event_type',120),
   column('task_id','bigint unsigned',{nullable:true}),column('requested_by','bigint unsigned',{nullable:true}),column('payload_encrypted','text',{nullable:true}),
   column('connection_version','int unsigned'),column('status',"enum('pending','running','delivered','failed','cancelled')",{default:'pending'}),
   column('attempts','int unsigned',{default:'0'}),date('available_at',{default:'current_timestamp'}),
   column('lease_token','char(36)',{nullable:true}),date('lease_until',{nullable:true}),
   column('http_status','int',{nullable:true}),text('error_code',80,{nullable:true}),date('created_at',{default:'current_timestamp'}),date('completed_at',{nullable:true})
  ],indexes:[index('id',true,true),index('connection_id,event_uuid',true),index('status,available_at'),index('connection_id,created_at')],foreignKeys:[foreignKey('connection_id','integration_connections','CASCADE')]}
 ]};
}

export async function readIntegrationSchema(db,spec){
 const names=[...spec.tables.map(t=>t.name),LEGACY_INTEGRATION_TABLE,'workspaces','projects','users'],placeholders=names.map(()=>'?').join(',');
 const [tables]=await db.query(`SELECT TABLE_NAME AS table_name,TABLE_TYPE AS table_type,ENGINE AS engine,TABLE_COLLATION AS table_collation FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${placeholders})`,names);
 const [columns]=await db.query(`SELECT TABLE_NAME AS table_name,COLUMN_NAME AS column_name,COLUMN_TYPE AS column_type,IS_NULLABLE AS is_nullable,COLUMN_DEFAULT AS column_default,EXTRA AS extra,CHARACTER_SET_NAME AS character_set_name,COLLATION_NAME AS collation_name,GENERATION_EXPRESSION AS generation_expression FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${placeholders})`,names);
 const [indexes]=await db.query(`SELECT TABLE_NAME AS table_name,INDEX_NAME AS index_name,NON_UNIQUE AS non_unique,SEQ_IN_INDEX AS sequence_number,COLUMN_NAME AS column_name,SUB_PART AS sub_part,IS_VISIBLE AS is_visible,INDEX_TYPE AS index_type,COLLATION AS index_order FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${placeholders}) ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX`,names);
 const [foreignKeys]=await db.query(`SELECT k.TABLE_NAME AS table_name,k.CONSTRAINT_NAME AS constraint_name,k.ORDINAL_POSITION AS ordinal_position,k.COLUMN_NAME AS column_name,k.REFERENCED_TABLE_NAME AS referenced_table,k.REFERENCED_COLUMN_NAME AS referenced_column,k.TABLE_SCHEMA AS table_schema,k.REFERENCED_TABLE_SCHEMA AS referenced_schema,r.DELETE_RULE AS delete_rule,r.UPDATE_RULE AS update_rule FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.TABLE_NAME=k.TABLE_NAME AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME WHERE k.TABLE_SCHEMA=DATABASE() AND k.TABLE_NAME IN (${placeholders})`,names);
 const [checks]=await db.query(`SELECT TABLE_NAME AS table_name,CONSTRAINT_NAME AS constraint_name FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=DATABASE() AND CONSTRAINT_TYPE='CHECK' AND TABLE_NAME IN (${placeholders})`,names);
 const [triggers]=await db.query(`SELECT EVENT_OBJECT_TABLE AS table_name,TRIGGER_NAME AS trigger_name FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND EVENT_OBJECT_TABLE IN (${placeholders})`,names);
 const [incomingReferences]=await db.query("SELECT TABLE_SCHEMA AS source_schema,TABLE_NAME AS source_table,CONSTRAINT_NAME AS constraint_name,REFERENCED_TABLE_NAME AS referenced_table FROM information_schema.KEY_COLUMN_USAGE WHERE REFERENCED_TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME=?",['integration_connections']);
 const [dependentViews]=await db.query("SELECT VIEW_SCHEMA AS source_schema,VIEW_NAME AS source_view FROM information_schema.VIEW_TABLE_USAGE WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?",['integration_connections']);
 return {tables,columns,indexes,foreignKeys,checks,triggers,incomingReferences,dependentViews};
}

function columnProblems(expected,actual,collation){
 if(!actual)return ['столбец отсутствует'];
 const problems=[];
 if(typeName(actual.column_type)!==expected.type)problems.push(`тип отличается от ${expected.type}`);
 if((actual.is_nullable==='YES')!==expected.nullable)problems.push('другая допустимость NULL');
 const actualDefault=actual.column_default==null?null:['datetime','timestamp'].includes(expected.type)?timestamp(actual.column_default):String(actual.column_default);
 if(actualDefault!==expected.default)problems.push('другое значение DEFAULT');
 const extra=timestamp(actual.extra||'').replace(/default_generated/g,'').trim();
 const expectedExtra=[expected.autoIncrement?'auto_increment':'',expected.onUpdate?'on update current_timestamp':''].filter(Boolean).join(' ');
 if(extra!==expectedExtra)problems.push('другие свойства столбца');
 if(actual.generation_expression)problems.push('вычисляемый столбец');
 if(/^(char|varchar|text|enum)/.test(expected.type)&&(actual.character_set_name!=='utf8mb4'||actual.collation_name!==collation))problems.push('другая кодировка или сопоставление');
 return problems;
}
const group=(rows,key)=>{const result=new Map();for(const row of rows){if(!result.has(row[key]))result.set(row[key],[]);result.get(row[key]).push(row);}return [...result.values()];};
const matchesIndex=(expected,rows)=>rows.length===expected.columns.length&&rows.every((r,i)=>r.column_name===expected.columns[i]&&Number(r.sequence_number)===i+1&&Number(r.non_unique)===(expected.unique?0:1)&&r.sub_part==null&&r.is_visible==='YES'&&r.index_type==='BTREE'&&r.index_order==='A')&&(!expected.primary||rows[0].index_name==='PRIMARY');
const restrictive=rule=>['RESTRICT','NO ACTION'].includes(rule);

function planTables(spec,snapshot){
 const present=[],missing=[],conflicts=[];
 for(const name of ['workspaces','projects','users']){
  const parent=snapshot.tables.find(t=>t.table_name===name),parentId=snapshot.columns.find(c=>c.table_name===name&&c.column_name==='id');
  const primary=group(snapshot.indexes.filter(i=>i.table_name===name),'index_name').find(rows=>matchesIndex(index('id',true,true),rows));
  if(parent?.table_type!=='BASE TABLE'||parent.engine!=='InnoDB'||typeName(parentId?.column_type)!=='bigint unsigned'||parentId?.is_nullable!=='NO'||!primary)conflicts.push(`${name}: родительская таблица или PRIMARY KEY отличается от ожидаемого`);
 }
 for(const table of spec.tables){
  const actual=snapshot.tables.find(t=>t.table_name===table.name);
  if(!actual){missing.push({kind:'table',name:table.name,sql:table.sql});continue;}
  present.push(table.name);
  if(actual.table_type!=='BASE TABLE'||actual.engine!=='InnoDB')conflicts.push(`${table.name}: требуется таблица InnoDB`);
  if(!actual.table_collation?.startsWith('utf8mb4_'))conflicts.push(`${table.name}: нужна кодировка utf8mb4`);
  if(table.collation&&actual.table_collation!==table.collation)conflicts.push(`${table.name}: сопоставление отличается от ${table.collation}`);
  const columns=snapshot.columns.filter(c=>c.table_name===table.name);
  for(const c of table.columns)for(const problem of columnProblems(c,columns.find(a=>a.column_name===c.name),actual.table_collation))conflicts.push(`${table.name}.${c.name}: ${problem}`);
  for(const c of columns)if(!table.columns.some(e=>e.name===c.column_name))conflicts.push(`${table.name}.${c.column_name}: лишний столбец`);
  const indexes=group(snapshot.indexes.filter(i=>i.table_name===table.name),'index_name');
  for(const expected of table.indexes)if(!indexes.some(rows=>matchesIndex(expected,rows)))conflicts.push(`${table.name}: отсутствует или отличается индекс (${expected.columns.join(',')})`);
  // Extra non-unique indexes include the indexes created implicitly for FKs.
  for(const rows of indexes)if(Number(rows[0].non_unique)===0&&!table.indexes.some(e=>matchesIndex(e,rows)))conflicts.push(`${table.name}: лишний уникальный индекс ${rows[0].index_name}`);
  const keys=group(snapshot.foreignKeys.filter(k=>k.table_name===table.name),'constraint_name');
  if(keys.length!==table.foreignKeys.length)conflicts.push(`${table.name}: отличается число внешних ключей`);
  for(const key of table.foreignKeys)if(!keys.some(rows=>rows.length===1&&rows[0].column_name===key.column&&rows[0].referenced_table===key.table&&rows[0].referenced_column==='id'&&rows[0].table_schema===rows[0].referenced_schema&&Number(rows[0].ordinal_position)===1&&(key.deleteRule==='RESTRICT'?restrictive(rows[0].delete_rule):rows[0].delete_rule===key.deleteRule)&&restrictive(rows[0].update_rule)))conflicts.push(`${table.name}.${key.column}: отсутствует или отличается внешний ключ`);
  for(const check of snapshot.checks.filter(c=>c.table_name===table.name))conflicts.push(`${table.name}: лишнее ограничение CHECK ${check.constraint_name}`);
  for(const trigger of snapshot.triggers.filter(t=>t.table_name===table.name))conflicts.push(`${table.name}: неожиданный триггер ${trigger.trigger_name}`);
 }
 return {present,missing,conflicts};
}

export function planIntegrationRecovery(spec,snapshot){
 const original='integration_connections',archived=snapshot.tables.some(t=>t.table_name===LEGACY_INTEGRATION_TABLE);
 const oldColumns=snapshot.columns.filter(c=>c.table_name===original);
 const looksLegacy=oldColumns.some(c=>c.column_name==='secrets_encrypted')&&!oldColumns.some(c=>c.column_name==='project_id');
 if(looksLegacy){
  const legacy=planTables({tables:[legacyIntegrationSpec(original)]},snapshot),conflicts=[...legacy.conflicts];
  if(archived)conflicts.push(`${LEGACY_INTEGRATION_TABLE}: имя для сохранения уже занято; существующая таблица не будет перезаписана`);
  if(snapshot.tables.some(t=>t.table_name==='integration_deliveries'))conflicts.push('integration_deliveries: таблица уже существует рядом со схемой 002; требуется проверка связей и данных');
  if(snapshot.incomingReferences?.length)conflicts.push('integration_connections: есть входящие внешние ключи; автоматическое переназначение связей запрещено');
  if(snapshot.dependentViews?.length)conflicts.push('integration_connections: есть зависимые представления; требуется проверка перед переименованием');
  if(conflicts.length)return {present:legacy.present,missing:[],conflicts,legacy:{source:original,target:LEGACY_INTEGRATION_TABLE,state:'blocked'}};
  const moved={...snapshot};
  for(const kind of ['tables','columns','indexes','foreignKeys','checks','triggers'])moved[kind]=snapshot[kind].map(row=>row.table_name===original?{...row,table_name:LEGACY_INTEGRATION_TABLE}:row);
  const plan=planTables(spec,moved);
  return {...plan,present:[original,...plan.present],legacy:{source:original,target:LEGACY_INTEGRATION_TABLE,state:'rename_pending'},renames:[{kind:'rename',name:original,target:LEGACY_INTEGRATION_TABLE,sql:`RENAME TABLE ${original} TO ${LEGACY_INTEGRATION_TABLE}`}]};
 }
 const plan=planTables(spec,snapshot);
 if(archived){
  const legacy=planTables({tables:[legacyIntegrationSpec()]},snapshot);
  plan.conflicts.push(...legacy.conflicts);plan.present.unshift(LEGACY_INTEGRATION_TABLE);
  plan.legacy={source:original,target:LEGACY_INTEGRATION_TABLE,state:legacy.conflicts.length?'blocked':'preserved'};
 }
 return plan;
}

export async function inspectIntegrationRecovery(db,sql){
 const spec=integrationRecoverySpec(sql);return planIntegrationRecovery(spec,await readIntegrationSchema(db,spec));
}
export async function recoverIntegrationMigration(db,file,log=()=>{}){
 const spec=integrationRecoverySpec(file.sql),plan=planIntegrationRecovery(spec,await readIntegrationSchema(db,spec));
 if(plan.conflicts.length)throw Object.assign(new Error(`021: схема отличается от ожидаемой: ${plan.conflicts.join('; ')}. Изменения таблиц не начаты; проверьте recovery_021 в --status`),{code:'KONTUR_INTEGRATION_SCHEMA_CONFLICT'});
 for(const item of plan.renames||[]){await db.query(item.sql);log(`021: таблица из миграции 002 сохранена как ${item.target}`);}
 for(const item of plan.missing){await db.query(item.sql);log(`021: создана таблица ${item.name}`);}
 const verified=planIntegrationRecovery(spec,await readIntegrationSchema(db,spec));
 if(verified.conflicts.length||verified.missing.length)throw Object.assign(new Error('021: итоговая схема не прошла проверку; журнал остаётся незавершённым'),{code:'KONTUR_INTEGRATION_SCHEMA_INCOMPLETE'});
 log(`021: схема сверена, сохранены существующие таблицы: ${plan.present.length}, добавлены: ${plan.missing.length}`);
}
