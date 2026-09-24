// Возвращает переходы блока; пустая связь сохраняет порядок старых сценариев.
export function nodeEdges(nodes,node,index=nodes.indexOf(node)) {
 if(node.type==='stop')return [];
 return (node.type==='condition'?['on_true','on_false']:['next']).map(key=>({from:node.id,to:node[key]||nodes[index+1]?.id||'$end',key}));
}
// Проверяет существование целей и отсутствие циклов независимо от положения блоков.
export function graphError(flow) {
 const nodes=flow.nodes||[],byId=new Map(nodes.map(n=>[n.id,n]));
 if(byId.size!==nodes.length)return 'Названия блоков внутри схемы должны быть уникальны';
 if(flow.entry&&flow.entry!=='$end'&&!byId.has(flow.entry))return 'Начало ссылается на удалённый блок';
 const visiting=new Set(),done=new Set();
 // Обходит каждую ветвь и выявляет возврат в ещё не завершённый путь.
 function visit(id) {
  if(id==='$end'||done.has(id))return '';
  if(!byId.has(id))return 'Связь ведёт к удалённому блоку';
  if(visiting.has(id))return 'Эта связь создаёт цикл. Выберите другой блок';
  visiting.add(id);
  for(const edge of nodeEdges(nodes,byId.get(id))) { const error=visit(edge.to);if(error)return error; }
  visiting.delete(id);done.add(id);return '';
 }
 for(const node of nodes){const error=visit(node.id);if(error)return error;}
 return '';
}
// Удаляет блок, перенаправляя входящие связи на завершение и сохраняя остальные позиции.
export function removeGraphNode(flow,id) {
 const positions={...flow.positions};delete positions[id];
 const edge_sides=Object.fromEntries(Object.entries(flow.edge_sides||{}).filter(([key])=>!key.startsWith(`${id}.`)));
 return {...flow,entry:flow.entry===id?'$end':flow.entry,positions,edge_sides,nodes:flow.nodes.filter(n=>n.id!==id).map(n=>({...n,...(n.next===id?{next:'$end'}:{}),...(n.type==='condition'?{on_true:n.on_true===id?'$end':n.on_true,on_false:n.on_false===id?'$end':n.on_false}:{})}))};
}
