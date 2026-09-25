"use client";
import {useEffect,useState} from 'react';
import {useWork,ErrorLine,Empty} from './WorkUI.jsx';
import {AgentRun} from './AgentsView.jsx';

// Форматирует срок согласования в местном времени пользователя.
function deadline(value){return value?new Date(String(value).replace(' ','T')+'Z').toLocaleString('ru-RU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'';}

// Собирает согласования шагов и действий ИИ в отдельную очередь сотрудника.
export default function AgentApprovals({data,notify}){
 const api=useWork('agents/approvals'),[selected,setSelected]=useState(null),[filter,setFilter]=useState('all');
 useEffect(()=>{const timer=setInterval(()=>{if(document.visibilityState==='visible')api.reload();},15000);return()=>clearInterval(timer);},[api.reload]);
 const items=(api.value?.items||[]).filter(item=>filter==='all'||item.kind===filter);
 return <section className="view-page tribe-page"><header className="tribe-page-head"><div><span className="overline">МОИ РЕШЕНИЯ</span><h1>Согласования ИИ</h1><p>Шаги сценариев и предложения агентов, которые ждут вашего решения.</p></div><button className="secondary" disabled={api.loading} onClick={api.reload}>Обновить</button></header>
  <div className="tribe-tabs" aria-label="Вид согласований">{[['all','Все'],['step','Шаги сценариев'],['actions','Предложенные действия']].map(([key,label])=><button type="button" className={key===filter?'active':''} key={key} onClick={()=>setFilter(key)}>{label}</button>)}</div>
  <ErrorLine error={api.error}/>{api.loading&&!api.value?<Empty>Загружаем согласования…</Empty>:!items.length&&!api.error?<Empty>Согласований пока нет. Здесь появятся шаги, где вы назначены согласующим и имеете право подтверждения в проекте.</Empty>:null}
  <div className="tribe-cards">{items.map(item=><article className="tribe-card" key={item.id}><div className="tribe-card-top"><span className="tribe-badge">{item.kind==='step'?'Согласование шага':'Проверка действий'}</span>{item.expires_at&&<small>До {deadline(item.expires_at)}</small>}</div><h2>{item.agent_name}</h2><p className="tribe-muted">{item.project_key} · {item.project_name}</p><p>{item.message}</p><footer><span>Запустил: {item.actor_name}</span><button className="primary" onClick={()=>setSelected(item)}>Рассмотреть</button></footer></article>)}</div>
  {selected&&<AgentRun id={selected.id} rights={data.permissions.projects[selected.project_id]||{}} userId={data.user.id} notify={notify} onClose={()=>{setSelected(null);api.reload();}}/>}
 </section>;
}
