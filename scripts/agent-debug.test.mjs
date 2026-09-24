import test from 'node:test';
import assert from 'node:assert/strict';
import {load} from './test-module-loader.mjs';
test('повтор не допускает иной источник или отключение маскирования',async()=>{
 const {checkReplaySources}=await load('agent-debug.js');const config={sources:{tasks:true},policy:{redact_emails:true}};checkReplaySources(config,{...config,instructions:'Изменённое задание'});
 assert.throws(()=>checkReplaySources(config,{...config,sources:{tasks:false}}),{status:409});assert.throws(()=>checkReplaySources(config,{...config,policy:{redact_emails:false}}),{status:409});
});
test('закрытые данные не расшифровываются в ответ без проверки доступа',async()=>{
 let checked=0;const {loadDebugContext}=await load('agent-debug.js',{'db.js':{one:async()=>({context_encrypted:'saved'})},'crypto.js':{encryptSecret:v=>v,decryptSecret:()=>JSON.stringify({refs:[{kind:'task',id:7}],sources:[{title:'Закрытый текст'}]})},'agent-sources.js':{agentAccess:async()=>{},checkAgentRefs:async()=>{checked++;throw Object.assign(new Error('Нет доступа'),{status:403});}}});
 await assert.rejects(()=>loadDebugContext({workspace_id:1},{id:3,workspace_id:1,project_id:1}),{status:403});assert.equal(checked,1);
 await assert.rejects(()=>loadDebugContext({workspace_id:2},{id:3,workspace_id:1,project_id:1}),{status:404});assert.equal(checked,1);
});
test('условие сохраняет фактическое значение на входе, фильтр — исходное количество',async()=>{
 const {executeAgentFlow}=await load('agent-flow.js'),steps=[];await executeAgentFlow({flow:{nodes:[{id:'filter',name:'Фильтр',type:'filter',kinds:['task'],limit:10,next:'check'},{id:'check',name:'Есть задачи',type:'condition',condition:{mode:'all',rules:[{path:'metrics.task_count',operator:'greater',value:0}]},on_true:'$end',on_false:'$end'}]}},{sources:[{kind:'task',id:1},{kind:'article',id:2}]},{onStep:async step=>steps.push(step)});
 const filtered=steps.find(s=>s.node.id==='filter'&&s.status==='completed');assert.equal(filtered.input_count,2);assert.equal(filtered.output.count,1);const condition=steps.find(s=>s.node.id==='check'&&s.status==='completed');assert.equal(condition.input.condition.rules[0].actual,1);assert.equal(condition.output.matched,true);
});
