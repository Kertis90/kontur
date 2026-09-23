import {randomUUID, createHash} from 'node:crypto';
import {one, rows, transaction, parseJson} from './db.js';
import {projectFor, WorkError} from './work-common.js';
import {encryptSecret} from './crypto.js';
import {transferAccess, transferDecode, validateTransferFields} from './jira-transfer-access.js';
import {transferDraft, transferDecision} from './jira-transfer-model.js';
import {jiraPage, jiraIssue, jiraFile} from './jira-transfer-client.js';
import {createWorkTask, changeTask, taskChangeSchema} from './work-tasks.js';
import {storage, bucket, safeFileName} from './storage.js';
import {transferLinks} from './jira-transfer-links.js';

// Проверяет аренду и актуальные права перед сетевой операцией, продлевая время обработки.
async function liveActor(source) {
  const current = await one('SELECT * FROM jira_transfer_sources WHERE id=? AND lease_token=?', [source.id, source.lease_token]);
  if (!current || !['preparing', 'running'].includes(current.status)) throw Object.assign(new Error('JIRA_STOPPED'), {code: 'JIRA_STOPPED'});
  const actor = await transferAccess({id: current.user_id, workspace_id: current.workspace_id}, current.project_id, true);
  await rows('UPDATE jira_transfer_sources SET lease_until=DATE_ADD(CURRENT_TIMESTAMP,INTERVAL 5 MINUTE) WHERE id=? AND lease_token=?', [source.id, source.lease_token]);
  return actor;
}

// Блокирует подключение в транзакции и не позволяет старому обработчику писать после остановки.
async function lockedSource(connection, source) {
  const [[current]] = await connection.query('SELECT * FROM jira_transfer_sources WHERE id=? FOR UPDATE', [source.id]);
  if (!current || current.lease_token !== source.lease_token || current.run_number !== source.run_number || !['preparing', 'running'].includes(current.status)) throw Object.assign(new Error('JIRA_STOPPED'), {code: 'JIRA_STOPPED'});
  return current;
}

// Сохраняет справочник встреченных значений для понятного сопоставления в интерфейсе.
function mergeCatalog(catalog, issue) {
  const result = {stages: {}, users: {}, types: {}, fields: {}, ...catalog}, fields = issue.fields || {};
  if (fields.status?.id) result.stages[fields.status.id] = fields.status.name || fields.status.id;
  const person = fields.assignee, key = person?.accountId || person?.key || person?.name;
  if (key) result.users[key] = person.displayName || key;
  if (fields.issuetype?.id) result.types[fields.issuetype.id] = fields.issuetype.name || fields.issuetype.id;
  for (const field of Object.keys(fields)) if (field.startsWith('customfield_') && fields[field] != null) result.fields[field] = issue.names?.[field] || field;
  for (const part of Object.keys(result)) if (Object.keys(result[part]).length > 1000) throw new WorkError(422, 'В одном подключении допускается не более 1000 значений каждого справочника');
  return result;
}

// Запоминает страницу идентификаторов и продолжает подготовку после перезапуска.
async function listPage(source, credentials) {
  const page = await jiraPage(source, credentials, source.cursor_value || 0, () => liveActor(source));
  await transaction(async connection => {
    await lockedSource(connection, source);
    for (const issue of page.issues) {
      if (!/^\d{1,100}$/.test(String(issue.id)) || !issue.key || issue.key.length > 255) throw new WorkError(422, 'Jira вернула неверный идентификатор задачи');
      await connection.query("INSERT INTO jira_transfer_items(source_id,issue_id,issue_key,seen_run,warnings_json) VALUES(?,?,?,?,JSON_ARRAY()) ON DUPLICATE KEY UPDATE issue_key=VALUES(issue_key),seen_run=VALUES(seen_run),status='fetch',choice=NULL,choice_version=NULL,error_code=NULL,files_expected=0,files_done=0,links_pending=0", [source.id, String(issue.id), issue.key, source.run_number]);
    }
    await connection.query('UPDATE jira_transfer_sources SET cursor_value=?,phase=? WHERE id=?', [page.next == null ? null : String(page.next), page.next == null ? 'details' : 'listing', source.id]);
  });
}

