// Run ONLY through deploy/tests/mysql-recovery.compose.yaml. It uses a separate,
// disposable MySQL container, no host ports, no production env and no persistent volume.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import fs from 'node:fs/promises';
import mysql from 'mysql2/promise';
import {runMigrations,migrationChecksum} from '../src/lib/migration-runner.js';
import {migrationStatus} from '../src/lib/migration-status.js';
import {SESSION_MIGRATION_VERSION,inspectSessionRecovery} from '../src/lib/session-migration-recovery.js';
import {INTEGRATION_MIGRATION_VERSION,LEGACY_INTEGRATION_TABLE,inspectIntegrationRecovery} from '../src/lib/integration-migration-recovery.js';

if(process.env.KONTUR_DISPOSABLE_MYSQL_TEST!=='1')throw new Error('Используйте изолированный deploy/tests/mysql-recovery.compose.yaml');
const config={host:'mysql-test',user:'root',password:'disposable-test-only',multipleStatements:true};
const root=await mysql.createConnection(config),database=`kontur_recovery_test_${randomBytes(6).toString('hex')}`;
const names=(await fs.readdir(new URL('./migrations/',import.meta.url))).filter(n=>/^\d{3}_.+\.sql$/.test(n)).sort();
const files=await Promise.all(names.map(async name=>({name,sql:await fs.readFile(new URL(`./migrations/${name}`,import.meta.url),'utf8')})));
const session=files.find(f=>f.name===SESSION_MIGRATION_VERSION);let db;
try{
 const [[server]]=await root.query('SELECT VERSION() AS version');assert.match(server.version,/^8\.4\./);
 await root.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
 await root.query("CREATE USER 'recovery_user'@'%' IDENTIFIED BY 'disposable-user-only'");
 await root.query(`GRANT ALL PRIVILEGES ON \`${database}\`.* TO 'recovery_user'@'%'`);
 db=await mysql.createConnection({...config,user:'recovery_user',password:'disposable-user-only',database});
 await runMigrations(db,files.slice(0,12),{database});
 await root.query('SET GLOBAL log_bin_trust_function_creators=0');
 // Reproduce the old multi-statement execution, including the original MySQL error.
 await assert.rejects(db.query(session.sql),e=>e.code==='ER_BINLOG_CREATE_ROUTINE_NEED_SUPER');
 await db.query("INSERT INTO schema_migration_runs(version,checksum,status,error_code) VALUES(?,?,'failed','ER_BINLOG_CREATE_ROUTINE_NEED_SUPER')",[session.name,migrationChecksum(session.sql)]);
 await db.query("INSERT INTO workspaces(id,name,slug) VALUES(1,'Recovery test','recovery-test')");
 await db.query("INSERT INTO users(id,workspace_id,email,display_name,password_hash) VALUES(1,1,'recovery@example.invalid','Recovery','before')");
 await db.query("INSERT INTO api_tokens(workspace_id,user_id,name,token_prefix,token_hash,scopes_json) VALUES(1,1,'Preserve me','test',REPEAT('a',64),'[]')");
 await db.query("INSERT INTO user_sessions(id,user_id,user_agent,expires_at) VALUES('preserved-session',1,'Preserve me',DATE_ADD(NOW(),INTERVAL 1 DAY))");
 const status=await migrationStatus(db,files);assert.equal(status.recovery_013.missing.length,4);assert.deepEqual(status.recovery_013.conflicts,[]);
 await assert.rejects(runMigrations(db,files,{database}),/log_bin_trust_function_creators=0/);
 // This global change is limited to the disposable test server.
 await root.query('SET GLOBAL log_bin_trust_function_creators=1');
 await db.query('ALTER TABLE user_sessions MODIFY user_agent VARCHAR(399) NOT NULL DEFAULT \'\'');
 await assert.rejects(runMigrations(db,files,{database}),/user_agent/);
 await db.query('ALTER TABLE user_sessions MODIFY user_agent VARCHAR(400) NOT NULL DEFAULT \'\'');
 await runMigrations(db,files.slice(0,20),{database});
 const integration=files.find(f=>f.name===INTEGRATION_MIGRATION_VERSION);
 await db.query("INSERT INTO workflows(id,workspace_id,name) VALUES(1,1,'Recovery workflow')");
 await db.query("INSERT INTO projects(id,workspace_id,workflow_id,key_code,name,created_by) VALUES(1,1,1,'REC','Recovery project',1)");
 // The actual 002 migration already created this name, with a different schema.
 // Do not replace it with a mock empty schema before reproducing the failure.
 await db.query("INSERT INTO integration_connections(id,workspace_id,provider,name,config_json,secrets_encrypted,last_error,created_by) VALUES(41,1,'legacy-custom','Preserve old integration',JSON_OBJECT('endpoint','https://example.invalid'), 'preserve-old-ciphertext','preserve-old-error',1)");
 const [[oldBefore]]=await db.query('SELECT * FROM integration_connections WHERE id=41');
 await assert.rejects(db.query(integration.sql),e=>e.code==='ER_TABLE_EXISTS_ERROR');
 await db.query("INSERT INTO schema_migration_runs(version,checksum,status,error_code) VALUES(?,?,'failed','ER_TABLE_EXISTS_ERROR')",[integration.name,migrationChecksum(integration.sql)]);
 const integrationStatus=await migrationStatus(db,files);
 assert.deepEqual(integrationStatus.recovery_021.legacy,{source:'integration_connections',target:LEGACY_INTEGRATION_TABLE,state:'rename_pending'});
 assert.deepEqual(integrationStatus.recovery_021.conflicts,[]);
 await db.query('ALTER TABLE integration_connections MODIFY name VARCHAR(179) NOT NULL');
 await assert.rejects(runMigrations(db,files,{database}),/KONTUR_INTEGRATION_SCHEMA_CONFLICT.*name/);
 const [[notCreated]]=await db.query("SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='integration_deliveries'");assert.equal(notCreated.n,0);
 await db.query('ALTER TABLE integration_connections MODIFY name VARCHAR(180) NOT NULL');
 // Lose acknowledgement AFTER the real RENAME committed, as with a network loss.
 const query=db.query.bind(db);
 db.query=async(sql,args)=>{const result=await query(sql,args);if(sql.startsWith('RENAME TABLE integration_connections TO '))throw Object.assign(new Error('Lost rename acknowledgement'),{code:'PROTOCOL_CONNECTION_LOST'});return result;};
 try{await assert.rejects(runMigrations(db,files,{database}),/PROTOCOL_CONNECTION_LOST/);}finally{db.query=query;}
 const [[preservedAfterRename]]=await db.query(`SELECT * FROM ${LEGACY_INTEGRATION_TABLE} WHERE id=41`);assert.deepEqual(preservedAfterRename,oldBefore);
 // Also cover an interruption after the first CREATE of the new schema.
 await db.query(integration.sql.split(';')[0]);
 await db.query("INSERT INTO integration_connections(id,workspace_id,project_id,provider,name,destination_label,config_json,credentials_encrypted,event_types_json,created_by) VALUES(1,1,1,'webhook','Preserve integration','Test destination','{}','preserve-ciphertext','[]',1)");
 await runMigrations(db,files.slice(0,21),{database});
 await db.query("INSERT INTO integration_deliveries(id,connection_id,event_uuid,event_type,payload_encrypted,connection_version) VALUES('preserved-delivery',1,'preserved-event','task.updated','preserve-payload',1)");
 // Disposable fixture only: simulate both CREATEs committed but the journal
 // completion transaction lost. Production recovery never removes markers.
 await db.beginTransaction();
 await db.query('DELETE FROM schema_migrations WHERE version=?',[integration.name]);
 await db.query("UPDATE schema_migration_runs SET status='running',finished_at=NULL WHERE version=?",[integration.name]);
 await db.commit();
 await runMigrations(db,files,{database,log:console.log});
 const integrationPlan=await inspectIntegrationRecovery(db,integration.sql);assert.deepEqual(integrationPlan.conflicts,[]);assert.deepEqual(integrationPlan.missing,[]);
 const [[oldAfter]]=await db.query(`SELECT * FROM ${LEGACY_INTEGRATION_TABLE} WHERE id=41`);assert.deepEqual(oldAfter,oldBefore);
 const [[connection]]=await db.query('SELECT name,credentials_encrypted,enabled FROM integration_connections WHERE id=1');
 assert.equal(connection.name,'Preserve integration');assert.equal(connection.credentials_encrypted,'preserve-ciphertext');assert.equal(connection.enabled,0);
 const [[delivery]]=await db.query("SELECT payload_encrypted,status,attempts FROM integration_deliveries WHERE id='preserved-delivery'");
 assert.equal(delivery.payload_encrypted,'preserve-payload');assert.equal(delivery.status,'pending');assert.equal(delivery.attempts,0);
 const plan=await inspectSessionRecovery(db,session.sql);assert.deepEqual(plan.conflicts,[]);assert.deepEqual(plan.missing,[]);
 const [[row]]=await db.query("SELECT user_agent,revoked_at FROM user_sessions WHERE id='preserved-session'");assert.equal(row.user_agent,'Preserve me');assert.equal(row.revoked_at,null);
 await db.query("UPDATE users SET password_hash='after' WHERE id=1");
 const [[sessionRow]]=await db.query("SELECT revoked_at FROM user_sessions WHERE id='preserved-session'");assert.ok(sessionRow.revoked_at);
 const [[tokenRow]]=await db.query('SELECT revoked_at FROM api_tokens WHERE user_id=1');assert.ok(tokenRow.revoked_at);
 await runMigrations(db,files,{database});
 const [[count]]=await db.query('SELECT COUNT(*) AS n FROM schema_migrations');assert.equal(count.n,files.length);
 console.log('PASS: original 002/021 name collision, preserved legacy rows and encrypted settings, rename interruption, partial/unrecorded 021 recovery, session revocation and idempotent restart.');
}finally{
 if(db)await db.end();
 await root.query(`DROP DATABASE IF EXISTS \`${database}\``);
 await root.query("DROP USER IF EXISTS 'recovery_user'@'%'");
 await root.end();
}
