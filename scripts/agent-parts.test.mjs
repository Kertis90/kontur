import test from 'node:test';
import assert from 'node:assert/strict';
import {expandFlowParts} from '../src/lib/agent-parts-flow.js';
import {load} from './test-module-loader.mjs';
// Создаёт простые блоки без обращения к модели для проверки подстановки частей.
const text=(id,next='$end',value=id)=>({id,name:id,type:'template',text:value,next});
test('общая часть возвращается в родителя и сохраняет ссылки на результаты',async()=>{
 const {executeAgentFlow}=await load('agent-flow.js');
 const flow=await expandFlowParts({entry:'shared',max_calls:8,nodes:[{id:'shared',name:'Общая',type:'part',part_id:1,version:2,next:'after'},text('after','$end','Итог: {{steps.shared.summary}}')]},async(id,version)=>{assert.equal(version,2);return {flow:{nodes:[text('first','stop','Привет'),{id:'stop',name:'Возврат',type:'stop',text:'{{steps.first.summary}} мир'}]}};});
 const result=await executeAgentFlow({flow},{sources:[]},{});assert.ok(result.state.steps.after.summary.includes('Привет мир'));assert.equal(result.stopped,false);assert.equal(result.trace.length,4);
});
test('вложенные условия и согласования работают в общем исполнителе',async()=>{
 const {executeAgentFlow}=await load('agent-flow.js');const flow=await expandFlowParts({nodes:[{id:'part',name:'Часть',type:'part',part_id:1,version:1,next:'$end'}]},async()=>({flow:{nodes:[{id:'check',name:'Проверка',type:'condition',condition:{mode:'all',rules:[]},on_true:'approval',on_false:'$end'},{id:'approval',name:'Согласовать',type:'approval',message:'Да?',reviewer_ids:[],timeout_hours:1,next:'$end'}]}}));
 const paused=await executeAgentFlow({flow},{sources:[]},{});assert.equal(paused.paused,true);
 const resumed=await executeAgentFlow({flow},{sources:[]},{resume:paused,approval:async()=>({approved:true})});assert.equal(resumed.paused,undefined);assert.equal(resumed.trace[0].node.type,'approval');
});
test('рекурсия, четвёртый уровень и разрастание схемы отклоняются',async()=>{
 const part=id=>({id:`part_${id}`,name:'Часть',type:'part',part_id:id,version:1,next:'$end'});
 await assert.rejects(()=>expandFlowParts({nodes:[part(1)]},async()=>({flow:{nodes:[part(1)]}})),{status:422});
 await assert.rejects(()=>expandFlowParts({nodes:[part(1)]},async id=>({flow:{nodes:[part(id+1)]}})),{status:422});
 await assert.rejects(()=>expandFlowParts({nodes:[1,2,3,4].map(part)},async()=>({flow:{nodes:Array.from({length:32},(_,i)=>text(`n${i}`))}})),{status:422});
});
