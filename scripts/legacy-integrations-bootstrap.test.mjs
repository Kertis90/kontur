import test from 'node:test';
import assert from 'node:assert/strict';
import {load} from './test-module-loader.mjs';

test('administration bootstrap loads after 021 with or without preserved 002 settings',async()=>{
 for(const archive of [false,true]){
  const sqls=[],record={id:7,provider:'custom-provider',name:'Старое подключение',enabled:1,last_sync_at:null,created_at:'2026-01-01 00:00:00'};
  const bootstrap=await load('bootstrap.js',{
   'permissions.js':{PERMISSION_CATALOG:[],permissionMap:s=>Object.fromEntries([...s].map(p=>[p,true])),workspacePermissionSet:async()=>new Set(['integration.manage','user.manage','workflow.manage']),projectPermissionSet:async()=>new Set()},
   'settings.js':{getSettings:async()=>({}),publicSettings:(_category,value)=>value},
   'dashboard-access.js':{dashboardGroups:async()=>[],canReadDashboard:()=>false},
   'work-access.js':{fieldAccess:async()=>[],redactFields:value=>value},
   'db.js':{rows:async(sql,args)=>{
    sqls.push(sql);
    if(/FROM integration_connections\s/.test(sql))throw new Error('ER_BAD_FIELD_ERROR: last_sync_at is absent from the 021 table');
    if(sql.includes('information_schema.TABLES'))return archive?[{TABLE_NAME:'integration_connections_legacy_002'}]:[];
    if(sql.includes('FROM integration_connections_legacy_002')){assert.deepEqual([...args],[1]);assert.equal(/config_json|secrets_encrypted|last_error|SELECT \*/.test(sql),false);return [record];}
    if(sql.startsWith('SELECT id, name, slug FROM workspaces'))return [{id:1,name:'Контур',slug:'kontur'}];
    return [];
   }}
  });
  const result=await bootstrap.getBootstrap({id:1,workspace_id:1,global_role:'admin'});
  assert.equal(result.permissions.admin,true);assert.equal(result.permissions.features['user.manage'],true);
  assert.equal(result.administration.integrations.length,archive?1:0);assert.equal(result.workspace.name,'Контур');
  assert.ok(sqls.some(sql=>sql.includes('FROM workflows')));
 }
});

test('an administrator without integration.manage does not query preserved settings',async()=>{
 let reads=0;
 const helper=await load('legacy-integrations.js',{'db.js':{rows:async()=>{reads++;throw Error('Forbidden read');}}});
 assert.equal((await helper.legacyIntegrationSummaries(1,false)).length,0);assert.equal(reads,0);
});

test('legacy metadata database errors remain visible rather than pretending settings are absent',async()=>{
 const helper=await load('legacy-integrations.js',{'db.js':{rows:async()=>{throw Object.assign(new Error('Unavailable'),{code:'ER_TABLEACCESS_DENIED_ERROR'});}}});
 await assert.rejects(helper.legacyIntegrationSummaries(1,true),e=>e.code==='ER_TABLEACCESS_DENIED_ERROR');
});
