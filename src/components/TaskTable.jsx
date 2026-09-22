"use client";
import {useEffect,useRef,useState} from 'react';
import ToolDialog from './ToolDialog.jsx';
import {workApi,useWork,useAction,Field,Select,ErrorLine,Empty,shortDate} from './WorkUI.jsx';
import {filterTasks} from '../lib/view-filters.js';
const COLUMNS={title:'Название',priority:'Приоритет',stage_id:'Этап',assignee_id:'Исполнитель',due_date:'Срок',progress:'Прогресс'};
const PRIORITIES={critical:'Критический',high:'Высокий',medium:'Средний',low:'Низкий'};
const DEFAULT={columns:['title','priority','stage_id','assignee_id','due_date'],filter:{},pinned:[]};

export function TaskFilters({data,value,onChange}){
 const set=(key,val)=>onChange({...value,[key]:val});
 const project=data.projects.find(p=>p.id===value.projectId),stages=project?data.workflows.find(w=>w.id===project.workflow_id)?.stages||[]:data.workflows.flatMap(w=>w.stages||[]);
 return <div className="task-table-filters">
  <Field label="Поиск"><input type="search" maxLength={200} value={value.query||''} onChange={e=>set('query',e.target.value)} placeholder="Ключ или название"/></Field>
  <Field label="Проект"><Select items={data.projects} value={value.projectId} placeholder="Все проекты" onChange={projectId=>onChange({...value,projectId,stageId:null})}/></Field>
  <Field label="Исполнитель"><Select items={data.users} value={value.assigneeId} placeholder="Все сотрудники" onChange={v=>set('assigneeId',v)}/></Field>
  <Field label="Приоритет"><select value={value.priority||''} onChange={e=>set('priority',e.target.value)}><option value="">Все приоритеты</option>{Object.entries(PRIORITIES).map(([v,label])=><option key={v} value={v}>{label}</option>)}</select></Field>
  <Field label="Этап"><Select items={stages} value={value.stageId} placeholder="Все этапы" onChange={v=>set('stageId',v)}/></Field>
 </div>;
}

function EditableCell({task,column,data,onOpen,onChange}){
 const [editing,setEditing]=useState(false),[value,setValue]=useState(''),[busy,setBusy]=useState(false),saving=useRef(false);
 const rights=data.permissions.projects[String(task.project_id)]||{},canEdit=rights['task.edit']&&(column!=='assignee_id'||rights['task.assign']);
 const project=data.projects.find(p=>p.id===task.project_id),stages=data.workflows.find(w=>w.id===project?.workflow_id)?.stages||[];
 const displayed=column==='priority'?PRIORITIES[task.priority]:column==='stage_id'?stages.find(s=>s.id===task.stage_id)?.name:column==='assignee_id'?data.users.find(u=>u.id===task.assignee_id)?.display_name||'Не назначен':column==='due_date'?shortDate(task.due_date):column==='progress'?`${task.progress||0}%`:task[column];
 async function save(){
  if(saving.current)return; saving.current=true;setBusy(true);
  const next=column==='progress'||column==='stage_id'?Number(value):column==='assignee_id'?(value?Number(value):null):column==='due_date'?(value||null):value.trim();
  try{if(await onChange(task,{[column]:next}))setEditing(false);}finally{saving.current=false;setBusy(false);}
 }
 if(editing)return <form className="task-cell-editor" onSubmit={e=>{e.preventDefault();save();}} onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();setEditing(false);}}}>
  {column==='priority'?<select aria-label={COLUMNS[column]} autoFocus disabled={busy} value={value} onChange={e=>setValue(e.target.value)}>{Object.entries(PRIORITIES).map(([v,label])=><option key={v} value={v}>{label}</option>)}</select>:
   column==='stage_id'||column==='assignee_id'?<select aria-label={COLUMNS[column]} autoFocus disabled={busy} value={value} onChange={e=>setValue(e.target.value)}>{column==='assignee_id'&&<option value="">Не назначен</option>}{(column==='stage_id'?stages:data.users.filter(u=>u.status==='active'||u.id===task.assignee_id)).map(v=><option key={v.id} value={v.id}>{v.name||v.display_name}</option>)}</select>:
   <input aria-label={COLUMNS[column]} autoFocus disabled={busy} type={column==='due_date'?'date':column==='progress'?'number':'text'} min={column==='progress'?0:undefined} max={column==='progress'?100:undefined} maxLength={column==='title'?300:undefined} required={column==='title'} value={value} onChange={e=>setValue(e.target.value)}/>}
  <button className="task-cell-action" disabled={busy} aria-label="Сохранить" title="Сохранить">✓</button><button className="task-cell-action" type="button" disabled={busy} onClick={()=>setEditing(false)} aria-label="Отменить редактирование">×</button>
 </form>;
 return <div className="task-cell-value">{column==='title'?<button className="task-title-link" onClick={()=>onOpen(task)}>{displayed}</button>:<span>{displayed||'—'}</span>}{canEdit&&<button className="task-cell-action" onClick={()=>{setValue(task[column]??'');setEditing(true);}} title={`Изменить: ${COLUMNS[column]}`} aria-label={`Изменить ${COLUMNS[column]} задачи ${task.key_code}-${task.task_number}`}>✎</button>}</div>;
}