// Подготавливает одну задачу и сохраняет исходник зашифрованным для предварительной проверки.
async function prepareItem(source, credentials) {
  const item = await one("SELECT * FROM jira_transfer_items WHERE source_id=? AND seen_run=? AND status='fetch' ORDER BY id LIMIT 1", [source.id, source.run_number]);
  if (!item) {
    await rows("UPDATE jira_transfer_sources SET status='preview',prepared_at=CURRENT_TIMESTAMP,cursor_value=NULL WHERE id=? AND lease_token=?", [source.id, source.lease_token]);
    return;
  }
  const issue = await jiraIssue(source, credentials, item.issue_id, () => liveActor(source));
  const draft = transferDraft(issue, parseJson(source.mapping_json, {}));
  const actor = await liveActor(source);
  let errors = draft.errors;
  if (!item.task_id && await one('SELECT task_id FROM work_import_items WHERE project_id=? AND external_key=?', [source.project_id, item.issue_key])) errors = [...errors, 'Задача уже перенесена из файла. Для прямого подключения выберите проект без прежнего импорта.'];
  try {taskChangeSchema.parse(draft.task);await validateTransferFields(actor, source.project_id, draft.task.custom_values);} catch (error) {errors = [...errors, error instanceof WorkError ? error.message : 'Проверьте формат значений и соответствия полей'];}
  if (!source.include_files && draft.files.length) draft.warnings.push('Перенос файлов отключён для этого подключения');
  const status = draft.restricted ? (item.task_id ? 'error' : 'excluded') : errors.length ? 'error' : 'pending';
  await transaction(async connection => {
    const current = await lockedSource(connection, source);
    const catalog = draft.restricted ? parseJson(current.catalog_json, {}) : mergeCatalog(parseJson(current.catalog_json, {}), issue);
    await connection.query('UPDATE jira_transfer_items SET payload_encrypted=?,status=?,warnings_json=?,error_code=?,files_expected=? WHERE id=?', [encryptSecret(JSON.stringify(issue)), status, JSON.stringify([...draft.warnings, ...errors]), draft.restricted && item.task_id ? 'JIRA_ACCESS_CHANGED' : errors.length ? 'JIRA_MAPPING' : null, source.include_files && !draft.restricted ? draft.files.length : 0, item.id]);
    await connection.query('UPDATE jira_transfer_sources SET catalog_json=? WHERE id=?', [JSON.stringify(catalog), source.id]);
  });
}

// Выбирает из текущей задачи только поля, участвующие в переносе, для трёхстороннего сравнения.
function localSnapshot(task, remote) {
  if (!task) return null;
  return Object.fromEntries(Object.keys(remote).map(key => [key, key === 'custom_values' ? Object.fromEntries(Object.keys(remote.custom_values).map(field => [field, parseJson(task.custom_values_json, {})[field] ?? null])) : task[key] ?? null]));
}

// Прикрепляет файл единожды и проверяет права непосредственно перед записью в хранилище и БД.
async function attachFile(source, item, credentials, file) {
  if (await one('SELECT file_id FROM jira_transfer_files WHERE item_id=? AND file_id=?', [item.id, file.external_id])) return;
  const actor = await liveActor(source);
  await projectFor(actor, source.project_id, 'attachment.manage', true);
  const bytes = await jiraFile(source, credentials, file, async () => {const user = await liveActor(source);await projectFor(user, source.project_id, 'attachment.manage', true);});
  const checksum = createHash('sha256').update(bytes).digest('hex');
  const object = `workspaces/${source.workspace_id}/projects/${source.project_id}/jira/${source.id}/${item.id}/${createHash('sha256').update(file.external_id).digest('hex')}`;
  await liveActor(source);
  await storage().putObject(bucket(), object, bytes, bytes.length, {'Content-Type': file.mime_type});
  await transaction(async connection => {
    await lockedSource(connection, source);
    const [[task]] = await connection.query('SELECT id FROM tasks WHERE id=? AND project_id=? FOR UPDATE', [item.task_id, source.project_id]);
    if (!task) throw new WorkError(409, 'Задача перемещена или удалена');
    const [[exists]] = await connection.query('SELECT file_id FROM jira_transfer_files WHERE item_id=? AND file_id=?', [item.id, file.external_id]);
    if (exists) return;
    const [attachment] = await connection.query('INSERT INTO task_attachments(task_id,uploaded_by,file_name,object_key,mime_type,size_bytes,checksum_sha256) VALUES(?,?,?,?,?,?,?)', [item.task_id, actor.id, safeFileName(file.file_name), object, file.mime_type, bytes.length, checksum]);
    await connection.query('INSERT INTO jira_transfer_files(item_id,file_id,attachment_id,checksum_sha256) VALUES(?,?,?,?)', [item.id, file.external_id, attachment.insertId, checksum]);
  });
}

