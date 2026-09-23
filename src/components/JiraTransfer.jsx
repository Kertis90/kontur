"use client";
import {useEffect, useState} from 'react';
import {workApi, useWork, useAction, Field, Select, ErrorLine, WorkHeader} from './WorkUI.jsx';

const names = {draft: 'Настройка', preparing: 'Подготовка данных', preview: 'Проверьте соответствия', running: 'Перенос', paused: 'Пауза', completed: 'Сверка', cutover: 'Команда работает в Контуре', failed: 'Нужна проверка'};
const states = {fetch: 'Получаем из Jira', pending: 'Готова к переносу', done: 'Перенесена', conflict: 'Нужно выбрать изменения', error: 'Проверьте соответствия', excluded: 'Исключена по ограничениям доступа'};
const errors = {ACCESS_REVOKED: 'Доступ сотрудника изменился. Проверьте права проекта.', ADDRESS_BLOCKED: 'Адрес Jira запрещён настройками сети. Администратор может разрешить точное имя внутреннего сервера.', JIRA_HTTP_401: 'Jira не приняла токен. Обновите реквизиты.', JIRA_HTTP_403: 'В Jira недостаточно прав чтения.', JIRA_RATE_LIMIT: 'Jira ограничила запросы. Повтор будет выполнен с задержкой.', JIRA_MAPPING: 'Проверьте соответствия и формат значений полей.', JIRA_TRANSFER_FAILED: 'Проверьте доступность Jira, базы и хранилища, затем продолжите.', JIRA_ACCESS_CHANGED: 'Исходная задача стала закрытой. Проверьте доступ к ранее перенесённой задаче.'};

// Показывает обе версии полей понятными названиями перед решением конфликта.
function TaskPreview({preview, data, onClose}) {
  const labels = {title: 'Название', description: 'Описание', stage_id: 'Этап', priority: 'Приоритет', assignee_id: 'Исполнитель', due_date: 'Срок', issue_type_id: 'Тип задачи', story_points: 'Оценка в баллах', estimate_minutes: 'Оценка в минутах'};
  const fields = Object.keys(preview.task || {}).filter(key => key !== 'custom_values');
  // Заменяет внутренние идентификаторы этапов, сотрудников и типов их названиями.
  function display(key, value) {
    if (value == null || value === '') return 'Не указано';
    const items = key === 'stage_id' ? data.workflows.flatMap(item => item.stages) : key === 'assignee_id' ? data.users : key === 'issue_type_id' ? data.issueTypes : [];
    if (items.length) {const item = items.find(entry => Number(entry.id) === Number(value));return item?.display_name || item?.name || 'Недоступное значение';}
    if (key === 'priority') return {critical: 'Критический', high: 'Высокий', medium: 'Средний', low: 'Низкий'}[value] || value;
    if (typeof value === 'boolean') return value ? 'Да' : 'Нет';
    return Array.isArray(value) ? value.join(', ') : typeof value === 'object' ? JSON.stringify(value) : String(value);
  }
  return <details open className="work-card"><summary>Сравнение полей {preview.key}</summary><div className="work-table-scroll"><table className="work-table jira-preview"><thead><tr><th>Поле</th>{preview.local && <th>Сейчас в Контуре</th>}<th>Подготовлено из Jira</th></tr></thead><tbody>{fields.map(key => <tr key={key}><th>{labels[key] || key}</th>{preview.local && <td>{display(key, preview.local[key])}</td>}<td>{display(key, preview.task[key])}</td></tr>)}{Object.entries(preview.task?.custom_values || {}).map(([key, value]) => <tr key={key}><th>{data.fields.find(field => field.code === key)?.label || key}</th>{preview.local && <td>{display(key, preview.local.custom_values?.[key])}</td>}<td>{display(key, value)}</td></tr>)}</tbody></table></div>{[...preview.errors, ...preview.warnings].map((message, index) => <p key={index}>{message}</p>)}<button className="secondary" onClick={onClose}>Закрыть просмотр</button></details>;
}

