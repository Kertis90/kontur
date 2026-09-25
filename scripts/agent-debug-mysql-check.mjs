import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {browserEnv} from './browser-env.mjs';
import {load} from './test-module-loader.mjs';
Object.assign(process.env,browserEnv);
const database=await import('../src/lib/db.js'),{db,one,rows}=database;
const settingsModule=await import('../src/lib/ai-settings.js');
const budgetModule=await import('../src/lib/ai-budget.js');
const {saveAgent,agentsApi}=await import('../src/lib/work-agents.js');
const {agentPartsApi}=await import('../src/lib/agent-parts.js');
const {agentDebugRun}=await import('../src/lib/agent-debug.js');
const owner=await one('SELECT * FROM users WHERE email=?',[browserEnv.ADMIN_EMAIL]),project=await one("SELECT * FROM projects WHERE workspace_id=? AND status='active' ORDER BY id LIMIT 1",[owner.workspace_id]),settings=await settingsModule.getAiSettings(owner.workspace_id),profileId=settings.profiles[0].id;
let calls=0;
// Подменяет только внешний ответ модели: права, очередь, MySQL, источники и исполнение остаются настоящими.
const runtime=await load('agent-runtime.js',{'db.js':database,'ai-settings.js':{...settingsModule,getAiSettings:async()=>({...settings,enabled:true,daily_user_limit:10000})},'ai-budget.js':{...budgetModule,generateMeteredAi:async(user,purpose,profile,key,system)=>{calls++;return {text:JSON.stringify(system.includes('аналитический шаг')?{summary:'Проверены задачи',values:{}}:{summary:'Предлагается задача',actions:[{type:'create_task',title:'Проверка без записи',description:'Нельзя применять автоматически'}],citations:[]}),input_tokens:11,output_tokens:7};}}},browserEnv);
// Вызывает маршруты библиотеки и запуска с реальным пользователем одноразовой БД.
async function api(handler,method,path,data){const response=await handler(new Request(`http://kontur.test/api/work/${path}`,{method,...(data?{body:JSON.stringify(data)}:{})}),path.split('/'),owner);return response.json();}
try{
 const part=await api(agentPartsApi,'POST','agents/parts',{project_id:project.id,name:'Общий анализ '+randomUUID().slice(0,6),request_id:randomUUID(),flow:{nodes:[{id:'analyze',name:'Проверка',type:'analyze',prompt:'Проверь текущие задачи проекта.',fields:[],next:'$end'}],max_calls:4}});
 const saved=await saveAgent(owner,{project_id:project.id,name:'Проверка журнала '+randomUUID().slice(0,6),enabled:false,config:{profile_id:profileId,instructions:'Подготовь итоговую сводку по проекту.',trigger:{type:'manual'},sources:{tasks:{enabled:true,fields:['title'],limit:3},quality:{enabled:false}},actions:['create_task'],flow:{max_calls:2,nodes:[{id:'shared',name:'Проверка',type:'part',part_id:part.id,version:1,next:'$end'}]}}});
 const agent=await runtime.getAgent(owner,saved.id),before=Number((await one('SELECT COUNT(*) AS total FROM tasks WHERE project_id=?',[project.id])).total),queued=await runtime.enqueueAgentRun(owner,agent,{key:'debug-'+randomUUID(),dryRun:true});await runtime.processAgentRun(queued.id);
 const run=await one('SELECT * FROM ai_agent_runs WHERE id=?',[queued.id]);assert.equal(run.status,'completed',run.error_text);assert.equal(calls,2);assert.equal(Number((await one('SELECT COUNT(*) AS total FROM tasks WHERE project_id=?',[project.id])).total),before);
 const debug=await agentDebugRun(owner,run);assert.ok(debug.steps.some(s=>s.input?.source_ids.length));assert.equal(debug.steps.reduce((n,s)=>n+Number(s.input_tokens),0),22);
 assert.ok(!(await one('SELECT context_encrypted FROM ai_agent_debug_contexts WHERE run_id=?',[run.id])).context_encrypted.includes('sources'));
 const request={request_id:randomUUID()},replay=await api(agentsApi,'POST',`agents/runs/${run.id}/replay`,request);assert.equal((await api(agentsApi,'POST',`agents/runs/${run.id}/replay`,request)).id,replay.id);await runtime.processAgentRun(replay.id);const second=await one('SELECT * FROM ai_agent_runs WHERE id=?',[replay.id]);assert.equal(second.status,'completed',second.error_text);assert.equal(calls,4);assert.equal(Number((await one('SELECT COUNT(*) AS total FROM tasks WHERE project_id=?',[project.id])).total),before);
 await assert.rejects(()=>runtime.applyAgentRun(owner,replay.id),{status:409});
 const source=debug.context.refs.find(r=>r.kind==='task');await rows('UPDATE tasks SET version_number=version_number+1 WHERE id=?',[source.id]);await assert.rejects(()=>api(agentsApi,'POST',`agents/runs/${run.id}/replay`,{request_id:randomUUID()}),{status:409});
 console.log((browserEnv.DB_ENGINE==='postgres'?'PostgreSQL: ':'MySQL: ')+"Агенты версия общей части, общий лимит, входы и токены, шифрование, повтор без записи, идемпотентность и изменение источника — проверены.");
}finally{await db.end();}
