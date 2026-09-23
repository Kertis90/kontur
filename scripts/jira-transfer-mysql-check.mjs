import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {browserEnv} from './browser-env.mjs';
import {load} from './test-module-loader.mjs';

Object.assign(process.env, browserEnv);
const database = await import('../src/lib/db.js');
const {one, rows, db} = database;
const {jiraTransferApi} = await import('../src/lib/jira-transfer-api.js');
const {storage, bucket} = await import('../src/lib/storage.js');
const tag = randomUUID().slice(0, 8), projectKey = `MOVE${tag.replace(/-/g, '')}`;
const owner = await one('SELECT * FROM users WHERE email=?', [browserEnv.ADMIN_EMAIL]);
const project = await one("SELECT * FROM projects WHERE workspace_id=? AND status='active' ORDER BY id LIMIT 1", [owner.workspace_id]);
const stage = await one('SELECT id FROM workflow_stages WHERE workflow_id=? ORDER BY position LIMIT 1', [project.workflow_id]);
const [createdUser] = await db.query("INSERT INTO users(workspace_id,email,display_name,password_hash,global_role,status) VALUES(?,?,?,NULL,'admin','active')", [owner.workspace_id, `transfer-${tag}@example.invalid`, 'Проверка переноса']);
const user = await one('SELECT * FROM users WHERE id=?', [createdUser.insertId]);
let sourceId, remoteTitle = 'Исходное название', remoteDescription = 'Описание Jira', failNextPage = false;
const keyA = `${projectKey}-1`, keyB = `${projectKey}-2`;

// Вызывает настоящий обработчик API с текущими правами тестового сотрудника.
async function call(method, tail = '', data) {
  const path = `jira-imports/sources${tail}`;
  const response = await jiraTransferApi(new Request(`https://kontur.test/api/work/${path}`, {method, ...(data ? {body: JSON.stringify(data)} : {})}), path.split('?')[0].split('/'), user);
  return response.json();
}

// Подготавливает известный ответ Jira; все операции хранения и изменения задач выполняются реально.
function issue(id) {
  return {id, key: id === '100' ? keyA : keyB, fields: {summary: id === '100' ? remoteTitle : 'Связанная задача', description: remoteDescription, status: {id: 'open', name: 'Открыто'}, comment: {total: 1, comments: [{id: 'comment-1', body: 'Комментарий Jira', author: {displayName: 'Автор'}}]}, attachment: id === '100' ? [{id: 'file-1', filename: 'проверка.txt', size: 4, mimeType: 'text/plain', content: 'https://jira.example.invalid/file/1'}] : [], issuelinks: id === '100' ? [{type: {name: 'Blocks'}, outwardIssue: {key: keyB}}] : []}};
}

const worker = await load('jira-transfer-worker.js', {'db.js': database, 'jira-transfer-client.js': {
  // Возвращает две отдельные страницы для проверки связей между пакетами.
  jiraPage: async (source, credentials, cursor, authorize) => {await authorize();if (failNextPage) {failNextPage = false;throw Object.assign(new Error('JIRA_RATE_LIMIT'), {code: 'JIRA_RATE_LIMIT', retryAfter: 30});}return Number(cursor) ? {issues: [{id: '101', key: keyB}], next: null} : {issues: [{id: '100', key: keyA}], next: 1};},
  // Возвращает управляемые изменения исходной задачи для проверки повторного переноса.
  jiraIssue: async (source, credentials, id, authorize) => {await authorize();return issue(id);},
  // Возвращает байты файла, который будет сохранён в настоящем S3 тестового стенда.
  jiraFile: async (source, credentials, file, authorize) => {await authorize();return Buffer.from('test');},
}}, browserEnv);

// Выполняет обработчик до ожидаемого состояния с ограничением числа шагов.
async function until(status) {
  for (let index = 0; index < 30; index++) {
    await worker.pollJiraTransfers();
    const source = await call('GET', `/${sourceId}`);
    if (source.status === 'failed') throw new Error(`Перенос остановился: ${source.error_code}`);
    if (source.status === status) return source;
  }
  throw new Error(`Не достигнуто состояние ${status}`);
}

// Подготавливает и подтверждает очередной проход через публичные действия API.
async function transfer() {
  let source = await call('GET', `/${sourceId}`);
  await call('POST', `/${sourceId}/actions`, {action: 'prepare', revision: source.revision});
  source = await until('preview');
  assert.equal(Number(source.report.errors), 0);
  await call('POST', `/${sourceId}/actions`, {action: 'start', revision: source.revision, accept_warnings: true});
  return until('completed');
}

