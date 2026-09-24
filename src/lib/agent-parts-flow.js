import {createHash} from 'node:crypto';
import {graphError,nodeEdges} from './agent-graph.js';
import {WorkError} from './work-error.js';
// Разворачивает закреплённые версии в единый сценарий с общими лимитами и обычными точками согласования.
export async function expandFlowParts(flow,readPart){
 let count=0;
 // Разворачивает одну область, переименовывая ссылки на локальные результаты и сохраняя выход родителю.
 async function expand(current,prefix='',depth=0,stack=[]){
  if(depth>3)throw new WorkError(422,'Допускается не более трёх уровней общих частей');
  const ids=new Map(current.nodes.map(n=>[n.id,prefix?'p_'+createHash('sha256').update(`${prefix}/${n.id}`).digest('hex').slice(0,28):n.id])),entries=new Map(),nodes=[];
  // Переписывает только ссылки на результаты текущей области, не меняя параметры и метрики.
  function text(value){return String(value).replace(/steps\.([a-z][a-z0-9_]*)\./g,(match,id)=>ids.has(id)?`steps.${ids.get(id)}.`:match);}
  for(const node of current.nodes){if(++count>128)throw new WorkError(422,'После раскрытия частей допускается не более 128 блоков');const id=ids.get(node.id),edges=nodeEdges(current.nodes,node),next=edges.find(e=>e.key==='next')?.to||'$end';
   if(node.type==='part'){
    const ref=`${node.part_id}:${node.version}`;if(stack.includes(ref))throw new WorkError(422,'Общие части образуют рекурсивный вызов');
    const definition=await readPart(node.part_id,node.version),inner=await expand(definition.flow,`${prefix}/${node.id}`,depth+1,[...stack,ref]);
    const summary=inner.nodes.filter(n=>['analyze','action','template','stop'].includes(n.type)).map(n=>`{{steps.${n.id}.summary}}`).join('\n').slice(0,8000);
    // Завершение внутри общей части возвращает управление вызывающему сценарию.
    const children=inner.nodes.map(n=>({...n,name:`${node.name} · ${n.name}`.slice(0,100),...(n.type==='stop'?{type:'template',next:id}:{}),...(n.next==='$end'?{next:id}:{}),...(n.type==='condition'?{on_true:n.on_true==='$end'?id:n.on_true,on_false:n.on_false==='$end'?id:n.on_false}:{})}));
    nodes.push(...children,{id,name:node.name,type:'template',text:summary||`Часть «${node.name}» завершена`,next});entries.set(node.id,inner.entry==='$end'?id:inner.entry);
   }else{const item={...node,id,next};if(node.type==='condition')item.condition={...node.condition,rules:node.condition.rules.map(r=>({...r,path:text(r.path)}))};for(const key of ['prompt','text','message'])if(node[key])item[key]=text(node[key]);if(node.type==='condition'){item.on_true=edges.find(e=>e.key==='on_true').to;item.on_false=edges.find(e=>e.key==='on_false').to;}nodes.push(item);entries.set(node.id,id);}
  }
  // Переводит переходы локальной области на вход вложенной части либо обычный блок.
  function target(id){return id==='$end'?id:entries.get(id)||id;}
  const own=new Set(ids.values());for(const node of nodes)if(own.has(node.id)){node.next=target(node.next);if(node.type==='condition'){node.on_true=target(node.on_true);node.on_false=target(node.on_false);}}
  return {nodes,entry:target(current.entry||current.nodes[0]?.id||'$end')};
 }
 const expanded=await expand(flow),error=graphError(expanded);if(error)throw new WorkError(422,error);
 return {...flow,...expanded,positions:{...flow.positions,...Object.fromEntries(expanded.nodes.filter(n=>!flow.nodes.some(o=>o.id===n.id)).map((n,i)=>[n.id,{x:40+(i%3)*350,y:600+Math.floor(i/3)*190}]))}};
}
