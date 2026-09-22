// Deliberately excluded from npm test: requires the disposable MySQL Compose fixture.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
if(process.env.KONTUR_DISPOSABLE_MYSQL_TEST!=='1'||process.env.MYSQL_DATABASE!=='kontur_verify_expansion'||process.env.MYSQL_HOST!=='mysql-test')throw new Error('Only the disposable expansion.compose.yaml database is allowed');
const {one,rows,db}=await import('../src/lib/db.js');
const {qualityApi}=await import('../src/lib/work-quality.js');
const {objectivesApi}=await import('../src/lib/work-objectives.js');
const {jiraImportApi,pollJiraImports}=await import('../src/lib/work-jira-import.js');
const {getBootstrap}=await import('../src/lib/bootstrap.js');
const user=await one("SELECT * FROM users WHERE email='integration-test@example.invalid'"),project=await one("SELECT * FROM projects WHERE status='active' ORDER BY id LIMIT 1"),stage=await one('SELECT * FROM workflow_stages WHERE workflow_id=? ORDER BY position LIMIT 1',[project.workflow_id]);
async function call(handler,path,method='GET',data){const r=await handler(new Request(`https://kontur.test/api/work/${path}`,{method,...(data?{body:JSON.stringify(data)}:{})}),path.split('?')[0].split('/'),user);return r.json();}
try{
 const bootstrap=await getBootstrap(user);assert.equal(bootstrap.permissions.admin,true);assert.ok(bootstrap.administration);assert.ok(Array.isArray(bootstrap.administration.integrations));
 const tables=['sla_notification_settings','external_connections','external_bindings','integration_health','quality_cases','quality_runs','work_objectives','objective_key_results','semantic_documents','semantic_buckets','semantic_jobs','jira_import_jobs','jira_task_history','runtime_heartbeats'];
 for(const table of tables)await rows(`SELECT 1 FROM ${table} LIMIT 1`);
 const testCase=await call(qualityApi,'quality/cases','POST',{project_id:project.id,title:'Проверка MySQL',steps:[{action:'Открыть',expected:'Работает'}]});
 const plan=await call(qualityApi,'quality/plans','POST',{project_id:project.id,title:'План MySQL',case_ids:[testCase.id]});
 const run=await call(qualityApi,'quality/runs','POST',{plan_id:plan.id,title:'Прогон MySQL'}),packet={request_id:randomUUID(),results:[{case_id:testCase.id,revision:1,result:'passed'}]};
 await call(qualityApi,`quality/runs/${run.id}/results`,'POST',packet);assert.equal((await call(qualityApi,`quality/runs/${run.id}/results`,'POST',packet)).replayed,true);
 await call(qualityApi,`quality/runs/${run.id}/complete`,'POST',{});assert.equal((await call(qualityApi,`quality/runs/${run.id}`)).status,'completed');
 const goal=await call(objectivesApi,'objectives','POST',{project_id:project.id,title:'Проверка цели',owner_id:user.id,due_date:'2027-01-01'});
 const kr=await call(objectivesApi,`objectives/${goal.id}/results`,'POST',{title:'Срок в днях',mode:'manual',start_value:20,target_value:10});
 await call(objectivesApi,`objectives/${goal.id}/results/${kr.id}/checkins`,'POST',{revision:1,value:15,confidence:'on_track',note:'Проверка в MySQL'});
 assert.equal((await call(objectivesApi,`objectives?project_id=${project.id}`)).find(g=>g.id===goal.id).progress,50);
 const input={project_id:project.id,include_attachments:false,text:JSON.stringify({issues:[{key:'CHECK-1',fields:{summary:'Первая импортированная задача',status:{name:stage.name},comment:{comments:[{id:'c1',body:'Исходный комментарий',author:{displayName:'Автор Jira'}}]},issuelinks:[{type:{name:'Blocks'},outwardIssue:{key:'CHECK-2'}}]}},{key:'CHECK-2',fields:{summary:'Вторая импортированная задача',status:{name:stage.name}}}]})};
 for(let pass=0;pass<2;pass++){
  const preview=await call(jiraImportApi,'jira-imports','POST',input);assert.ok(preview.id);await call(jiraImportApi,`jira-imports/${preview.id}`,'POST',{action:'start',revision:preview.revision,preview_hash:preview.preview_hash});
  for(let i=0;i<8;i++)await pollJiraImports();const result=await call(jiraImportApi,`jira-imports/${preview.id}`);assert.equal(result.status,'completed');assert.ok(result.records.every(r=>r.status===(pass?'skipped':'created')));
 }
 const imported=await rows("SELECT task_id FROM work_import_items WHERE project_id=? AND external_key LIKE 'CHECK-%'",[project.id]);assert.equal(imported.length,2);assert.equal((await one('SELECT COUNT(*) AS total FROM jira_task_history WHERE task_id IN (?,?)',imported.map(i=>i.task_id))).total,1);
 console.log('MySQL expansion checks passed: full migrations including the 002/021 collision, admin bootstrap, QA replay, OKR and resumable Jira import');
}finally{await db.end();}
