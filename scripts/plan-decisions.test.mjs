import test from 'node:test';
import assert from 'node:assert/strict';
import {planContentHash,planReviewState,checkPlanDependencies} from '../src/lib/plan-content.js';
import {parsePlanSuggestions,selectedPlanSuggestions} from '../src/lib/plan-suggestions.js';
// Создаёт проверяемое предложение с критериями и явными допущениями.
const proposal=(key,kind='task',parent=null,depends_on=[])=>({key,kind,parent,depends_on,title:'Подготовить отчёт',description:'Согласовать показатели',criteria:['Показатели утверждены'],reason:'Цель квартала',priority:'medium',estimate_hours:null});
test('согласование устаревает при изменении плана, состава, рабочей версии, оценки или связи',()=>{
 const plan={id:1,revision:1},items=[{id:2,revision:1,task_version:3}],strategy={revision:1},hash=planContentHash(plan,items,strategy,[]),review={content_hash:hash},people=[{decision:'approved'}];
 assert.equal(planReviewState(review,hash,people),'approved');
 for(const changed of [planContentHash({...plan,revision:2},items,strategy,[]),planContentHash(plan,[...items,{id:3,revision:1}],strategy,[]),planContentHash(plan,[{...items[0],task_version:4}],strategy,[]),planContentHash(plan,items,{revision:2},[]),planContentHash(plan,items,strategy,[{item_id:2,depends_on_task_id:4}])])assert.equal(planReviewState(review,changed,people),'outdated');
 assert.equal(planReviewState(review,hash,[{decision:'approved',unavailable:true}]),'outdated');
});
test('зависимости допускают ветвление, но не цикл и не чужой элемент',()=>{
 const items=[1,2,3].map(id=>({id,state:'planning'}));checkPlanDependencies(items,[{item_id:2,depends_on_item_id:1},{item_id:3,depends_on_item_id:1}]);
 assert.throws(()=>checkPlanDependencies(items,[{item_id:2,depends_on_item_id:1},{item_id:1,depends_on_item_id:2}]),{status:422});
 assert.throws(()=>checkPlanDependencies(items,[{item_id:2,depends_on_item_id:9}]),{status:422});
});
test('ИИ-предложения требуют существующие эпики и предшественников, без неявного выбора',()=>{
 const value=parsePlanSuggestions(JSON.stringify({summary:'Состав',assumptions:['Оценки предварительные'],items:[proposal('epic','epic'),proposal('task','task','epic')]}));
 assert.throws(()=>selectedPlanSuggestions(value,['task']),{status:422});
 assert.equal(selectedPlanSuggestions(value,['task','epic'])[0].key,'epic');
 assert.throws(()=>parsePlanSuggestions(JSON.stringify({...value,items:[proposal('a','task',null,['b']),proposal('b','task',null,['a'])]})),{status:502});
 assert.throws(()=>parsePlanSuggestions(JSON.stringify({...value,items:[proposal('task','task','missing')]})),{status:502});
});
