import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {load} from './test-module-loader.mjs';
const user={id:7,workspace_id:1};

test('quality schemas require expected results and unique case results',async()=>{
 const m=await load('work-quality.js');assert.equal(m.qualityCaseSchema.safeParse({project_id:1,title:'Login',steps:[{action:'Open page',expected:''}]}).success,false);
 assert.equal(m.qualityResultsSchema.safeParse({request_id:crypto.randomUUID(),results:[{case_id:1,revision:1,result:'passed'},{case_id:1,revision:1,result:'failed'}]}).success,false);
});
test('result batches replay exactly once and refuse reused request IDs with different contents',async()=>{
 const d={request_id:crypto.randomUUID(),results:[{case_id:1,revision:1,result:'passed',notes:'',defect_task_id:null}]};let saved=null,updates=0;
 const m=await load('work-quality.js',{'db.js':{transaction:async f=>f({query:async(sql,params)=>{if(sql.startsWith('SELECT status'))return [[{status:'open'}]];if(sql.startsWith('SELECT fingerprint'))return [saved?[saved]:[]];if(sql.startsWith('UPDATE quality_run_items')){updates++;return [{affectedRows:1}];}if(sql.startsWith('INSERT INTO quality_result_batches'))saved={fingerprint:params[2],user_id:params[3]};return [{affectedRows:1}];}})}});
 assert.equal((await m.recordQualityResults(user,{id:1,project_id:1},d)).replayed,false);assert.equal((await m.recordQualityResults(user,{id:1,project_id:1},d)).replayed,true);assert.equal(updates,1);
 await assert.rejects(()=>m.recordQualityResults(user,{id:1,project_id:1},{...d,results:[{...d.results[0],result:'failed'}]}),{status:409});
});
test('stale quality run revisions and completed runs reject new results',async()=>{
 for(const status of ['open','completed']){let modified=false;const m=await load('work-quality.js',{'db.js':{transaction:async f=>f({query:async(sql)=>{if(sql.startsWith('SELECT status'))return [[{status}]];if(sql.startsWith('SELECT fingerprint'))return [[]];if(sql.startsWith('UPDATE quality_run_items'))return [{affectedRows:0}];modified=true;return [{}];}})}});await assert.rejects(()=>m.recordQualityResults(user,{id:1},{request_id:crypto.randomUUID(),results:[{case_id:1,revision:1,result:'passed',notes:'',defect_task_id:null}]}),{status:409});assert.equal(modified,false);}
});
test('OKR progress supports decreasing targets, clamps display and uses weights',async()=>{
 const m=await load('work-objectives.js');assert.equal(m.resultProgress(100,20,60),50);assert.equal(m.resultProgress(0,100,120),100);assert.equal(m.resultProgress(0,100,-1),0);assert.equal(m.objectiveProgress([{weight:1,progress:0},{weight:3,progress:100}]),75);assert.equal(m.objectiveProgress([]),0);
 assert.equal(m.keyResultSchema.safeParse({title:'Metric',mode:'manual',start_value:10,target_value:10}).success,false);
});
test('OKR update-only users can record check-ins without receiving management permission',async()=>{
 let checkin=false;const m=await load('work-objectives.js',{'permissions.js':{projectPermissionSet:async()=>new Set(['project.browse','okr.update']),workspacePermissionSet:async()=>new Set()},'db.js':{one:async(sql)=>sql.includes('work_objectives')?{id:1,project_id:2,archived:0}:sql.includes('objective_key_results')?{id:3,objective_id:1,mode:'manual'}:{id:2,workspace_id:1,status:'active'},transaction:async f=>f({query:async sql=>{if(sql.startsWith('SELECT archived'))return [[{archived:0}]];if(sql.startsWith('INSERT INTO objective_checkins'))checkin=true;return [{affectedRows:1}];}})}});
 const request=new Request('https://kontur.test/api/work/objectives/1/results/3/checkins',{method:'POST',body:JSON.stringify({revision:1,value:10,confidence:'on_track',note:'Проверено'})});
 assert.equal((await m.objectivesApi(request,['objectives','1','results','3','checkins'],user)).status,200);assert.equal(checkin,true);
 await assert.rejects(()=>m.objectivesApi(new Request('https://kontur.test/api/work/objectives/1/results/3',{method:'PUT',body:'{}'}),['objectives','1','results','3'],user),{status:403});
});
