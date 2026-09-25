import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {browserEnv} from './browser-env.mjs';
Object.assign(process.env,browserEnv);
const {db,one,rows}=await import('../src/lib/db.js');
const {handleWorkApi}=await import('../src/lib/work-api.js');
const owner=await one('SELECT * FROM users WHERE email=?',[browserEnv.ADMIN_EMAIL]),viewer=await one('SELECT * FROM users WHERE email=?',['browser-viewer@example.invalid']),tag=randomUUID().slice(0,8);
// Проверяет настоящие маршруты и ограничения только на одноразовой БД проекта.
async function call(method,path,data,user=owner){const response=await handleWorkApi(new Request(`http://kontur.test/api/work/${path}`,{method,...(data?{body:JSON.stringify(data)}:{})}),path.split('?')[0].split('/'),user);return response.json();}
try{
 const plan=await call('POST','plans',{title:`Решения ${tag}`,request_id:randomUUID()});
 await call('PUT',`plans/${plan.id}/members`,{revision:1,members:[{user_id:viewer.id,can_edit:false}]});
 const epic=await call('POST',`plans/${plan.id}/items`,{kind:'epic',title:`Эпик ${tag}`,start_date:'2026-10-01',due_date:'2026-10-03',request_id:randomUUID()}),task=await call('POST',`plans/${plan.id}/items`,{kind:'task',parent_id:epic.id,title:`Задача ${tag}`,start_date:'2026-10-02',due_date:'2026-10-03',request_id:randomUUID()});
 await call('PUT',`plans/${plan.id}/strategy`,{revision:0,outcome:'Быстрее выпускать отчёты',impact:8,effort:4,rationale:'Экономия времени команды'});
 await call('POST',`plans/${plan.id}/dependencies`,{revision:1,item_id:task.id,depends_on_item_id:epic.id});
 await assert.rejects(()=>call('POST',`plans/${plan.id}/dependencies`,{revision:2,item_id:epic.id,depends_on_item_id:task.id}),{status:422});
 const strategy=await call('GET',`plans/${plan.id}/strategy`),payload={content_hash:strategy.content_hash,request_id:randomUUID(),reviewer_ids:[viewer.id],reason:'Утвердить этапы'};
 const review=await call('POST',`plans/${plan.id}/reviews`,payload);assert.equal((await call('POST',`plans/${plan.id}/reviews`,payload)).id,review.id);
 await assert.rejects(()=>call('POST',`plans/${plan.id}/reviews/${review.id}/decision`,{decision:'approved',comment:'Согласен'}),{status:403});
 await call('POST',`plans/${plan.id}/reviews/${review.id}/decision`,{decision:'approved',comment:'Согласен'},viewer);
 assert.equal((await call('GET',`plans/${plan.id}/strategy`)).reviews[0].status,'approved');
 await call('POST',`plans/${plan.id}/items`,{kind:'task',title:'Новая задача меняет согласование',request_id:randomUUID()});assert.equal((await call('GET',`plans/${plan.id}/strategy`)).reviews[0].status,'outdated');
 const timeline=await call('POST','roadmap/scenario',{shifts:{[`plan:${plan.id}`]:7}},viewer),scheduled=timeline.schedule.tasks.find(i=>i.id===-task.id);assert.equal(scheduled.start_date,'2026-10-11');
 const original=await one('SELECT start_date FROM work_plan_items WHERE id=?',[task.id]);assert.equal(original.start_date,'2026-10-02');
 const favorites=await call('GET','favorites',null,viewer);await call('PUT','favorites',{revision:favorites.revision,items:[{kind:'plan',id:plan.id}]},viewer);assert.equal((await call('GET','favorites',null,viewer)).items[0].title,`Решения ${tag}`);
 await call('PUT',`plans/${plan.id}/members`,{revision:2,members:[]});assert.equal((await call('GET','favorites',null,viewer)).items.length,0);
 const hidden=await call('GET','roadmap',null,viewer);assert.equal(hidden.items.some(i=>i.plan_id===plan.id),false);assert.equal(hidden.groups.some(g=>g.id===`plan:${plan.id}`),false);
 await assert.rejects(()=>call('GET',`plans/${plan.id}/strategy`,null,viewer),{status:403});
 const project=await one("SELECT * FROM projects WHERE workspace_id=? AND status='active' ORDER BY id LIMIT 1",[owner.workspace_id]);
 await call('POST',`plans/${plan.id}/start-project`,{revision:3,project_id:project.id});
 await assert.rejects(()=>call('POST',`plans/${plan.id}/items/${task.id}/start`,{revision:1}),{status:409});
 const predecessor=await call('POST',`plans/${plan.id}/items/${epic.id}/start`,{revision:1}),started=await call('POST',`plans/${plan.id}/items/${task.id}/start`,{revision:1});assert.ok(await one('SELECT task_id FROM task_dependencies WHERE task_id=? AND depends_on_task_id=?',[started.task_id,predecessor.task_id]));
 const privatePlan=await call('POST','plans',{title:`Применение ИИ ${tag}`,request_id:randomUUID()}),snapshot=await call('GET',`plans/${privatePlan.id}/strategy`),suggestionId=randomUUID();
 const scenario={request_id:randomUUID(),changes:[{kind:'task',id:started.task_id,revision:1,start_date:'2026-11-01',due_date:'2026-11-03'},{kind:'initiative',id:privatePlan.id,revision:999,start_date:'2026-11-01',due_date:'2026-11-03'}]};
 const taskBefore=await one('SELECT start_date FROM tasks WHERE id=?',[started.task_id]);await assert.rejects(()=>call('POST','roadmap/apply',scenario),{status:409});assert.equal((await one('SELECT start_date FROM tasks WHERE id=?',[started.task_id])).start_date,taskBefore.start_date);
 scenario.changes[1].revision=1;await call('POST','roadmap/apply',scenario);assert.equal((await call('POST','roadmap/apply',scenario)).replayed,true);assert.equal((await one('SELECT version_number FROM tasks WHERE id=?',[started.task_id])).version_number,2);
 await assert.rejects(()=>call('POST','roadmap/apply',{...scenario,request_id:randomUUID()},viewer),{status:403});
 // Для предложений используется уже обновлённый состав после подтверждения сроков.
 snapshot.content_hash=(await call('GET',`plans/${privatePlan.id}/strategy`)).content_hash;
 const proposals={summary:'Проверка сохранения',assumptions:[],items:[{key:'epic',kind:'epic',parent:null,title:'Предложенный эпик',description:'Описание',criteria:['Результат проверен'],reason:'Нужен для цели',priority:'medium',estimate_hours:4,depends_on:[]},{key:'task',kind:'task',parent:'epic',title:'Предложенная задача',description:'Детали',criteria:['Тест пройден'],reason:'Часть эпика',priority:'high',estimate_hours:null,depends_on:['epic']}]};
 await rows("INSERT INTO work_plan_suggestions(id,plan_id,user_id,fingerprint,content_hash,status,proposals_json) VALUES(?,?,?,?,?,'ready',?)",[suggestionId,privatePlan.id,owner.id,'a'.repeat(64),snapshot.content_hash,JSON.stringify(proposals)]);
 const saved=await call('POST',`plans/${privatePlan.id}/assistant/${suggestionId}/apply`,{selected:['epic','task']});assert.equal((await call('POST',`plans/${privatePlan.id}/assistant/${suggestionId}/apply`,{selected:['task','epic']})).items.task,saved.items.task);assert.equal((await call('GET',`plans/${privatePlan.id}`)).items.length,2);
 console.log((browserEnv.DB_ENGINE==='postgres'?'PostgreSQL: ':'MySQL: ')+"оценки, согласование состава, цикл связей, карта без записи, отзыв доступа, избранное, перенос связей и повтор сохранения ИИ — проверены.");
}finally{await db.end();}
