"use client";
import {useId,useRef,useState} from 'react';
import {AGENT_NODE_LABELS} from '../lib/agent-catalog.js';
import {graphError,nodeEdges} from '../lib/agent-graph.js';
const icons={trigger:'ϟ',source:'▤',final:'✦',analyze:'✦',condition:'◇',action:'↗',approval:'✓',filter:'≡',template:'T',stop:'◼'};

// Показывает схему с перемещением каждого блока и связями, управляющими выполнением.
export default function AgentCanvas({flow,onChange,selected,onSelect,onAdd,triggerLabel='Ручной запуск',steps=[]}) {
 const [zoom,setZoom]=useState(.8),[pan,setPan]=useState({x:25,y:20}),[dragged,setDragged]=useState({}),[connection,setConnection]=useState(null),[hint,setHint]=useState(''),[full,setFull]=useState(false),[edge,setEdge]=useState(null);
 const pointer=useRef(null),canvas=useRef(null),marker=useId().replace(/:/g,'');
 const nodes=flow.nodes||[],readOnly=!onChange;
 const blocks=[{id:'$trigger',name:triggerLabel,type:'trigger',description:'Когда начинать работу'},{id:'$sources',name:'Источники и параметры',type:'source',description:'Данные, доступные агенту'},...nodes,{id:'$end',name:'Итоговый ответ',type:'final',description:'Модель, сводка и предложения'}];
 const positions=Object.fromEntries(blocks.map((n,i)=>[n.id,dragged[n.id]||flow.positions?.[n.id]||{x:40+(i%2)*350,y:30+Math.floor(i/2)*190}]));
 const edges=[{from:'$trigger',to:'$sources',key:'fixed'},{from:'$sources',to:flow.entry||nodes[0]?.id||'$end',key:'entry'},...nodes.flatMap(n=>nodeEdges(nodes,n))];
 const width=Math.max(800,...Object.values(positions).map(p=>p.x+330)),height=Math.max(510,...Object.values(positions).map(p=>p.y+180));
 // Меняет переход и отклоняет связь, создающую цикл.
 function connect(id) {
  if(!connection||readOnly)return;
  if(id.startsWith('$')&&id!=='$end'){setHint('Выберите шаг сценария или итоговый ответ');return;}
  const next=connection.id==='$sources'?{...flow,entry:id}:{...flow,nodes:nodes.map(n=>n.id===connection.id?{...n,[connection.key]:id}:n)};
  const error=graphError(next);if(error){setHint(error);setConnection(null);return;}
  onChange(next);setConnection(null);setHint('Связь сохранена');
 }
 // Захватывает указатель для перемещения одного блока мышью или касанием.
 function start(event,id) {
  if(readOnly||event.button!==0||connection)return;
  event.preventDefault();event.stopPropagation();event.currentTarget.setPointerCapture(event.pointerId);
  pointer.current={id,x:event.clientX,y:event.clientY,origin:positions[id],last:positions[id]};onSelect?.(id);
 }
 // Обновляет положение блока или смещение холста.
 function move(event) {
  const current=pointer.current;if(!current)return;
  if(current.id==='$pan'){setPan({x:current.origin.x+event.clientX-current.x,y:current.origin.y+event.clientY-current.y});return;}
  current.last={x:Math.max(0,Math.min(6000,Math.round(current.origin.x+(event.clientX-current.x)/zoom))),y:Math.max(0,Math.min(6000,Math.round(current.origin.y+(event.clientY-current.y)/zoom)))};
  setDragged({[current.id]:current.last});
 }
 // Сохраняет последнюю позицию при отпускании указателя.
 function finish() {
  const current=pointer.current;
  if(current&&current.id!=='$pan'&&(current.last.x!==current.origin.x||current.last.y!==current.origin.y))onChange({...flow,positions:{...flow.positions,[current.id]:current.last}});
  pointer.current=null;setDragged({});
 }
 // Вписывает фактические границы схемы в видимую часть холста.
 function fit() {
  const points=Object.values(positions),left=Math.min(...points.map(p=>p.x)),top=Math.min(...points.map(p=>p.y)),right=Math.max(...points.map(p=>p.x+290)),bottom=Math.max(...points.map(p=>p.y+128));
  const next=Math.max(.2,Math.min(1,((canvas.current?.clientWidth||700)-40)/(right-left),((canvas.current?.clientHeight||510)-40)/(bottom-top)));
  setZoom(next);setPan({x:20-left*next,y:20-top*next});
 }
 // Перемещает выбранный блок с клавиатуры на один шаг сетки.
 function moveKey(event,id) {
  if(readOnly||!event.altKey||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
  event.preventDefault();const p=positions[id];onChange({...flow,positions:{...flow.positions,[id]:{x:Math.max(0,Math.min(6000,p.x+(event.key==='ArrowLeft'?-20:event.key==='ArrowRight'?20:0))),y:Math.max(0,Math.min(6000,p.y+(event.key==='ArrowUp'?-20:event.key==='ArrowDown'?20:0)))}}});
 }
 // Добавляет перетащенный из библиотеки блок в точку отпускания.
 function drop(event) {
  event.preventDefault();const kind=event.dataTransfer.getData('application/kontur-agent');if(!onAdd||!AGENT_NODE_LABELS[kind])return;
  const bounds=canvas.current.getBoundingClientRect();onAdd(kind,{x:Math.max(0,Math.min(6000,(event.clientX-bounds.left-pan.x)/zoom)),y:Math.max(0,Math.min(6000,(event.clientY-bounds.top-pan.y)/zoom))});
 }
 return <section className={`agent-canvas-shell ${full?'canvas-expanded':''}`} aria-label="Схема агента">
  <div className="canvas-toolbar"><strong>{readOnly?'Путь выполнения':'Карта сценария'} <small>{nodes.length} блоков</small></strong><div>
   <button type="button" className="secondary" onClick={()=>setZoom(Math.max(.2,zoom-.1))} aria-label="Уменьшить масштаб">−</button><output aria-label="Масштаб">{Math.round(zoom*100)}%</output><button type="button" className="secondary" onClick={()=>setZoom(Math.min(1.5,zoom+.1))} aria-label="Увеличить масштаб">+</button><button type="button" className="secondary" onClick={fit}>Вписать</button>
   {!readOnly&&<button type="button" className="secondary" onClick={()=>onChange({...flow,positions:Object.fromEntries(blocks.map((n,i)=>[n.id,{x:40+i%3*350,y:30+Math.floor(i/3)*190}]))})}>Разложить</button>}
   <button type="button" className="secondary" aria-label={full?'Свернуть схему':'Развернуть схему'} onClick={()=>setFull(!full)}>{full?'↙':'⛶'}</button>
  </div></div>
  <div className="agent-canvas" ref={canvas} onDragOver={event=>onAdd&&event.preventDefault()} onDrop={drop} onPointerDown={event=>{if(event.target!==event.currentTarget||event.button!==0)return;event.currentTarget.setPointerCapture(event.pointerId);pointer.current={id:'$pan',x:event.clientX,y:event.clientY,origin:pan};setEdge(null);}} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} onKeyDown={event=>{if(event.key==='Escape'){setConnection(null);setEdge(null);setFull(false);}}}>
   <div className="canvas-world" style={{width,height,transform:`translate(${pan.x}px,${pan.y}px) scale(${zoom})`}}>
    <svg className="canvas-edges" width={width} height={height} aria-label="Связи блоков"><defs><marker id={marker} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8" fill="currentColor"/></marker></defs>{edges.map(item=>{
     const a=positions[item.from],b=positions[item.to];if(!a||!b)return null;
     const step=steps.find(s=>s.node_id===item.from),taken=step?.status==='completed'&&(step.node_type!=='condition'||(item.key==='on_true')===step.output?.matched),x=a.x+(item.key==='on_false'?215:item.key==='on_true'?75:145),y=a.y+128,x2=b.x+145,y2=b.y;
     return <g key={`${item.from}-${item.key}`} className={`${taken?'taken':''} ${edge?.from===item.from&&edge?.key===item.key?'selected-edge':''}`}><path d={`M${x} ${y} C${x} ${y+70},${x2} ${y2-65},${x2} ${y2}`} markerEnd={`url(#${marker})`} onClick={()=>!readOnly&&item.key!=='fixed'&&setEdge(item)}/>{['on_true','on_false'].includes(item.key)&&<text x={x+10} y={y+25}>{item.key==='on_true'?'Да':'Нет'}</text>}</g>;
    })}</svg>
    {blocks.map((node,index)=>{const state=steps.find(s=>s.node_id===node.id)?.status,ports=node.id==='$sources'?['entry']:node.id.startsWith('$')||node.type==='stop'?[]:node.type==='condition'?['on_true','on_false']:['next'];return <article data-node-id={node.id} key={node.id} className={`canvas-node node-${node.type} ${selected===node.id?'selected':''} ${state||''} ${connection?'connectable':''}`} style={{left:positions[node.id].x,top:positions[node.id].y}} onPointerUp={()=>connection&&connection.id!==node.id&&connect(node.id)}>
     <button type="button" className="canvas-node-handle" title="Перетащите блок. Alt + стрелки — перемещение с клавиатуры" aria-label={`${index+1}. ${node.name}`} onPointerDown={event=>start(event,node.id)} onClick={()=>connection?connect(node.id):onSelect?.(node.id)} onKeyDown={event=>moveKey(event,node.id)}><span><b className="node-icon">{icons[node.type]}</b>{AGENT_NODE_LABELS[node.type]||{trigger:'Триггер',source:'Данные',final:'Завершение'}[node.type]}</span><strong>{node.name}</strong><small>{state==='completed'?'✓ Выполнен':state==='failed'?'Ошибка':node.description||'Нажмите, чтобы настроить'}</small></button>
     {!readOnly&&ports.length>0&&<div className="canvas-ports">{ports.map(key=><button type="button" key={key} className={connection?.id===node.id&&connection.key===key?'active':''} aria-label={`${node.name}: ${key==='on_true'?'Да':key==='on_false'?'Нет':'Далее'}`} onPointerDown={event=>{event.stopPropagation();setConnection({id:node.id,key});setHint('Выберите блок назначения');}} onClick={event=>{event.stopPropagation();setConnection({id:node.id,key});setHint('Выберите блок назначения');}}>{key==='on_true'?'Да ○':key==='on_false'?'Нет ○':'Далее ○'}</button>)}</div>}
    </article>;})}
   </div>
   {edge&&!readOnly&&<div className="canvas-edge-editor"><span>Связь: {blocks.find(n=>n.id===edge.from)?.name}</span><button type="button" onClick={()=>{setConnection({id:edge.from,key:edge.key});setEdge(null);setHint('Выберите новое назначение');}}>Изменить</button><button type="button" onClick={()=>{onChange(edge.from==='$sources'?{...flow,entry:'$end'}:{...flow,nodes:nodes.map(n=>n.id===edge.from?{...n,[edge.key]:'$end'}:n)});setEdge(null);}}>К завершению</button></div>}
  </div>
  <p className="canvas-hint" role="status">{hint||(readOnly?'Зелёным отмечен пройденный путь.':'Перетащите блок из библиотеки. Соедините выход с нужным блоком. Alt + стрелки — перемещение, Esc — отмена.')}</p>
 </section>;
}
