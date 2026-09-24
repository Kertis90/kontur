import {createHash} from 'node:crypto';
import {WorkError} from './work-error.js';
// Закрепляет решение за полями плана, оценкой, составом и зависимостями, включая версии начатых задач.
export function planContentHash(plan,items,strategy,dependencies){
 const data=[plan.id,plan.revision,strategy?.revision||0,items.map(i=>[i.id,i.revision,i.task_version||null]).sort((a,b)=>a[0]-b[0]),dependencies.map(d=>[d.item_id,d.depends_on_item_id||null,d.depends_on_task_id||null]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))];
 return createHash('sha256').update(JSON.stringify(data)).digest('hex');
}
// Не допускает самоссылки и циклы между запланированными элементами.
export function checkPlanDependencies(items,dependencies){
 const ids=new Set(items.filter(i=>i.state!=='cancelled').map(i=>Number(i.id))),parents=new Map([...ids].map(id=>[id,[]]));
 for(const item of items)if(ids.has(Number(item.id))&&item.parent_id&&ids.has(Number(item.parent_id)))parents.get(Number(item.id)).push(Number(item.parent_id));
 for(const d of dependencies){if(!ids.has(Number(d.item_id))||d.depends_on_item_id&&!ids.has(Number(d.depends_on_item_id)))throw new WorkError(422,'Связь должна соединять действующие элементы плана');if(d.depends_on_item_id)parents.get(Number(d.item_id)).push(Number(d.depends_on_item_id));}
 const done=new Set(),active=new Set();
 // Обходит предшественников и завершает проверку каждого узла один раз.
 function visit(id){if(active.has(id))throw new WorkError(422,'Связь создаёт цикл зависимостей');if(done.has(id))return;active.add(id);for(const p of parents.get(id))visit(p);active.delete(id);done.add(id);}
 for(const id of ids)visit(id);
}
// Показывает устаревшее решение вместо прежнего согласования изменённого состава.
export function planReviewState(review,hash,people){if(review.content_hash!==hash||people.some(p=>p.unavailable))return 'outdated';if(people.some(p=>p.decision==='rejected'))return 'rejected';return people.length&&people.every(p=>p.decision==='approved')?'approved':'pending';}
