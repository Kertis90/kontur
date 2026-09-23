import test from 'node:test';
import assert from 'node:assert/strict';
import {load} from './test-module-loader.mjs';

// Подготавливает задачу Jira с обязательными идентификаторами для проверки переноса.
function issue(fields = {}) {
  return {id: '100', key: 'MOVE-1', fields: {summary: 'Переезд', status: {id: '1', name: 'Открыто'}, ...fields}};
}

test('перенос требует явное соответствие этапа и сохраняет тип и дополнительные поля', async () => {
  const m = await load('jira-transfer-model.js');
  const input = issue({issuetype: {id: '7'}, assignee: {key: 'anna'}, customfield_1: 'Значение'});
  const value = m.transferDraft(input, {stages: {'1': 2}, users: {anna: 3}, types: {'7': 4}, fields: {customfield_1: 'department'}});
  assert.equal(value.task.stage_id, 2);
  assert.equal(value.task.assignee_id, 3);
  assert.equal(value.task.issue_type_id, 4);
  assert.equal(value.task.custom_values.department, 'Значение');
  assert.equal(m.transferDraft(input, {}).errors.length > 0, true);
});

test('неоднозначный сотрудник не назначается по отображаемому имени', async () => {
  const m = await load('jira-transfer-model.js');
  const value = m.transferDraft(issue({assignee: {key: 'missing', displayName: 'Анна'}}), {stages: {'1': 2}});
  assert.equal(value.task.assignee_id, null);
  assert.ok(value.warnings.some(x => x.includes('Исполнитель')));
});

test('закрытые задачи и комментарии не расширяют круг читателей при импорте', async () => {
  const m = await load('jira-transfer-model.js');
  assert.equal(m.transferDraft(issue({security: {id: '10'}}), {stages: {'1': 2}}).restricted, true);
  const value = m.transferDraft(issue({comment: {comments: [{id: 'c', visibility: {type: 'role', value: 'Managers'}, body: 'Секрет'}]}}), {stages: {'1': 2}});
  assert.equal(value.history.length, 0);
  assert.ok(value.warnings.some(x => x.includes('ограниченным доступом')));
});

test('повторный перенос различает неизменённые данные, обновление и конфликт', async () => {
  const m = await load('jira-transfer-model.js');
  const base = {title: 'До', description: 'Текст'};
  assert.equal(m.transferDecision(null, null, base).action, 'create');
  assert.equal(m.transferDecision(base, base, base).action, 'unchanged');
  assert.equal(m.transferDecision(base, base, {...base, title: 'После'}).action, 'update');
  assert.equal(m.transferDecision(base, {...base, title: 'Локально'}, {...base, title: 'Jira'}).action, 'conflict');
  assert.equal(m.transferDecision(base, {...base, title: 'Локально'}, base).action, 'keep');
});

test('несовпадающие локальные и удалённые изменения объединяются без потерь', async () => {
  const m = await load('jira-transfer-model.js');
  const base = {title: 'До', description: 'До', custom_values: {a: 1, b: 1}};
  const result = m.transferDecision(base, {...base, description: 'Локально', custom_values: {a: 1, b: 2}}, {...base, title: 'Jira', custom_values: {a: 2, b: 1}});
  assert.equal(result.action, 'update');
  assert.equal(result.patch.title, 'Jira');
  assert.equal(result.patch.description, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(result.patch.custom_values)), {a: 2});
});

test('неизвестные поля и неполная история отражаются в сверке', async () => {
  const m = await load('jira-transfer-model.js');
  const value = m.transferDraft(issue({customfield_55: 'Важно', comment: {total: 2, comments: []}, components: [{name: 'Web'}]}), {stages: {'1': 2}});
  assert.ok(value.warnings.some(x => x.includes('customfield_55')));
  assert.ok(value.warnings.some(x => x.includes('не все комментарии')));
  assert.ok(value.warnings.some(x => x.includes('Компоненты')));
});