export default function TaskTable({data,notify,onOpen,onChange}){
 const saved=useWork('views'),[config,setConfig]=useState(DEFAULT),[columnsOpen,setColumnsOpen]=useState(false),[pinOpen,setPinOpen]=useState(false),[name,setName]=useState(''),[page,setPage]=useState(0),[sort,setSort]=useState({column:'id',direction:-1}),[busy,act]=useAction(notify);
 useEffect(()=>{if(saved.value)setConfig(saved.value.config);},[saved.value]);
 useEffect(()=>setPage(0),[config.filter,sort]);
 const filtered=filterTasks(data.tasks,config.filter).sort((a,b)=>{const x=a[sort.column]??'',y=b[sort.column]??'';return (typeof x==='number'&&typeof y==='number'?x-y:String(x).localeCompare(String(y),'ru',{numeric:true}))*sort.direction;});
 const pages=Math.max(1,Math.ceil(filtered.length/50)),current=Math.min(page,pages-1);
 async function persist(next){const response=await workApi('views',{method:'PUT',body:JSON.stringify({revision:saved.value.revision,config:next})});saved.setValue(response);notify('Представление сохранено');return true;}
 return <div className="work-view"><div className="work-head"><div><h1>Таблица задач</h1><p>{filtered.length} задач · изменения сохраняются сразу</p></div><div className="work-actions"><button className="secondary" onClick={()=>setColumnsOpen(true)}>Столбцы</button><button className="secondary" disabled={busy||!saved.value} onClick={()=>{setName('');setPinOpen(true);}}>Закрепить вид</button><button className="primary" disabled={busy||!saved.value} onClick={()=>act(()=>persist(config))}>Сохранить вид</button></div></div>
  <ErrorLine error={saved.error}/>{saved.error&&<button className="secondary" onClick={saved.reload}>Загрузить настройки заново</button>}
  <div className="pinned-views" aria-label="Закреплённые представления">{config.pinned.map(pin=><div key={pin.id}><button onClick={()=>setConfig({...config,filter:pin.filter,columns:pin.columns})}>{pin.name}</button><button disabled={busy||!saved.value} aria-label={`Удалить представление «${pin.name}»`} onClick={()=>act(()=>persist({...config,pinned:config.pinned.filter(p=>p.id!==pin.id)}))}>×</button></div>)}<button className="text-button" onClick={()=>setConfig({...config,filter:{}})}>Сбросить фильтры</button></div>
  <TaskFilters data={data} value={config.filter} onChange={filter=>setConfig({...config,filter})}/>
  <div className="task-table-scroll" tabIndex={0} role="region" aria-label="Таблица задач с горизонтальной прокруткой"><table className="editable-task-table"><thead><tr><th scope="col">Ключ</th>{config.columns.map(column=><th scope="col" key={column} aria-sort={sort.column===column?(sort.direction===1?'ascending':'descending'):'none'}><button onClick={()=>setSort({column,direction:sort.column===column?-sort.direction:1})}>{COLUMNS[column]} {sort.column===column?(sort.direction===1?'↑':'↓'):''}</button></th>)}</tr></thead><tbody>{filtered.slice(current*50,(current+1)*50).map(task=><tr key={task.id}><th scope="row"><button className="task-title-link task-key" onClick={()=>onOpen(task)}>{task.key_code}-{task.task_number}</button></th>{config.columns.map(column=><td key={column} className={`task-column-${column}`}><EditableCell task={task} column={column} data={data} onOpen={onOpen} onChange={onChange}/></td>)}</tr>)}</tbody></table>{!filtered.length&&<Empty>Нет задач по выбранным фильтрам.</Empty>}</div>
  <div className="task-table-pagination"><span>Страница {current+1} из {pages}</span><button className="secondary" disabled={!current} onClick={()=>setPage(current-1)}>Назад</button><button className="secondary" disabled={current===pages-1} onClick={()=>setPage(current+1)}>Далее</button></div>
  {columnsOpen&&<ToolDialog title="Столбцы таблицы" onClose={()=>setColumnsOpen(false)}><div className="task-column-options">{Object.entries(COLUMNS).map(([key,label])=><label key={key}><input type="checkbox" checked={config.columns.includes(key)} disabled={config.columns.length===1&&config.columns.includes(key)} onChange={e=>setConfig({...config,columns:e.target.checked?[...config.columns,key]:config.columns.filter(c=>c!==key)})}/>{label}</label>)}</div><p>Ключ задачи отображается всегда. Сохраните вид, чтобы использовать эти столбцы на другом устройстве.</p><button className="primary" onClick={()=>setColumnsOpen(false)}>Готово</button></ToolDialog>}
  {pinOpen&&<ToolDialog title="Закрепить представление" onClose={()=>setPinOpen(false)}><form onSubmit={e=>{e.preventDefault();act(async()=>{await persist({...config,pinned:[...config.pinned,{id:crypto.randomUUID(),name:name.trim(),filter:config.filter,columns:config.columns}]});setPinOpen(false);});}}><Field label="Название"><input autoFocus required maxLength={100} value={name} onChange={e=>setName(e.target.value)} placeholder="Например: мои критические задачи"/></Field><button className="primary" disabled={busy||config.pinned.length>=30}>Закрепить</button>{config.pinned.length>=30&&<p>Можно сохранить до 30 представлений.</p>}</form></ToolDialog>}
 </div>;
}

