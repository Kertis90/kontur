"use client";
import { useEffect,useState,useCallback,useRef } from 'react';
export async function workApi(path,options={}){
  const response=await fetch(`/api/work/${path}`,{...options,headers:{'Content-Type':'application/json',...options.headers}});
  const result=await response.json().catch(()=>({}));
  if(!response.ok){const error=new Error(result.error||'Не удалось выполнить действие');error.status=response.status;error.details=result.details;throw error;}return result;
}
export function useWork(path){
  const [value,setValue]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),sequence=useRef(0);
  const reload=useCallback(async()=>{if(!path)return;const current=++sequence.current;setLoading(true);try{const data=await workApi(path);if(current!==sequence.current)return;setValue(data);setError('');return data;}catch(e){if(current===sequence.current)setError(e.message);}finally{if(current===sequence.current)setLoading(false);}},[path]);
  useEffect(()=>{setValue(null);setError('');reload();return()=>{sequence.current++;};},[reload]);return {value,error,loading,reload,setValue};
}
export function useAction(notify){const [busy,setBusy]=useState(false),running=useRef(false);return [busy,async(work)=>{if(running.current)return;running.current=true;setBusy(true);try{return await work();}catch(e){notify(e.message,'error');}finally{running.current=false;setBusy(false);}}];}
export const Field=({label,children})=>children?.type==='div'?<div className="work-field"><span>{label}</span>{children}</div>:<label className="work-field"><span>{label}</span>{children}</label>;
export const Empty=({children='Пока ничего нет. Создайте первую запись.'})=><div className="work-empty">{children}</div>;
export const ErrorLine=({error})=>error?<p className="form-error" role="alert">{error}</p>:null;
export const Select=({items,value,onChange,placeholder='Выберите…',...props})=><select value={value??''} onChange={e=>onChange(e.target.value?Number(e.target.value):null)} {...props}><option value="">{placeholder}</option>{items.map(i=><option key={i.id} value={i.id}>{i.name||i.display_name||i.title}</option>)}</select>;
export const today=()=>new Date().toLocaleDateString('sv-SE');
export const addDays=(date,n)=>new Date(Date.parse(`${date}T12:00:00Z`)+n*86400000).toISOString().slice(0,10);
export const shortDate=d=>d?new Date(`${String(d).slice(0,10)}T12:00:00`).toLocaleDateString('ru-RU',{day:'numeric',month:'short'}):'—';
export function WorkHeader({title,text,children}){return <div className="work-header"><div><h2>{title}</h2>{text&&<p>{text}</p>}</div><div className="work-actions">{children}</div></div>;}
