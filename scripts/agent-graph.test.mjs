import test from 'node:test';
import assert from 'node:assert/strict';
import {load} from './test-module-loader.mjs';

// Создаёт текстовый блок для проверки связей без обращения к модели.
const textNode=(id,next='$end')=>({id,name:id,type:'template',text:id,next});
test('graph follows explicit entry and reverse array links, but rejects actual cycles',async()=>{
 const {flowSchema,executeAgentFlow}=await load('agent-flow.js');
 const flow=flowSchema.parse({entry:'last',nodes:[textNode('first'),textNode('last','first')],positions:{$trigger:{x:20,y:20},$sources:{x:20,y:180},$end:{x:500,y:180}}});
 const result=await executeAgentFlow({flow},{sources:[]},{});
 assert.deepEqual(Array.from(result.trace,s=>s.node.id),['last','first']);
 assert.equal(flowSchema.safeParse({entry:'missing',nodes:[textNode('first')]}).success,false);
 assert.equal(flowSchema.safeParse({nodes:[textNode('first','last'),textNode('last','first')]}).success,false);
});
test('only the chosen action branch produces proposals',async()=>{
 const {flowSchema,executeAgentFlow}=await load('agent-flow.js');
 const flow=flowSchema.parse({nodes:[{id:'choice',name:'Выбор',type:'condition',condition:{rules:[{path:'inputs.risk',operator:'greater',value:5}]},on_true:'yes',on_false:'no'},
  {id:'yes',name:'Задача',type:'action',action:'create_task',prompt:'Создай задачу для устранения риска.',next:'$end'},
  {id:'no',name:'Ответ',type:'stop',text:'Рисков нет'}]});
 let calls=0;const action=async()=>{calls++;return {summary:'Создать задачу',actions:[{type:'create_task',title:'Риск'}]};};
 const low=await executeAgentFlow({flow},{sources:[],inputs:{risk:1}},{action});assert.equal(calls,0);assert.equal(low.summary,'Рисков нет');
 const high=await executeAgentFlow({flow},{sources:[],inputs:{risk:9}},{action});assert.equal(calls,1);assert.equal(high.state.steps.yes.actions[0].title,'Риск');
 await assert.rejects(()=>executeAgentFlow({flow},{sources:[],inputs:{risk:9}},{}),{status:422});
});
test('approval resume retains action proposals without repeating the model block',async()=>{
 const {flowSchema,executeAgentFlow}=await load('agent-flow.js'),flow=flowSchema.parse({nodes:[{id:'prepare',name:'Подготовить',type:'action',action:'create_task',prompt:'Подготовь задачу по итогам.'},{id:'review',name:'Проверить',type:'approval',message:'Проверьте результат'},{id:'done',name:'Готово',type:'stop',text:'Завершено'}]});
 let calls=0;const action=async()=>{calls++;return {summary:'Предложение',actions:[{type:'create_task',title:'Подготовленная задача'}]};};
 const paused=await executeAgentFlow({flow},{sources:[]},{action});assert.equal(paused.paused,true);
 const finished=await executeAgentFlow({flow},{sources:[]},{action,resume:paused,approval:async()=>({approved:true})});
 assert.equal(calls,1);assert.equal(finished.state.steps.prepare.actions.length,1);assert.equal(finished.summary,'Завершено');
});
test('action nodes require an allowed action and sufficient model budget',async()=>{
 const {agentConfigSchema}=await load('agent-schema.js');
 const config={profile_id:'589196e2-160c-410e-8342-a4cbd67b7bda',instructions:'Проверь состояние проекта.',trigger:{type:'manual'},sources:{tasks:{enabled:true},quality:{enabled:false}},flow:{max_calls:2,nodes:[{id:'act',name:'Задача',type:'action',action:'create_task',prompt:'Создай задачу по найденным рискам.'}]}};
 assert.equal(agentConfigSchema.safeParse(config).success,false);
 assert.equal(agentConfigSchema.safeParse({...config,actions:['create_task']}).success,true);
 assert.equal(agentConfigSchema.safeParse({...config,actions:['create_task'],flow:{...config.flow,max_calls:1}}).success,false);
});
