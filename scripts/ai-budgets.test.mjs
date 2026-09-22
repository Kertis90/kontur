import test from 'node:test';
import assert from 'node:assert/strict';
import {load} from './test-module-loader.mjs';
const user={id:2,workspace_id:1},profile={id:'123',model:'local',max_output_tokens:1000};
test('AI reservation handles multibyte input and unknown provider usage conservatively',async()=>{const m=await load('ai-budget.js'),reservation=m.estimateAiReservation(profile,'Правила','Текст 🙂');assert.equal(reservation,Buffer.byteLength('ПравилаТекст 🙂')+2024);assert.equal(m.settledAiCharge({input_tokens:12,output_tokens:8},reservation).charged,20);for(const result of [{},{input_tokens:2,output_tokens:null},{input_tokens:-1,output_tokens:2}]){const charge=m.settledAiCharge(result,reservation);assert.equal(charge.known,false);assert.equal(charge.charged,reservation);}});
test('AI monthly budgets reserve before calls and stop at user, workspace or concurrency limits',async()=>{
 let usage={workspace_tokens:0,user_tokens:0,pending:0},inserts=0;
 const m=await load('ai-budget.js',{'ai-settings.js':{getAiSettings:async()=>({budget:{enabled:true,monthly_user_tokens:3000,monthly_workspace_tokens:5000,max_concurrent:2}})},'db.js':{transaction:async f=>f({query:async sql=>{if(sql.startsWith('SELECT id FROM workspaces'))return [[]];if(sql.startsWith('SELECT COALESCE'))return [[usage]];inserts++;return [{}];}})}});
 const run=()=>m.reserveAiCall(user,'test',profile,'sys','input');await run();assert.equal(inserts,1);for(const patch of [{user_tokens:1000},{workspace_tokens:3000},{pending:2}]){usage={workspace_tokens:0,user_tokens:0,pending:0,...patch};await assert.rejects(run(),e=>e.status===429);}assert.equal(inserts,1);
});
test('provider timeouts keep a charged reservation instead of enabling unlimited retries',async()=>{
 let marked=false;const m=await load('ai-budget.js',{'ai-settings.js':{getAiSettings:async()=>({})},'ai-client.js':{AiError:class extends Error{},generateAiText:async()=>{throw Error('timeout');}},'db.js':{transaction:async f=>f({query:async sql=>sql.startsWith('SELECT COALESCE')?[[{workspace_tokens:0,user_tokens:0,pending:0}]]:[[]]}),rows:async(sql)=>{assert.match(sql,/status='uncertain'/);assert.doesNotMatch(sql,/charged_tokens=0/);marked=true;}}});await assert.rejects(m.generateMeteredAi(user,'test',profile,'','s','p'),/timeout/);assert.equal(marked,true);
});
test('non-admins cannot read workspace-wide AI usage',async()=>{const m=await load('ai-budget.js',{'permissions.js':{hasWorkspacePermission:async()=>false,projectPermissionSet:async()=>new Set(),workspacePermissionSet:async()=>new Set()}});await assert.rejects(m.aiUsageApi(new Request('https://example.test/api/work/ai-usage?scope=workspace'),user),e=>e.status===403);});
