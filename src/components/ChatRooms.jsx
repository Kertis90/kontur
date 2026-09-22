"use client";
import {useEffect,useState} from 'react';
import ToolDialog from './ToolDialog.jsx';
import {chatRequest} from '../lib/chat-client.js';
import {Field,ErrorLine,Empty,useAction} from './WorkUI.jsx';
const labels={workspace:'Все сотрудники',project:'Участники проекта',invite:'По приглашению'};

export default function ChatRooms({data,notify,onOpen,onChanged}){
 const [rooms,setRooms]=useState(null),[error,setError]=useState(''),[query,setQuery]=useState(''),[draft,setDraft]=useState(null);
 const [busy,act]=useAction(notify);
 async function load(){try{setRooms(await chatRequest('/api/chat/rooms'));setError('');}catch(e){setError(e.message);}}
 useEffect(()=>{load();const timer=setInterval(load,15000);return()=>clearInterval(timer);},[]);
 const visible=(rooms||[]).filter(r=>`${r.name} ${r.description} ${r.project_name||''}`.toLocaleLowerCase('ru').includes(query.toLocaleLowerCase('ru')));
 return <section className="rooms-page">
  <div className="rooms-heading"><div><h2>Комнаты</h2><p>Присоединяйтесь, когда удобно. Комната и история остаются, даже если все вышли.</p></div>
   {data.permissions.workspace['chat.room.create']&&<button className="primary" onClick={()=>setDraft({name:'',description:'',join_policy:'workspace',project_id:null,invite_ids:[],archived:false})}>+ Создать комнату</button>}
  </div>
  <label className="rooms-search"><span>Найти комнату</span><input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Название, описание или проект"/></label>
  <ErrorLine error={error}/>{!rooms&&!error&&<p role="status">Загружаем комнаты…</p>}
  {rooms&&!visible.length&&<Empty>{query?'По вашему запросу комнат нет.':'Доступных комнат пока нет. Можно создать пустую комнату без выбора участников.'}</Empty>}
  <div className="rooms-grid">{visible.map(room=><article className="surface room-card" key={room.id}>
   <div className="room-card-top"><span className="room-symbol" aria-hidden="true">#</span><span className={`room-badge ${room.joined?'joined':''}`}>{room.archived?'В архиве':room.joined?'Вы участник':labels[room.join_policy]}</span></div>
   <h3>{room.name}</h3><p className="room-description">{room.description||'Место для разговоров и совместной работы.'}</p>
   <div className="room-details"><span>{room.member_count} участников</span><span>{room.project_name||'Рабочее пространство'}</span></div>
   <div className="room-actions">
    {room.joined?<button className="primary" onClick={()=>onOpen(room.id)}>Открыть</button>:<button className="primary" disabled={busy||Boolean(room.archived)} onClick={()=>act(async()=>{await chatRequest(`/api/chat/rooms/${room.id}/join`,{method:'POST'});await load();await onChanged();onOpen(room.id);})}>Войти в комнату</button>}
    {room.joined&&<button className="secondary" disabled={busy} onClick={()=>act(async()=>{await chatRequest(`/api/chat/rooms/${room.id}/leave`,{method:'POST'});await load();await onChanged();notify('Вы вышли. История комнаты сохранена');})}>Выйти</button>}
    {room.can_manage&&<button className="secondary" disabled={busy} aria-label={`Настройки комнаты «${room.name}»`} onClick={()=>act(async()=>{const r=await chatRequest(`/api/chat/rooms/${room.id}`);setDraft({id:r.id,name:r.name,description:r.description,join_policy:r.join_policy,project_id:r.project_id,invite_ids:r.invite_ids,archived:Boolean(r.archived),revision:r.revision});})}>Настроить</button>}
   </div>
  </article>)}</div>
  {draft&&<RoomEditor data={data} initial={draft} busy={busy} onClose={()=>!busy&&setDraft(null)} onSave={value=>act(async()=>{const {id,...payload}=value;await chatRequest(`/api/chat/rooms${id?'/'+id:''}`,{method:id?'PUT':'POST',body:JSON.stringify(payload)});setDraft(null);await load();await onChanged();notify(id?'Настройки комнаты сохранены':'Пустая комната создана. В неё можно войти в любое время');})}/>}
 </section>;
}

function RoomEditor({initial,data,busy,onClose,onSave}){
 const [d,set]=useState(initial),[search,setSearch]=useState('');const update=(key,value)=>set(v=>({...v,[key]:value}));
 const people=(data.users||[]).filter(u=>!u.is_service&&(!u.status||u.status==='active')&&`${u.display_name} ${u.email||''}`.toLocaleLowerCase('ru').includes(search.toLocaleLowerCase('ru')));
 const projects=(data.projects||[]).filter(p=>data.permissions.projects[String(p.id)]?.['chat.use']);
 return <ToolDialog title={d.id?'Настройки комнаты':'Новая комната'} subtitle="Участников добавлять необязательно — комната может быть пустой." onClose={onClose}>
  <form className="room-form" onSubmit={e=>{e.preventDefault();onSave(d);}}>
   <Field label="Название"><input required maxLength={180} value={d.name} onChange={e=>update('name',e.target.value)} placeholder="Например, Идеи продукта"/></Field>
   <Field label="Описание"><textarea rows={3} maxLength={2000} value={d.description} onChange={e=>update('description',e.target.value)} placeholder="О чём общаемся в этой комнате"/></Field>
   <Field label="Кто может войти"><select value={d.join_policy} onChange={e=>set(v=>({...v,join_policy:e.target.value,project_id:e.target.value==='workspace'?null:v.project_id}))}>
    {Object.entries(labels).filter(([key])=>!d.id||(d.project_id?key!=='workspace':key!=='project')).map(([key,label])=><option key={key} value={key}>{label}</option>)}
   </select></Field>
   {d.join_policy!=='workspace'&&<Field label={d.join_policy==='project'?'Проект':'Проект (необязательно)'}><select required={d.join_policy==='project'} disabled={Boolean(d.id)} value={d.project_id||''} onChange={e=>update('project_id',e.target.value?Number(e.target.value):null)}><option value="">Выберите проект</option>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>}
   {d.join_policy==='invite'&&<fieldset className="room-invites"><legend>Доступ по приглашению · {d.invite_ids.length}</legend><p>Отмеченные сотрудники смогут войти сами. Они не становятся участниками автоматически. Исключение из списка отзовёт доступ и членство.</p><input type="search" aria-label="Поиск сотрудников" placeholder="Поиск сотрудника" value={search} onChange={e=>setSearch(e.target.value)}/><div className="room-people">{people.map(u=><label key={u.id}><input type="checkbox" checked={d.invite_ids.includes(Number(u.id))} onChange={e=>update('invite_ids',e.target.checked?[...d.invite_ids,Number(u.id)]:d.invite_ids.filter(id=>id!==Number(u.id)))}/><span>{u.display_name}</span></label>)}</div></fieldset>}
   {d.id&&<label className="room-archive"><input type="checkbox" checked={d.archived} onChange={e=>update('archived',e.target.checked)}/>Архив: только чтение для участников, новые входы закрыты</label>}
   <div className="room-actions"><button className="secondary" type="button" disabled={busy} onClick={onClose}>Отмена</button><button className="primary" disabled={busy}>{busy?'Сохраняем…':d.id?'Сохранить':'Создать пустую комнату'}</button></div>
  </form>
 </ToolDialog>;
}
