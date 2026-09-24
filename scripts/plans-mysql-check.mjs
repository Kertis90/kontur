import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {browserEnv} from './browser-env.mjs';
Object.assign(process.env,browserEnv);
const {db,one,rows}=await import('../src/lib/db.js');
const {plansApi}=await import('../src/lib/work-plans.js');
const owner=await one('SELECT * FROM users WHERE email=?',[browserEnv.ADMIN_EMAIL]);
const viewer=await one('SELECT * FROM users WHERE email=?',['browser-viewer@example.invalid']);
const project=await one("SELECT * FROM projects WHERE workspace_id=? AND status='active' ORDER BY id LIMIT 1",[owner.workspace_id]);
const tag=randomUUID().slice(0,8);
// Вызывает настоящий обработчик на изолированной БД с заданным пользователем.
async function call(method,tail='',data,user=owner){const path=`plans${tail}`,response=await plansApi(new Request(`https://kontur.test/api/work/${path}`,{method,...(data?{body:JSON.stringify(data)}:{})}),path.split('?')[0].split('/'),user);return response.json();}
try {
 const goal=await rows('INSERT INTO work_objectives(project_id,title,description,owner_id,due_date,created_by) VALUES(?,?,?,?,?,?)',[project.id,`Цель плана ${tag}`,'Проверка связи',owner.id,'2026-12-31',owner.id]);
 const payload={title:`Инициатива ${tag}`,project_id:project.id,objective_id:goal.insertId,request_id:randomUUID()},plan=await call('POST','',payload);
 assert.equal((await call('POST','',payload)).id,plan.id);
 await assert.rejects(()=>call('POST','',{...payload,title:'Другие данные'}),{status:409});
 const epic=await call('POST',`/${plan.id}/items`,{kind:'epic',title:`Эпик ${tag}`,request_id:randomUUID(),objective_id:goal.insertId});
 const task=await call('POST',`/${plan.id}/items`,{kind:'task',parent_id:epic.id,title:`Задача ${tag}`,request_id:randomUUID()});
 const board=await call('GET',`/board?project_id=${project.id}`);assert.ok(board.items.some(i=>i.id===epic.id&&i.objective_title===`Цель плана ${tag}`));
 await assert.rejects(()=>call('GET',`/board?project_id=${project.id}`,null,viewer),{status:403});
 await assert.rejects(()=>call('GET',`/${plan.id}`,null,{...owner,workspace_id:owner.workspace_id+999}),{status:404});
 await assert.rejects(()=>call('POST',`/${plan.id}/items/${task.id}/start`,{revision:1}),{status:409});
 const started=await Promise.all([call('POST',`/${plan.id}/items/${epic.id}/start`,{revision:1}),call('POST',`/${plan.id}/items/${epic.id}/start`,{revision:1})]);assert.equal(started[0].task_id,started[1].task_id);
 const child=await call('POST',`/${plan.id}/items/${task.id}/start`,{revision:1});assert.equal((await one('SELECT epic_task_id FROM tasks WHERE id=?',[child.task_id])).epic_task_id,started[0].task_id);
 assert.equal((await call('GET',`/board?project_id=${project.id}`)).items.some(i=>[epic.id,task.id].includes(i.id)),false);
 const detail=await call('GET',`/${plan.id}`);assert.equal(detail.objective_id,goal.insertId);assert.equal(detail.items.filter(i=>i.state==='active').length,2);
 await assert.rejects(()=>call('PUT',`/${plan.id}`,{title:'Изменение',revision:999}),{status:409});
 await call('PUT',`/${plan.id}`,{title:payload.title,revision:1,archived:true});
 await assert.rejects(()=>call('POST',`/${plan.id}/items`,{kind:'task',title:'В архив',request_id:randomUUID()}),{status:409});
 await call('POST',`/${plan.id}/restore`,{revision:2});
 const draft=await call('POST','',{title:`Будущий проект ${tag}`,request_id:randomUUID()});
 await assert.rejects(()=>call('GET',`/${draft.id}`,null,viewer),{status:403});
 await call('PUT',`/${draft.id}/members`,{revision:1,members:[{user_id:viewer.id,can_edit:false}]});
 assert.equal((await call('GET',`/${draft.id}`,null,viewer)).can_edit,false);
 await assert.rejects(()=>call('POST',`/${draft.id}/items`,{kind:'task',title:'Чужое изменение',request_id:randomUUID()},viewer),{status:403});
 const future=await call('POST',`/${draft.id}/items`,{kind:'epic',title:`Будущий эпик ${tag}`,request_id:randomUUID()});
 const start={revision:2,key_code:`PL${tag.toUpperCase()}`,workflow_id:project.workflow_id},created=await call('POST',`/${draft.id}/start-project`,start);
 assert.equal((await call('POST',`/${draft.id}/start-project`,start)).project_id,created.project_id);
 assert.ok((await call('GET',`/board?project_id=${created.project_id}`)).items.some(i=>i.id===future.id));
 await call('POST',`/${draft.id}/items/${future.id}/start`,{revision:1});
 console.log('Планирование MySQL: права, цели, версии, архив, проект-черновик, эпик и задача, одновременный повтор начала — проверены.');
} finally {await db.end();}