export function CommandPalette({data,navigation,onNavigate,onTask,onCreate}){
 const [open,setOpen]=useState(false),[query,setQuery]=useState(''),[active,setActive]=useState(0),input=useRef(null);
 useEffect(()=>{const key=e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){if(document.querySelector('[role="dialog"]'))return;e.preventDefault();setOpen(v=>!v);setQuery('');setActive(0);}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[]);
 useEffect(()=>{if(open)input.current?.focus();},[open]);
 const entries=[...navigation.map(([id,label])=>({id:`nav-${id}`,label,kind:'Раздел',action:()=>onNavigate(id)})),...(onCreate?[{id:'create',label:'Создать задачу',kind:'Действие',action:onCreate}]:[]),...data.tasks.map(task=>({id:`task-${task.id}`,label:`${task.key_code}-${task.task_number} · ${task.title}`,kind:'Задача',action:()=>onTask(task)}))].filter(item=>item.label.toLocaleLowerCase('ru').includes(query.toLocaleLowerCase('ru'))).slice(0,30);
 function choose(index){entries[index]?.action();setOpen(false);}
 return <><button className="command-launch secondary" title="Быстрый переход — Ctrl/Cmd+K" onClick={()=>{setOpen(true);setQuery('');setActive(0);}}>Перейти <kbd>⌘ / Ctrl K</kbd></button>{open&&<ToolDialog title="Быстрый переход" subtitle="Разделы, действия и доступные задачи" onClose={()=>setOpen(false)}><input className="command-input" ref={input} role="combobox" aria-expanded="true" aria-controls="command-results" aria-activedescendant={entries[active]?`command-${entries[active].id}`:undefined} aria-label="Найти раздел или задачу" value={query} onChange={e=>{setQuery(e.target.value);setActive(0);}} onKeyDown={e=>{if(['ArrowDown','ArrowUp','Enter'].includes(e.key)){e.preventDefault();if(e.key==='Enter')choose(active);else{const next=Math.max(0,Math.min(entries.length-1,active+(e.key==='ArrowDown'?1:-1)));setActive(next);document.getElementById(`command-${entries[next]?.id}`)?.scrollIntoView({block:'nearest'});}}}}/><div id="command-results" role="listbox" aria-label="Результаты поиска" className="command-results">{entries.map((entry,i)=><div role="option" aria-selected={i===active} className={i===active?'active':''} id={`command-${entry.id}`} key={entry.id} onMouseMove={()=>setActive(i)} onClick={()=>choose(i)}><small>{entry.kind}</small><span>{entry.label}</span></div>)}</div>{!entries.length&&<Empty>Совпадений нет.</Empty>}</ToolDialog>}</>;
}

export function UndoBanner({action,onUndo,onDismiss,busy}){
 const [expired,setExpired]=useState(false);
 useEffect(()=>{setExpired(false);if(!action)return;const timer=setTimeout(()=>setExpired(true),Math.max(0,action.expiresAt-Date.now()));return()=>clearTimeout(timer);},[action]);
 useEffect(()=>{const key=e=>{if(!action||expired||busy||e.shiftKey||!(e.ctrlKey||e.metaKey)||e.key.toLowerCase()!=='z'||e.target.closest?.('input,textarea,select,[contenteditable="true"],[role="dialog"]'))return;e.preventDefault();onUndo();};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[action,expired,busy,onUndo]);
 if(!action||expired)return null;
 return <div className="task-undo" role="status"><span>Изменена задача <strong>{action.label}</strong></span><button className="secondary" disabled={busy} onClick={onUndo}>{busy?'Отменяем…':'Отменить'} <kbd>Ctrl/Cmd Z</kbd></button><button className="task-cell-action" disabled={busy} onClick={onDismiss} aria-label="Скрыть отмену">×</button></div>;
}