try {
  if (!await storage().bucketExists(bucket())) await storage().makeBucket(bucket());
  sourceId = (await call('POST', '', {name: `Пилот ${tag}`, project_id: project.id, kind: 'data_center', url: 'https://jira.example.invalid', project_key: projectKey, credentials: {token: 'disposable-jira-token'}, mapping: {stages: {open: stage.id}}, include_files: true})).id;
  const existingTask = await one('SELECT id FROM tasks WHERE project_id=? ORDER BY id LIMIT 1', [project.id]);
  await rows('INSERT INTO work_import_items(project_id,external_key,task_id) VALUES(?,?,?)', [project.id, keyA, existingTask.id]);
  await call('POST', `/${sourceId}/actions`, {action: 'prepare', revision: 1});
  let paused = await call('GET', `/${sourceId}`);
  await call('POST', `/${sourceId}/actions`, {action: 'pause', revision: paused.revision});
  await worker.pollJiraTransfers();
  const stopped = await call('GET', `/${sourceId}`);
  assert.equal(stopped.status, 'paused');
  assert.equal(Number(stopped.report.total), 0);
  await assert.rejects(() => call('POST', `/${sourceId}/actions`, {action: 'resume', revision: paused.revision}));
  await call('POST', `/${sourceId}/actions`, {action: 'resume', revision: stopped.revision});
  failNextPage = true;
  await worker.pollJiraTransfers();
  const waiting = await call('GET', `/${sourceId}`);
  assert.equal(waiting.status, 'preparing');
  assert.equal(waiting.error_code, 'JIRA_RATE_LIMIT');
  assert.equal(waiting.attempts, 1);
  assert.ok((await one('SELECT TIMESTAMPDIFF(SECOND,CURRENT_TIMESTAMP,available_at) AS delay FROM jira_transfer_sources WHERE id=?', [sourceId])).delay > 20);
  await rows('UPDATE jira_transfer_sources SET available_at=CURRENT_TIMESTAMP WHERE id=?', [sourceId]);
  const legacyPreview = await until('preview');
  assert.equal(Number(legacyPreview.report.errors), 1);
  await assert.rejects(() => call('POST', `/${sourceId}/actions`, {action: 'start', revision: legacyPreview.revision, accept_warnings: true}));
  await rows('DELETE FROM work_import_items WHERE project_id=? AND external_key=? AND task_id=?', [project.id, keyA, existingTask.id]);
  let result = await transfer();
  assert.equal(result.report.ready, true);
  assert.equal(Number(result.report.done), 2);
  assert.equal(Number(result.report.files_missing), 0);
  assert.equal(JSON.stringify(result).includes('disposable-jira-token'), false);
  const [itemA, itemB] = await rows('SELECT * FROM jira_transfer_items WHERE source_id=? ORDER BY id', [sourceId]);
  assert.ok(await one('SELECT * FROM task_dependencies WHERE task_id=? AND depends_on_task_id=?', [itemB.task_id, itemA.task_id]));
  assert.ok(await one("SELECT * FROM task_revisions WHERE task_id=? AND changes_json LIKE '%jira_links%'", [itemB.task_id]));
  remoteTitle = 'Обновлено в Jira';
  result = await transfer();
  assert.equal((await one('SELECT title FROM tasks WHERE id=?', [itemA.task_id])).title, remoteTitle);
  assert.equal((await one('SELECT COUNT(*) AS total FROM jira_transfer_items WHERE source_id=?', [sourceId])).total, 2);
  assert.equal((await one('SELECT COUNT(*) AS total FROM task_attachments WHERE task_id=?', [itemA.task_id])).total, 1);
  assert.equal((await one('SELECT COUNT(*) AS total FROM jira_task_history WHERE task_id=?', [itemA.task_id])).total, 1);
  await rows("UPDATE tasks SET title='Изменено сотрудником',version_number=version_number+1 WHERE id=?", [itemA.task_id]);
  remoteTitle = 'Новое изменение Jira';
  result = await transfer();
  assert.equal(Number(result.report.conflicts), 1);
  await assert.rejects(() => call('POST', `/${sourceId}/actions`, {action: 'cutover', revision: result.revision, confirmation: projectKey, accept_warnings: true}));
  await call('POST', `/${sourceId}/actions`, {action: 'resolve', revision: result.revision, item_id: itemA.id, choice: 'local'});
  result = await until('completed');
  assert.equal((await one('SELECT title FROM tasks WHERE id=?', [itemA.task_id])).title, 'Изменено сотрудником');
  assert.equal(result.report.ready, true);
  await call('POST', `/${sourceId}/actions`, {action: 'cutover', revision: result.revision, confirmation: projectKey, accept_warnings: true});
  result = await call('GET', `/${sourceId}`);
  assert.equal(result.status, 'cutover');
  await assert.rejects(() => call('POST', `/${sourceId}/actions`, {action: 'prepare', revision: result.revision}));
  await rows("UPDATE users SET status='blocked' WHERE id=?", [user.id]);
  await assert.rejects(() => call('GET', `/${sourceId}`));
  console.log('MySQL/S3: страницы Jira, пауза, повтор после лимита, защита версий и прежнего импорта, обновление, история, файлы, связи, конфликт, переключение и отзыв доступа проверены.');
} finally {await db.end();}