// Показывает сохранённые соответствия исходных значений сотрудникам, этапам, типам и полям Контура.
function MappingFields({catalog, mapping, onChange, data, projectId}) {
  const project = data.projects.find(item => Number(item.id) === Number(projectId));
  const sections = [
    ['stages', 'Этап', data.workflows.find(item => item.id === project?.workflow_id)?.stages || []],
    ['users', 'Сотрудник', data.users], ['types', 'Тип задачи', data.issueTypes || []],
  ];
  // Обновляет одно соответствие и удаляет пустое значение из сохранённых настроек.
  function change(part, key, value) {
    const next = {...mapping[part]};
    if (value) next[key] = value; else delete next[key];
    onChange({...mapping, [part]: next});
  }
  return <div className="jira-mapping"><h3>Соответствия Jira → Контур</h3><p>После первого получения задач здесь появятся значения вашей Jira. Сохраните соответствия и повторите подготовку.</p>
    {sections.map(([part, label, items]) => <details key={part} open={part === 'stages'}><summary>{label} · {Object.keys(catalog[part] || {}).length}</summary><div className="work-form-grid">{Object.entries(catalog[part] || {}).map(([key, name]) => <Field key={key} label={`${name} (${key})`}><Select items={items} value={mapping[part]?.[key]} onChange={value => change(part, key, value)}/></Field>)}</div></details>)}
    <details><summary>Дополнительные поля</summary><div className="work-form-grid">{Object.entries(catalog.fields || {}).map(([key, label]) => <Field key={key} label={label}><select value={mapping.fields?.[key] || ''} onChange={event => change('fields', key, event.target.value)}><option value="">Не переносить</option>{data.fields.map(field => <option key={field.code} value={field.code}>{field.label}</option>)}</select></Field>)}</div>
      <Field label="Поле связи с эпиком в Jira"><input placeholder="customfield_10014" value={mapping.epic_field || ''} onChange={event => {const next = {...mapping};if (event.target.value) next.epic_field = event.target.value;else delete next.epic_field;onChange(next);}}/></Field>
      <Field label="Поле оценки в баллах в Jira"><input placeholder="customfield_10016" value={mapping.points_field || ''} onChange={event => {const next = {...mapping};if (event.target.value) next.points_field = event.target.value;else delete next.points_field;onChange(next);}}/></Field>
    </details>
  </div>;
}

// Настраивает новое подключение или соответствия существующего без отображения сохранённого токена.
function SourceSettings({source, data, notify, onSaved}) {
  const projects = data.projects.filter(project => data.permissions.projects[project.id]?.['project.admin']);
  const [draft, setDraft] = useState(() => source ? {...source, credentials: undefined} : {name: 'Переезд с Jira', project_id: projects[0]?.id, kind: 'data_center', url: '', project_key: '', include_files: true, mapping: {}});
  const [token, setToken] = useState(''), [username, setUsername] = useState(''), [busy, act] = useAction(notify);
  // Сохраняет настройки и немедленно удаляет введённые реквизиты из состояния формы.
  async function save(event) {
    event.preventDefault();
    await act(async () => {
      const value = {name: draft.name, project_id: draft.project_id, kind: draft.kind, url: draft.url.trim().replace(/\/$/, ''), project_key: draft.project_key.trim(), include_files: draft.include_files, mapping: draft.mapping, ...(source ? {revision: source.revision} : {}), ...(token ? {credentials: {token, ...(draft.kind === 'cloud' ? {username} : {})}} : {})};
      const result = await workApi(`jira-imports/sources${source ? `/${source.id}` : ''}`, {method: source ? 'PUT' : 'POST', body: JSON.stringify(value)});
      setToken('');setUsername('');await onSaved(source?.id || result.id);notify('Настройки сохранены. Подготовьте данные для проверки.');
    });
  }
  return <form className="jira-source-form" onSubmit={save}><div className="work-form-grid">
    <Field label="Название подключения"><input required maxLength={160} value={draft.name} onChange={event => setDraft({...draft, name: event.target.value})}/></Field>
    <Field label="Проект Контура"><Select disabled={Boolean(source)} items={projects} value={draft.project_id} onChange={project_id => setDraft({...draft, project_id})}/></Field>
    <Field label="Вариант Jira"><select disabled={Boolean(source)} value={draft.kind} onChange={event => setDraft({...draft, kind: event.target.value})}><option value="data_center">Jira Data Center / свой сервер</option><option value="cloud">Jira Cloud</option></select></Field>
    <Field label="Адрес Jira"><input type="url" required disabled={Boolean(source)} placeholder="https://jira.company.ru" value={draft.url} onChange={event => setDraft({...draft, url: event.target.value})}/></Field>
    <Field label="Ключ проекта Jira"><input required disabled={Boolean(source)} pattern="[A-Za-z][A-Za-z0-9_]{0,49}" placeholder="TEAM" value={draft.project_key} onChange={event => setDraft({...draft, project_key: event.target.value})}/></Field>
    {draft.kind === 'cloud' && <Field label="Почта владельца токена"><input type="email" required={!source || Boolean(token)} autoComplete="off" value={username} onChange={event => setUsername(event.target.value)}/></Field>}
    <Field label={source ? 'Новый токен, если нужно заменить' : 'Токен Jira для чтения'}><input type="password" autoComplete="new-password" required={!source} value={token} onChange={event => setToken(event.target.value)}/></Field>
  </div><label className="connector-check"><input type="checkbox" checked={draft.include_files} onChange={event => setDraft({...draft, include_files: event.target.checked})}/>Перенести файлы автоматически</label>
    <p className="work-muted">Контур читает выбранный проект Jira. Изменения и удаления в Jira не выполняются. Для внутреннего адреса администратор разрешает имя сервера в настройках сети.</p>
    {source && <MappingFields data={data} projectId={draft.project_id} catalog={source.catalog} mapping={draft.mapping} onChange={mapping => setDraft({...draft, mapping})}/>}
    <button className="primary" disabled={busy || !draft.project_id}>Сохранить подключение</button>
  </form>;
}

