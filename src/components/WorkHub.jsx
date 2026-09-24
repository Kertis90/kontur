"use client";
import SemanticSearch from './SemanticSearch.jsx';
import {ForecastView} from "./DashboardAnalytics.jsx";
import SecurityWorkbench from "./SecurityWorkbench.jsx";
import {useEffect,useState} from 'react';
import {ApprovalsView,CapacityView,PortfolioView} from './PlanningViews.jsx';
import MeetingsView from './MeetingWorkbench.jsx';
import {AssistantSearch,AccessWorkbench,NotificationPreferences} from './WorkUtilities.jsx';
import OfflineWorkspace from './OfflineWorkspace.jsx';
import WorkDataTools from './WorkDataTools.jsx';
import PlansView from './PlansView.jsx';
// Открывает планы по умолчанию и сохраняет доступ к прежним рабочим инструментам.
export default function WorkHub({data,notify,reload,onTask}){
  const [tab,setTab]=useState('plans');
  const tabs=[['plans','Планы и идеи'],['approvals','Согласования'],...(data.permissions.features['capacity.view']?[['capacity','Загрузка команд']]:[]),['portfolio','Портфель'],['meetings','Результаты встреч'],...(data.permissions.features['ai.search']?[['assistant','Поиск с ИИ']]:[]),['access','Доступы'],['data','Работа с данными'],['personal','Личные настройки']];
  useEffect(()=>{const value=new URLSearchParams(window.location.search).get('tab');if(tabs.some(([key])=>key===value))setTab(value);},[]);
  return <div className="view-page work-hub"><div className="work-title"><span className="overline">КОНТУР · КОМАНДНАЯ РАБОТА</span><h1>Планирование и инструменты</h1></div><div className="work-tabs" role="tablist" aria-label="Рабочие инструменты">{tabs.map(([key,label])=><button role="tab" aria-selected={tab===key} className={tab===key?'active':''} key={key} onClick={()=>setTab(key)}>{label}</button>)}</div>{tab==='plans'&&<PlansView data={data} notify={notify} reload={reload} onTask={onTask}/>} {tab==='approvals'&&<ApprovalsView data={data} notify={notify} onTask={onTask}/>} {tab==='capacity'&&data.permissions.features['capacity.view']&&<CapacityView data={data} notify={notify}/>} {tab==='portfolio'&&<><PortfolioView data={data} notify={notify} onTask={onTask}/><ForecastView data={data}/></>} {tab==='meetings'&&<MeetingsView data={data} notify={notify} onTask={onTask}/>} {tab==='assistant'&&data.permissions.features['ai.search']&&<><SemanticSearch data={data} notify={notify}/><details className="work-card"><summary>Ответ с ИИ по ключевым словам</summary><AssistantSearch notify={notify}/></details></>} {tab==='access'&&<AccessWorkbench data={data} notify={notify}/>} {tab==='data'&&<WorkDataTools data={data} notify={notify} reload={reload}/>} {tab==='personal'&&<><SecurityWorkbench data={data} notify={notify}/><NotificationPreferences notify={notify}/><OfflineWorkspace data={data} notify={notify}/></>}</div>;
}