test('сверка запрещает переключение при конфликтах, ошибках и неполных файлах', async () => {
  const m = await load('jira-transfer-model.js');
  assert.equal(m.transferReady([{status: 'done', warnings: [], files_expected: 1, files_done: 1, links_pending: 0}]).ready, true);
  for (const row of [{status: 'conflict'}, {status: 'error'}, {status: 'done', files_expected: 1, files_done: 0}, {status: 'done', links_pending: 1}]) {
    assert.equal(m.transferReady([row]).ready, false);
  }
});

test('Jira Data Center использует контекстный путь и стабильную постраничную выборку', async () => {
  const calls = [];
  const m = await load('jira-transfer-client.js', {'integration-http.js': {integrationUrl: value => new URL(value), integrationRequest: async (url, options) => {calls.push({url, options});return {status: 200, headers: {}, text: JSON.stringify({issues: [issue()], startAt: 0, total: 2})};}}});
  const result = await m.jiraPage({url: 'https://jira.example.ru/jira', project_key: 'MOVE', kind: 'data_center'}, {token: 'fixture'}, 0);
  assert.equal(result.next, 1);
  assert.match(calls[0].url, /\/jira\/rest\/api\/2\/search/);
  assert.match(calls[0].options.body, /ORDER BY id ASC/);
  assert.equal(calls[0].options.headers.authorization, 'Bearer fixture');
});

test('лимит Jira сохраняет задержку повтора, а ошибка не раскрывает ответ сервера', async () => {
  const m = await load('jira-transfer-client.js', {'integration-http.js': {integrationUrl: value => new URL(value), integrationRequest: async () => ({status: 429, headers: {'retry-after': '30'}, text: 'secret'})}});
  await assert.rejects(() => m.jiraPage({url: 'https://jira.example.ru', project_key: 'MOVE', kind: 'data_center'}, {token: 'fixture'}), e => e.code === 'JIRA_RATE_LIMIT' && e.retryAfter === 30 && !e.message.includes('secret'));
});

test('адрес файла другого сервера не получает реквизиты Jira', async () => {
  let called = false;
  const m = await load('jira-transfer-client.js', {'integration-http.js': {integrationUrl: value => new URL(value), integrationRequest: async () => {called = true;}}});
  await assert.rejects(() => m.jiraFile({url: 'https://jira.example.ru/jira'}, {token: 'fixture'}, {url: 'https://other.example.ru/file', expected_size: 2}), /адрес/i);
  assert.equal(called, false);
});

test('Cloud использует новый поиск и продолжение без изменения исходного проекта', async () => {
  const calls = [];
  const m = await load('jira-transfer-client.js', {'integration-http.js': {integrationUrl: value => new URL(value), integrationRequest: async (url, options) => {calls.push({url, options});return {status: 200, text: JSON.stringify({issues: [issue()], nextPageToken: 'page-2'})};}}});
  const result = await m.jiraPage({url: 'https://jira.example.ru', project_key: 'MOVE', kind: 'cloud'}, {username: 'u@example.ru', token: 'fixture'}, 'page-1');
  assert.match(calls[0].url, /rest\/api\/3\/search\/jql$/);
  assert.equal(JSON.parse(calls[0].options.body).nextPageToken, 'page-1');
  assert.equal(result.next, 'page-2');
});

test('все страницы комментариев и истории Cloud читаются с повторной проверкой доступа', async () => {
  let checks = 0;
  const m = await load('jira-transfer-client.js', {'integration-http.js': {integrationUrl: value => new URL(value), integrationRequest: async url => {
    const data = url.includes('/comment?') ? {comments: [{id: url.includes('startAt=0') ? 'a' : 'b', body: 'Текст'}], total: 2} : url.includes('/changelog?') ? {values: [{id: url.includes('startAt=0') ? 'h1' : 'h2'}], total: 2} : {...issue(), changelog: {histories: [], total: 2}};
    return {status: 200, text: JSON.stringify(data)};
  }}});
  const result = await m.jiraIssue({url: 'https://jira.example.ru', kind: 'cloud'}, {token: 'fixture'}, '100', async () => {checks++;});
  assert.equal(result.fields.comment.comments.length, 2);
  assert.equal(result.changelog.histories.length, 2);
  assert.equal(checks, 5);
});

