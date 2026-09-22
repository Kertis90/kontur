import test from 'node:test';
import assert from 'node:assert/strict';
import {load} from './test-module-loader.mjs';
const target={id:1,title:'Вход',description:'Пароль должен содержать 12 символов.'},candidates=[{id:2,title:'Авторизация',description:'Пароль должен содержать 6 символов.'}];
test('AI findings must reference supplied tasks and exact quotes from both sources',async()=>{
 const {parseTaskSuggestions}=await load('task-ai.js');const valid={task_id:2,reason:'Разная длина пароля',source_quote:'12 символов',target_quote:'6 символов'};
 const result=parseTaskSuggestions(JSON.stringify({findings:[valid,{...valid},{...valid,task_id:900},{...valid,target_quote:'8 символов'},{...valid,source_quote:'придуманное требование'}]}),'contradictions',target,candidates);
 assert.equal(result.findings.length,1);assert.equal(result.discarded,4);assert.equal(result.findings[0].task_id,2);
});
test('criteria remain suggestions with explicit clarification questions',async()=>{const {parseTaskSuggestions}=await load('task-ai.js');const value=parseTaskSuggestions('```json\n{"criteria":["Вход с корректным паролем работает"],"questions":["Какой лимит попыток?"]}\n```','acceptance',target,[]);assert.equal(value.criteria.length,1);assert.equal(value.questions[0],'Какой лимит попыток?');assert.throws(()=>parseTaskSuggestions('{"criteria":[1]}','acceptance',target,[]),e=>e.status===502);});
test('task candidate ranking handles Russian text without mutating the source',async()=>{const {rankTaskCandidates}=await load('task-ai.js'),pool=[{id:3,title:'Цвет кнопки',description:'Синий фон'},{id:2,title:'Пароль',description:'12 символов'}];const result=rankTaskCandidates(target,pool);assert.equal(result[0].id,2);assert.equal(pool[0].id,3);assert.equal(Object.hasOwn(pool[0],'relevance'),false);});
test('revoked source access stops task assistance before reading tasks or calling a model',async()=>{const m=await load('task-ai.js',{'work-ai.js':{reserveWorkAi:async()=>{throw Error('Must not reserve');},currentActor:async()=>{throw Object.assign(new Error('Отозвано'),{status:403});}}});await assert.rejects(m.taskAiApi(new Request('https://example.test/api/work/task-ai',{method:'POST',body:JSON.stringify({task_id:1,version_number:1,mode:'acceptance'})}),{id:2,workspace_id:1}),e=>e.status===403);});
