import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {browserEnv} from './browser-env.mjs';
import {load} from './test-module-loader.mjs';
Object.assign(process.env,browserEnv);
const database=await import('../src/lib/db.js'),{db,one,rows}=database,settingsModule=await import('../src/lib/ai-settings.js'),budgetModule=await import('../src/lib/ai-budget.js'),{plansApi}=await import('../src/lib/work-plans.js');
const owner=await one('SELECT * FROM users WHERE email=?',[browserEnv.ADMIN_EMAIL]),settings=await settingsModule.getAiSettings(owner.workspace_id),profileId=settings.profiles[0].id;
let calls=0,changePlan=null;
// Возвращает контролируемые предложения вместо сетевого вызова, сохраняя настоящие права и проверки версий.
const assistant=await load('plan-assistant.js',{'db.js':database,'ai-settings.js':{...settingsModule,getAiSettings:async()=>({...settings,enabled:true,daily_user_limit:10000})},'ai-budget.js':{...budgetModule,generateMeteredAi:async()=>{calls++;if(changePlan)await rows('UPDATE work_plans SET revision=revision+1 WHERE id=?',[changePlan]);return {text:JSON.stringify({summary:'План подготовки отчёта',assumptions:['Оценка требует проверки'],items:[{key:'task',kind:'task',parent:null,title:'Согласовать показатели',description:'Подготовить перечень',criteria:['Перечень согласован'],reason:'Нужен для отчёта',priority:'medium',estimate_hours:null,depends_on:[]}]})};}}},browserEnv);
// Вызывает обработчик с тестовой рабочей областью без запуска веб-сервера.
async function call(handler,method,path,data){const response=await handler(new Request(`http://kontur.test/api/work/${path}`,{method,...(data?{body:JSON.stringify(data)}:{})}),path.split('/'),owner);return response.json();}
try{
 const plan=await call(plansApi,'POST','plans',{title:'Проверка помощника '+randomUUID().slice(0,6),request_id:randomUUID()}),request={request_id:randomUUID(),profile_id:profileId,description:'Подготовь задачи для квартального отчёта'};
 const proposed=await call(assistant.planAssistantApi,'POST',`plans/${plan.id}/assistant`,request);assert.equal(proposed.status,'ready');assert.equal((await call(assistant.planAssistantApi,'POST',`plans/${plan.id}/assistant`,request)).id,proposed.id);assert.equal(calls,1);assert.equal((await call(plansApi,'GET',`plans/${plan.id}`)).items.length,0);
 const applied=await call(assistant.planAssistantApi,'POST',`plans/${plan.id}/assistant/${proposed.id}/apply`,{selected:['task']});assert.ok(applied.items.task);assert.equal((await call(plansApi,'GET',`plans/${plan.id}`)).items.length,1);
 changePlan=plan.id;await assert.rejects(()=>call(assistant.planAssistantApi,'POST',`plans/${plan.id}/assistant`,{...request,request_id:randomUUID()}),{status:409});assert.equal(calls,2);assert.equal((await call(plansApi,'GET',`plans/${plan.id}`)).items.length,1);
 // Проверяет исходную цель предложения после смены привязки плана и удаления доступного источника.
 changePlan=null;const project=await one("SELECT id FROM projects WHERE workspace_id=? AND status='active' ORDER BY id LIMIT 1",[owner.workspace_id]);
 const goal=await rows('INSERT INTO work_objectives(project_id,title,description,owner_id,due_date,created_by) VALUES(?,?,?,?,?,?)',[project.id,'Исходная цель помощника','Первоначальный результат',owner.id,'2026-12-31',owner.id]);
 const linked=await call(plansApi,'POST','plans',{title:'План с исходной целью',objective_id:goal.insertId,request_id:randomUUID()}),goalRequest={...request,request_id:randomUUID()},goalProposal=await call(assistant.planAssistantApi,'POST',`plans/${linked.id}/assistant`,goalRequest);
 await rows('UPDATE work_objectives SET description=? WHERE id=?',['Цель изменена',goal.insertId]);
 await assert.rejects(()=>call(assistant.planAssistantApi,'POST',`plans/${linked.id}/assistant/${goalProposal.id}/apply`,{selected:['task']}),{status:409});
 await rows('UPDATE work_plans SET objective_id=NULL,revision=revision+1 WHERE id=?',[linked.id]);await rows('DELETE FROM work_objectives WHERE id=?',[goal.insertId]);
 await assert.rejects(()=>call(assistant.planAssistantApi,'GET',`plans/${linked.id}/assistant/${goalProposal.id}`),{status:422});
 await assert.rejects(()=>call(assistant.planAssistantApi,'POST',`plans/${linked.id}/assistant`,goalRequest),{status:422});assert.equal(calls,3);assert.equal((await call(plansApi,'GET',`plans/${linked.id}`)).items.length,0);
 console.log('ИИ планирования MySQL: генерация, защита от повторной оплаты, явный выбор, изменение плана и повторная проверка исходной цели — проверены.');
}finally{await db.end();}
