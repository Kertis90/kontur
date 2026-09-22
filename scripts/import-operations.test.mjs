import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {join} from 'node:path';
import {load} from './test-module-loader.mjs';
import {backupKey,encryptBackup,decryptBackup} from './backup-crypto.mjs';
test('Jira import preserves ADF comments and authors and reports incomplete exports',async()=>{
 const m=await load('jira-import-model.js');const extra=m.jiraExtras({fields:{comment:{total:2,comments:[{id:'1',author:{displayName:'Анна'},created:'2026-09-01',body:{content:[{content:[{text:'Проверено'}]}]}}]},attachment:[{id:'20',filename:'spec.pdf',size:12}]},changelog:{total:3,histories:[]}});
 assert.equal(extra.history[0].body,'Проверено');assert.equal(extra.history[0].author,'Анна');assert.equal(extra.warnings.length,2);assert.equal(extra.attachments[0].expected_size,12);
 assert.throws(()=>m.jiraExtras({fields:{attachment:[{id:'1',size:-1}]}}));
 const outward=m.jiraLink(10,20,{type:'Blocks',outward:true});assert.equal(outward.task_id,20);assert.equal(outward.depends_on_task_id,10);assert.equal(m.jiraLink(10,20,{type:'custom'}),null);
});
test('backup round-trip authenticates metadata and SQL before invoking a restore callback',async()=>{
 const dir=await mkdtemp(join(process.cwd(),'.backup-test-')),oldTmp=process.env.TMPDIR;process.env.TMPDIR=dir;
 try{const path=join(dir,'dump.kbk'),key=backupKey('ab'.repeat(32)),sql='-- MySQL dump\nCREATE TABLE sample(id INT);\n'+'INSERT INTO sample VALUES(1);\n'.repeat(100);
 const info=await encryptBackup(Readable.from([sql]),path,key,{database:'kontur_work'});assert.ok(info.size>50);
 await decryptBackup(path,key,async(file,metadata)=>{assert.equal(metadata.database,'kontur_work');assert.equal(await readFile(file,'utf8'),sql);});
 let invoked=false;await assert.rejects(()=>decryptBackup(path,backupKey('cd'.repeat(32)),()=>{invoked=true;}));assert.equal(invoked,false);
 const bytes=await readFile(path);bytes[bytes.length-1]^=1;const corrupted=join(dir,'corrupt.kbk');await writeFile(corrupted,bytes);await assert.rejects(()=>decryptBackup(corrupted,key,()=>{invoked=true;}));assert.equal(invoked,false);
 const headerTampered=await readFile(path),offset=headerTampered.indexOf('kontur_work');assert.ok(offset>0);headerTampered.write('other__work',offset,'utf8');const altered=join(dir,'altered-header.kbk');await writeFile(altered,headerTampered);await assert.rejects(()=>decryptBackup(altered,key,()=>{invoked=true;}));assert.equal(invoked,false);
 const existing=await readFile(path);await assert.rejects(()=>encryptBackup(Readable.from(['bad']),path,key));assert.deepEqual(await readFile(path),existing);
 }finally{if(oldTmp===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=oldTmp;await rm(dir,{recursive:true,force:true});}
});
test('operation metrics contain only fixed infrastructure labels and numeric values',async()=>{
 const m=await load('work-operations.js');const text=m.operationsMetrics({dependencies:{mysql:{ok:true},redis:{ok:false}},workers:[{component:'worker',active:2}],queues:[{name:'outbox',total:3,oldest_seconds:-1}]});assert.match(text,/kontur_dependency_up\{dependency="redis"\} 0/);assert.match(text,/kontur_queue_oldest_seconds\{queue="outbox"\} 0/);assert.doesNotMatch(text,/email|token|password/i);
});
test('imported field history is withheld when the viewer has restricted custom fields',async()=>{
 let historySql='';const m=await load('work-jira-import.js',{'db.js':{one:async()=>({id:1,project_id:2,workspace_id:1,status:'active'}),rows:async sql=>{historySql=sql;return [];}},'permissions.js':{workspacePermissionSet:async()=>new Set(),projectPermissionSet:async()=>new Set(['project.browse'])},'work-access.js':{fieldAccess:async()=>[{field_code:'private',can_read:false}],assertFieldEdits:async()=>{}}});
 const response=await m.jiraImportApi(new Request('https://kontur.test/api/work/jira-imports/task/1'),['jira-imports','task','1'],{id:7,workspace_id:1});assert.equal((await response.json()).changes_restricted,true);assert.match(historySql,/AND kind='comment'/);
});
test('new API scopes are explicit and configuration remains session-only in OpenAPI',async()=>{
 const access=await load('api-access.js');for(const scope of ['quality:write','objectives:write','semantic:read','imports:write','operations:read'])assert.ok(!access.DEFAULT_API_SCOPES.includes(scope));
 const token={api_token_id:1,api_enabled:true,scopes_json:['operations:read'],allowed_scopes_json:['operations:read']};assert.equal(access.apiRequestError(token,new Request('https://kontur.test/api/work/operations/metrics')),null);assert.ok(access.apiRequestError(token,new Request('https://kontur.test/api/work/semantic/settings')));
 const {buildOpenApiDocument}=await import('../src/lib/api-docs.js');const doc=buildOpenApiDocument();assert.deepEqual(doc.paths['/api/work/semantic/settings'].put.security,[{sessionCookie:[]}]);assert.equal(doc.paths['/api/work/jira-imports/{jobId}/files/{fileId}'].put.requestBody.content['application/octet-stream'].schema.format,'binary');
});
