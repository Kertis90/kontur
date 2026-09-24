"use client";
import {useState} from 'react';
import AgentCanvas from './AgentCanvas.jsx';
import {useWork,useAction,workApi,Field,ErrorLine} from './WorkUI.jsx';
// Показывает фактические входы, выбранную ветвь, выход, ошибку и расход одного блока.
export function AgentStepDetails({id,run,debug}){
 const nodeId=id==='$end'?'_final':id,step=run?.steps?.find(s=>s.node_id===nodeId),input=debug?.steps?.find(s=>s.node_id===nodeId)?.input;
 if(!step)return <p className="work-muted">{id?'Этот блок не выполнялся в выбранном запуске.':'Выберите блок на схеме, чтобы увидеть его вход и результат.'}</p>;
 return <section className="agent-step-details"><h4>{step.name}</h4><p>{step.duration_ms??0} мс · источников на входе: {step.input_count||0} · токены: {step.input_tokens??'не сообщены'} / {step.output_tokens??'не сообщены'}</p>{step.node_type==='condition'&&step.output&&<p className="agent-branch-reason">Выбрана ветвь «{step.output.matched?'Да':'Нет'}»{input?.condition&&` · правило: ${input.condition.mode==='all'?'все условия':'любое условие'}`}</p>}<ErrorLine error={step.error_text}/>{input?.truncated&&<p className="work-muted">Большой вход сокращён. Источники сохранены в данных запуска.</p>}<div className="agent-debug-columns"><div><h5>Вход блока</h5>{input?<pre className="studio-json">{JSON.stringify(input,null,2)}</pre>:<p className="work-muted">Подробный вход доступен для новых запусков пользователям с правом настройки агента.</p>}</div><div><h5>Результат блока</h5><pre className="studio-json">{step.output?JSON.stringify(step.output,null,2):'Результат не получен'}</pre></div></div></section>;
}
// Открывает данные предыдущего запуска рядом с редактируемой схемой и запускает безопасный повтор сохранённого черновика.
export function AgentDebugEditor({agentId,draftRevision,onSelectRun,notify}){
 const list=useWork(agentId?`agents/${agentId}/runs`:null),[selected,setSelected]=useState(''),[requestId,setRequestId]=useState(null),[busy,act]=useAction(notify);
 // Загружает подробности и входы только после серверной проверки актуального доступа.
 function open(id){setSelected(id);setRequestId(null);onSelectRun(null);if(!id)return;act(async()=>{const [run,debug]=await Promise.all([workApi(`agents/runs/${id}`),workApi(`agents/runs/${id}/debug`)]);onSelectRun({run,debug});});}
 // Повторяет сохранённый черновик на прежних данных, никогда не применяя предложенные действия.
 function replay(){act(async()=>{const id=requestId||crypto.randomUUID();setRequestId(id);const result=await workApi(`agents/runs/${selected}/replay`,{method:'POST',body:JSON.stringify({request_id:id,...(draftRevision?{draft_revision:draftRevision}:{})})});await list.reload();notify(`Проверка #${result.id} поставлена в очередь. Обновите список после выполнения.`);});}
 if(!agentId)return <p className="work-muted">После сохранения агента здесь можно будет открыть прежний запуск на схеме.</p>;
 return <details className="agent-debug-editor"><summary>Проверка по предыдущему запуску</summary><ErrorLine error={list.error}/><Field label="Данные запуска"><select disabled={busy} value={selected} onChange={e=>open(e.target.value)}><option value="">Без наложения результатов</option>{list.value?.map(r=><option key={r.id} value={r.id}>#{r.id} · {r.status} · {r.created_at}</option>)}</select></Field><div className="work-actions"><button type="button" className="secondary" disabled={busy||!selected} onClick={()=>open(selected)}>Обновить разбор</button><button type="button" className="secondary" disabled={busy} onClick={list.reload}>Обновить список</button><button type="button" className="primary" disabled={busy||!selected} onClick={replay}>Повторить без применения действий</button></div><p className="work-muted">Повтор использует сохранённый черновик или опубликованную версию. Сначала сохраните изменения схемы. Источники должны сохранять версии и текущий доступ; обращения к модели учитываются в общем бюджете.</p></details>;
}
// Позволяет выбирать блоки в журнале и разбирать сохранённые входы рядом с пройденным путём.
export function AgentRunCanvas({run,canDebug}){
 const [selected,setSelected]=useState(null),debug=useWork(canDebug&&run.meta.debug_available?`agents/runs/${run.id}/debug`:null);
 return <><AgentCanvas flow={run.flow} steps={run.steps||[]} selected={selected} onSelect={setSelected}/><ErrorLine error={debug.error}/><AgentStepDetails id={selected} run={run} debug={debug.value}/></>;
}
