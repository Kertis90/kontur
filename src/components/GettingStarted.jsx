"use client";
import {useState} from 'react';
import {workApi, useAction, Field} from './WorkUI.jsx';

// Ведёт пользователя от названия организации к сотрудникам, проекту, переносу и первой задаче.
export default function GettingStarted({data, notify, reload, onNewProject, onNewTask}) {
  const [name, setName] = useState(data.workspace.name), [busy, act] = useAction(notify);
  const admin = ['owner', 'admin'].includes(data.user.global_role), features = data.permissions.features;
  const steps = [
    {title: 'Добавьте сотрудников', complete: data.users.filter(user => user.status === 'active').length > 1, text: 'Создайте учётные записи или настройте корпоративный вход. Выдайте доступ к нужным проектам.', href: '/?view=admin&section=users', allowed: features['user.manage'], action: 'Открыть сотрудников'},
    {title: 'Создайте проект', complete: data.projects.length > 0, text: 'Выберите понятное название и процесс работы. Права участников можно настроить в карточке проекта.', run: onNewProject, allowed: data.permissions.manageProjects, action: 'Создать проект'},
    {title: 'Перенесите данные Jira', text: 'Подключите один пилотный проект, проверьте сотрудников и статусы, затем изучите отчёт. Этот шаг можно пропустить для нового проекта.', href: '/?view=admin&section=imports', allowed: features['import.manage'], action: 'Открыть переезд с Jira'},
    {title: 'Начните работу с задачей', complete: data.tasks.length > 0, text: 'Укажите ответственного и срок. Проверьте, что коллега видит задачу и может продолжить работу.', run: onNewTask, allowed: Boolean(onNewTask), action: 'Создать задачу'},
  ];
  return <section className="view-page getting-started"><div className="page-head"><div><span className="overline">ПЕРВЫЕ ШАГИ</span><h1>Начать работу в Контуре</h1><p>Пройдите настройку по порядку. К каждому шагу можно вернуться позже.</p></div></div>
    <div className="work-card"><h2>1. Название организации</h2><p>Это название увидят сотрудники в верхней части страницы.</p><Field label="Название организации"><input disabled={!admin} value={name} maxLength={120} onChange={event => setName(event.target.value)}/></Field>{admin && <button className="primary" disabled={busy || name.trim().length < 2 || name.trim() === data.workspace.name} onClick={() => act(async () => {await workApi('onboarding', {method: 'PUT', body: JSON.stringify({name, previous_name: data.workspace.name})});await reload();notify('Название сохранено');})}>Сохранить название</button>}</div>
    <ol className="getting-started-steps" start={2}>{steps.map(step => <li className="work-card" key={step.title}><div><h2>{step.title}</h2>{step.complete && <span className="getting-started-done">Уже есть в организации</span>}</div><p>{step.text}</p>{step.allowed ? step.href ? <a className="secondary" href={step.href}>{step.action}</a> : <button className="secondary" onClick={step.run}>{step.action}</button> : <p className="work-muted">Попросите владельца проекта выполнить этот шаг или выдать нужный доступ.</p>}</li>)}</ol>
  </section>;
}