// Создаёт или обновляет одну задачу с контролем локальных изменений и сохранением истории.
async function applyItem(source, credentials) {
  const item = await one("SELECT * FROM jira_transfer_items WHERE source_id=? AND seen_run=? AND status='pending' ORDER BY id LIMIT 1", [source.id, source.run_number]);
  if (!item) {await rows("UPDATE jira_transfer_sources SET phase='links',cursor_value=NULL WHERE id=? AND lease_token=?", [source.id, source.lease_token]);return;}
  const actor = await liveActor(source), draft = transferDraft(transferDecode(item.payload_encrypted), parseJson(source.mapping_json, {}));
  await projectFor(actor, source.project_id, 'task.create', true);
  await projectFor(actor, source.project_id, 'task.edit', true);
  await validateTransferFields(actor, source.project_id, draft.task.custom_values);
  const applied = await transaction(async connection => {
    await lockedSource(connection, source);
    const [[task]] = item.task_id ? await connection.query('SELECT * FROM tasks WHERE id=? AND project_id=? FOR UPDATE', [item.task_id, source.project_id]) : [[]];
    const base = item.baseline_encrypted ? transferDecode(item.baseline_encrypted) : null;
    let decision = transferDecision(base, localSnapshot(task, draft.task), draft.task);
    if (item.choice && task && Number(task.version_number) === Number(item.choice_version)) decision = {action: item.choice === 'jira' ? 'update' : 'keep', patch: item.choice === 'jira' ? draft.task : {}, conflicts: []};
    if (decision.action === 'conflict') {
      await connection.query("UPDATE jira_transfer_items SET status='conflict',warnings_json=?,choice=NULL,choice_version=NULL WHERE id=?", [JSON.stringify([...draft.warnings, `Одновременные изменения: ${decision.conflicts.join(', ')}`]), item.id]);
      return false;
    }
    if (decision.action === 'create') {
      const [[legacy]] = await connection.query('SELECT task_id FROM work_import_items WHERE project_id=? AND external_key=?', [source.project_id, item.issue_key]);
      if (legacy) throw new WorkError(409, 'Эту задачу уже перенесли из файла; повторите сверку');
      item.task_id = (await createWorkTask(actor, source.project_id, draft.task, connection)).task_id;
    }
    if (decision.action === 'update') await changeTask(actor, item.task_id, decision.patch, connection, {version: task.version_number});
    for (const entry of draft.history) await connection.query('INSERT INTO jira_task_history(task_id,source_key,entry_key,kind,source_author,source_date,body_text) VALUES(?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE source_key=VALUES(source_key),source_author=VALUES(source_author),source_date=VALUES(source_date),body_text=VALUES(body_text)', [item.task_id, item.issue_key, entry.entry_key, entry.kind, entry.author, entry.date, entry.body]);
    await connection.query('UPDATE jira_transfer_items SET task_id=?,baseline_encrypted=?,choice=NULL,choice_version=NULL,warnings_json=? WHERE id=?', [item.task_id, encryptSecret(JSON.stringify(draft.task)), JSON.stringify(draft.warnings), item.id]);
    return true;
  });
  if (!applied) return;
  if (source.include_files) for (const file of draft.files) await attachFile(source, item, credentials, file);
  await transaction(async connection => {
    await lockedSource(connection, source);
    const [files] = await connection.query('SELECT file_id FROM jira_transfer_files WHERE item_id=?', [item.id]);
    const present = new Set(files.map(file => file.file_id));
    await connection.query("UPDATE jira_transfer_items SET status='done',files_done=?,error_code=NULL WHERE id=?", [source.include_files ? draft.files.filter(file => present.has(file.external_id)).length : 0, item.id]);
  });
}

// Выполняет ограниченный шаг переноса; аренда и сохранённая позиция позволяют пережить перезапуск.
export async function pollJiraTransfers() {
  const source = await transaction(async connection => {
    const [[source]] = await connection.query("SELECT * FROM jira_transfer_sources WHERE status IN ('preparing','running') AND available_at<=CURRENT_TIMESTAMP AND (lease_until IS NULL OR lease_until<CURRENT_TIMESTAMP) ORDER BY updated_at,id LIMIT 1 FOR UPDATE SKIP LOCKED");
    if (!source) return null;
    source.lease_token = randomUUID();
    await connection.query('UPDATE jira_transfer_sources SET lease_token=?,lease_until=DATE_ADD(CURRENT_TIMESTAMP,INTERVAL 5 MINUTE) WHERE id=?', [source.lease_token, source.id]);
    return source;
  });
  if (!source) return;
  try {
    const actor = await liveActor(source), credentials = transferDecode(source.credentials_encrypted);
    if (source.phase === 'listing') await listPage(source, credentials);
    else if (source.phase === 'details') await prepareItem(source, credentials);
    else if (source.phase === 'tasks') await applyItem(source, credentials);
    else if (source.phase === 'links') await transferLinks(source, actor, lockedSource);
    await rows('UPDATE jira_transfer_sources SET lease_token=NULL,lease_until=NULL,revision=revision+1,attempts=0,error_code=NULL WHERE id=? AND lease_token=?', [source.id, source.lease_token]);
  } catch (error) {
    if (error.code === 'JIRA_STOPPED') return;
    const code = /^[A-Z][A-Z0-9_]{1,80}$/.test(error.code || '') ? error.code : error.status === 403 ? 'ACCESS_REVOKED' : error.status === 422 || error.name === 'ZodError' ? 'JIRA_MAPPING' : 'JIRA_TRANSFER_FAILED';
    const retryable = ['TIMEOUT', 'NETWORK_ERROR', 'JIRA_RATE_LIMIT', 'JIRA_UNAVAILABLE'].includes(code);
    const attempts = Number(source.attempts) + 1, delay = Math.min(86400, Math.max(5, error.retryAfter || 5 * 2 ** Math.min(attempts, 10)));
    await rows('UPDATE jira_transfer_sources SET status=?,attempts=?,error_code=?,available_at=DATE_ADD(CURRENT_TIMESTAMP,INTERVAL ? SECOND),lease_token=NULL,lease_until=NULL,revision=revision+1 WHERE id=? AND lease_token=?', [retryable && attempts < 5 ? source.status : 'failed', attempts, code, delay, source.id, source.lease_token]);
  }
}