// Управляет поэтапным переездом и показывает сверку, конфликты и окончательное переключение.
export default function JiraTransfer({data, notify, reload}) {
  const list = useWork('jira-imports/sources'), [selected, setSelected] = useState(null), [creating, setCreating] = useState(false), [after, setAfter] = useState(0);
  const api = useWork(selected ? `jira-imports/sources/${selected}?after=${after}` : null), [busy, act] = useAction(notify), [accepted, setAccepted] = useState(false), [confirmation, setConfirmation] = useState(''), [preview, setPreview] = useState(null);
  const source = api.value, running = ['preparing', 'running'].includes(source?.status);
  useEffect(() => {setAfter(0);setAccepted(false);setConfirmation('');setPreview(null);}, [selected]);
  useEffect(() => {if (!running) return;const timer = setInterval(api.reload, 3000);return () => clearInterval(timer);}, [running, api.reload]);
  // Выполняет действие с актуальной версией подключения и обновляет результаты.
  async function action(name, extra = {}) {
    await workApi(`jira-imports/sources/${selected}/actions`, {method: 'POST', body: JSON.stringify({action: name, revision: source.revision, accept_warnings: accepted, confirmation, ...extra})});
    await api.reload();await list.reload();await reload();setPreview(null);
  }
  // Собирает все страницы отчёта, не ограничиваясь видимыми ста задачами.
  async function download() {
    let cursor = 0, records = [];
    do {const page = await workApi(`jira-imports/sources/${selected}?after=${cursor}`);if (page.revision !== source.revision) throw new Error('Перенос изменился. Обновите страницу перед скачиванием отчёта.');records.push(...page.records);cursor = page.next;} while (cursor);
    const url = URL.createObjectURL(new Blob([JSON.stringify({name: source.name, project_key: source.project_key, run: source.run_number, report: source.report, records}, null, 2)], {type: 'application/json'}));
    const anchor = document.createElement('a');anchor.href = url;anchor.download = `jira-transfer-${selected}.json`;anchor.click();setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="work-card jira-transfer"><WorkHeader title="Переезд с Jira" text="Подключите проект, проверьте соответствия, перенесите данные и переключите команду после сверки."><button className="primary" onClick={() => setCreating(!creating)}>{creating ? 'Закрыть настройку' : 'Подключить Jira'}</button></WorkHeader>
    {creating && <SourceSettings data={data} notify={notify} onSaved={async id => {setSelected(id);setCreating(false);await list.reload();}}/>}
    <ErrorLine error={list.error || api.error}/>
    <Field label="Подключённый проект Jira"><select value={selected || ''} onChange={event => setSelected(Number(event.target.value) || null)}><option value="">Выберите подключение</option>{list.value?.map(item => <option key={item.id} value={item.id}>{item.name} · {names[item.status]}</option>)}</select></Field>
    {source && <><h3>{source.name} · {names[source.status]}</h3><p role="status">Проход {source.run_number} · задач: {source.report.total} · перенесено: {source.report.done} · конфликтов: {source.report.conflicts} · ошибок: {source.report.errors}</p>
      <ErrorLine error={source.error_code && (errors[source.error_code] || `Перенос остановлен: ${source.error_code}. Проверьте подключение и продолжите.`)}/>
      <p>Не загружено файлов: {source.report.files_missing}. Ожидают связи: {source.report.links_pending}. Исключено по доступу: {source.report.excluded}. Не найдены в текущей выборке Jira: {source.report.missing} (задачи Контура сохраняются).</p>
      {!running && source.status !== 'cutover' && <details className="jira-settings" open={['draft', 'preview'].includes(source.status)}><summary>Настройки и соответствия</summary><SourceSettings key={`${source.id}-${source.status}`} source={source} data={data} notify={notify} onSaved={async () => {await api.reload();await list.reload();}}/></details>}
      <div className="work-actions">
        {!running && source.status !== 'cutover' && <button className="secondary" disabled={busy} onClick={() => act(() => action('prepare'))}>Получить данные для проверки</button>}
        {source.status === 'preview' && <button className="primary" disabled={busy || Number(source.report.errors) > 0} onClick={() => act(() => action('start'))}>Подтвердить перенос</button>}
        {running && <button className="secondary" disabled={busy} onClick={() => act(() => action('pause'))}>Остановить</button>}
        {['paused', 'failed'].includes(source.status) && <button className="primary" disabled={busy} onClick={() => act(() => action('resume'))}>Продолжить</button>}
        {source.status === 'completed' && <button className="secondary" disabled={busy} onClick={() => act(() => action('relink'))}>Повторно проверить связи</button>}
        <button className="secondary" disabled={busy || running} onClick={() => act(download)}>Скачать полный отчёт</button>
        <button className="secondary" disabled={busy} onClick={api.reload}>Обновить сверку</button>
      </div>
      {source.status !== 'cutover' && <label className="connector-check"><input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)}/>Предупреждения и исключения просмотрены, согласен с указанным составом переноса</label>}
      <div className="work-table-scroll"><table className="work-table"><thead><tr><th>Задача Jira</th><th>Результат</th><th>Действия</th></tr></thead><tbody>{source.records.map(item => <tr key={item.id}><td>{item.issue_key}</td><td>{states[item.status]}{item.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</td><td>{item.status !== 'fetch' && item.status !== 'excluded' && <button className="text-button" onClick={() => act(async () => setPreview(await workApi(`jira-imports/sources/${selected}/items/${item.id}`)))}>Посмотреть поля</button>}{item.task_id && <a href={`/?task=${item.task_id}`} target="_blank" rel="noreferrer">Открыть задачу Контура</a>}{item.status === 'conflict' && source.status === 'completed' && <div className="work-actions"><button className="secondary" disabled={busy} onClick={() => act(() => action('resolve', {item_id: item.id, choice: 'local'}))}>Сохранить поля Контура</button><button className="secondary" disabled={busy} onClick={() => act(() => action('resolve', {item_id: item.id, choice: 'jira'}))}>Принять поля Jira</button></div>}</td></tr>)}</tbody></table></div>
      <div className="work-actions"><button className="secondary" disabled={!after} onClick={() => setAfter(0)}>К началу</button><button className="secondary" disabled={!source.next} onClick={() => setAfter(source.next)}>Следующие задачи</button></div>
      {preview && <TaskPreview preview={preview} data={data} onClose={() => setPreview(null)}/>}
      {source.status === 'completed' && <div className="jira-cutover"><h3>Завершение переезда</h3><p>Остановите изменения выбранного проекта в Jira, выполните последний перенос и проверьте отчёт. Подтверждение отключит дальнейшие переносы этого подключения. Настройки самой Jira не меняются.</p><Field label="Введите ключ проекта Jira для подтверждения"><input value={confirmation} onChange={event => setConfirmation(event.target.value)}/></Field><button className="primary" disabled={busy || !source.report.ready || confirmation !== source.project_key} onClick={() => act(() => action('cutover'))}>Команда переходит в Контур</button></div>}
    </>}
  </section>;
}