test('отзыв доступа останавливает запрос до отправки токена', async () => {
  let sent = false;
  const m = await load('jira-transfer-client.js', {'integration-http.js': {integrationUrl: value => new URL(value), integrationRequest: async () => {sent = true;}}});
  await assert.rejects(() => m.jiraPage({url: 'https://jira.example.ru', project_key: 'MOVE'}, {token: 'fixture'}, 0, async () => {throw new Error('Нет доступа');}), /Нет доступа/);
  assert.equal(sent, false);
});

test('некорректная и пустая страница возвращает безопасный код ошибки', async () => {
  for (const value of ['private response', '{"issues":[],"total":10}', '{}']) {
    const m = await load('jira-transfer-client.js', {'integration-http.js': {integrationUrl: value => new URL(value), integrationRequest: async () => ({status: 200, text: value})}});
    await assert.rejects(() => m.jiraPage({url: 'https://jira.example.ru', project_key: 'MOVE'}, {token: 'fixture'}), error => ['JIRA_INVALID_RESPONSE', 'JIRA_EMPTY_PAGE'].includes(error.code));
  }
});

test('скачивание сверяет размер файла и сохраняет двоичные данные', async () => {
  const m = await load('jira-transfer-client.js', {'integration-http.js': {integrationUrl: value => new URL(value), integrationRequest: async () => ({status: 200, bytes: Buffer.from([0, 255])})}});
  const source = {url: 'https://jira.example.ru/jira'}, file = {url: 'https://jira.example.ru/jira/file', expected_size: 2};
  assert.deepEqual(await m.jiraFile(source, {token: 'fixture'}, file), Buffer.from([0, 255]));
  await assert.rejects(() => m.jiraFile(source, {token: 'fixture'}, {...file, expected_size: 1}), error => error.code === 'JIRA_FILE_SIZE');
  await assert.rejects(() => m.jiraFile(source, {token: 'fixture'}, {...file, expected_size: 100000001}), error => error.code === 'JIRA_FILE_TOO_LARGE');
});

test('неизвестный приоритет отражается в отчёте и название не обрезается молча', async () => {
  const m = await load('jira-transfer-model.js');
  const value = m.transferDraft(issue({summary: 'Я'.repeat(301), priority: {name: 'Особый'}}), {stages: {'1': 2}});
  assert.equal(value.task.title.length, 301);
  assert.ok(value.warnings.some(warning => warning.includes('Приоритет')));
});

test('актуальные права переноса исключают токены, служебных сотрудников и скрытые поля', async () => {
  for (const scenario of ['blocked', 'service', 'token', 'hidden', 'readonly']) {
    const m = await load('jira-transfer-access.js', {'db.js': {one: async () => scenario === 'blocked' ? null : {id: 1, workspace_id: 2, is_service: scenario === 'service'}}, 'permissions.js': {workspacePermissionSet: async () => new Set(['import.manage']), projectPermissionSet: async () => new Set(['project.admin'])}, 'work-common.js': {projectFor: async () => {}, workspaceFor: async () => {}, validUsers: async () => {}, dateOnly: {}, WorkError: class extends Error {constructor(status, message) {super(message);this.status = status;}}}, 'work-access.js': {fieldAccess: async () => [{can_read: scenario !== 'hidden', can_edit: scenario !== 'readonly'}]}});
    await assert.rejects(() => m.transferAccess({id: 1, workspace_id: 2, api_token_id: scenario === 'token' ? 4 : null}, 3, true), error => error.status === 403);
  }
});
