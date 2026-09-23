import {z} from 'zod';
import {one, rows, transaction, parseJson} from './db.js';
import {body, reply, WorkError, positiveId, workspaceFor} from './work-common.js';
import {audit} from './audit.js';
import {encryptSecret} from './crypto.js';
import {integrationUrl} from './integration-http.js';
import {transferAccess, transferDecode, publicTransfer, transferReport} from './jira-transfer-access.js';
import {transferDraft} from './jira-transfer-model.js';

const choices = z.record(z.string().min(1).max(150), positiveId).refine(value => Object.keys(value).length <= 1000);
const mapping = z.object({stages: choices.default({}), users: choices.default({}), types: choices.default({}), fields: z.record(z.string().max(150), z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,79}$/)).default({}), epic_field: z.string().regex(/^customfield_\d+$/).optional(), points_field: z.string().regex(/^customfield_\d+$/).optional()}).strict();
const settings = z.object({name: z.string().trim().min(2).max(160), project_id: positiveId, kind: z.enum(['data_center', 'cloud']).default('data_center'), url: z.string().url().max(1000), project_key: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,49}$/), include_files: z.boolean().default(true), mapping: mapping.default({}), credentials: z.object({token: z.string().trim().min(1).max(2000).regex(/^[^\r\n]+$/), username: z.string().email().optional()}).strict().optional(), revision: z.number().int().positive().optional()}).strict();

// Обрабатывает настройки и управляемые этапы существующего раздела импорта Jira.
export async function jiraTransferApi(request, path, user) {
  if (user.api_token_id) throw new WorkError(403, 'Подключение Jira настраивается после входа в приложение');
  await workspaceFor(user, 'import.manage');
  const id = path[2] ? positiveId.parse(path[2]) : null;
  if (!id && request.method === 'GET') {
    const all = await rows('SELECT * FROM jira_transfer_sources WHERE workspace_id=? ORDER BY id DESC LIMIT 100', [user.workspace_id]), visible = [];
    for (const source of all) {try {await transferAccess(user, source.project_id);visible.push(publicTransfer(source));} catch (error) {if (![403, 404].includes(error.status)) throw error;} }
    return reply(visible);
  }
  if (!id && request.method === 'POST') {
    const draft = settings.parse(await body(request));
    await transferAccess(user, draft.project_id, true);
    const url = integrationUrl(draft.url);
    if (url.search || !draft.credentials || (draft.kind === 'cloud' && !draft.credentials.username)) throw new WorkError(422, 'Проверьте адрес и реквизиты подключения');
    const sourceId = await transaction(async connection => {
      await connection.query('SELECT id FROM workspaces WHERE id=? FOR UPDATE', [user.workspace_id]);
      const [[count]] = await connection.query('SELECT COUNT(*) AS total FROM jira_transfer_sources WHERE workspace_id=?', [user.workspace_id]);
      if (count.total >= 100) throw new WorkError(409, 'Доступно не более 100 подключений Jira');
      const canonical = url.href.replace(/\/$/, '');
      const [[duplicate]] = await connection.query('SELECT id FROM jira_transfer_sources WHERE workspace_id=? AND url=? AND project_key=? AND project_id=?', [user.workspace_id, canonical, draft.project_key, draft.project_id]);
      if (duplicate) throw new WorkError(409, 'Этот проект Jira уже подключён; используйте повторный перенос');
      const [result] = await connection.query('INSERT INTO jira_transfer_sources(workspace_id,project_id,user_id,name,kind,url,project_key,credentials_encrypted,mapping_json,include_files) VALUES(?,?,?,?,?,?,?,?,?,?)', [user.workspace_id, draft.project_id, user.id, draft.name, draft.kind, canonical, draft.project_key, encryptSecret(JSON.stringify(draft.credentials)), JSON.stringify(draft.mapping), draft.include_files]);
      return result.insertId;
    });
    await audit(user, 'jira.source.created', 'jira_transfer', sourceId);
    return reply({id: sourceId}, 201);
  }
  const source = await one('SELECT * FROM jira_transfer_sources WHERE id=? AND workspace_id=?', [id, user.workspace_id]);
  if (!source) throw new WorkError(404, 'Подключение не найдено');
  await transferAccess(user, source.project_id, request.method !== 'GET');
  if (request.method === 'GET' && !path[3]) {
    const after = z.coerce.number().int().nonnegative().parse(new URL(request.url).searchParams.get('after') || 0);
    const records = await rows('SELECT id,issue_id,issue_key,task_id,status,warnings_json,error_code,files_expected,files_done,links_pending FROM jira_transfer_items WHERE source_id=? AND seen_run=? AND id>? ORDER BY id LIMIT 100', [id, source.run_number, after]);
    return reply({...publicTransfer(source), report: await transferReport(source), records: records.map(row => ({...row, warnings: parseJson(row.warnings_json, []), warnings_json: undefined})), next: records.length === 100 ? records.at(-1).id : null});
  }
  if (request.method === 'GET' && path[3] === 'items' && path[4]) {
    const item = await one('SELECT * FROM jira_transfer_items WHERE id=? AND source_id=?', [positiveId.parse(path[4]), id]);
    if (!item?.payload_encrypted) throw new WorkError(404, 'Подготовленная задача не найдена');
    const draft = transferDraft(transferDecode(item.payload_encrypted), parseJson(source.mapping_json, {}));
    const task = !draft.restricted && item.task_id ? await one('SELECT * FROM tasks WHERE id=? AND project_id=?', [item.task_id, source.project_id]) : null;
    const local = task ? Object.fromEntries(Object.keys(draft.task).map(key => [key, key === 'custom_values' ? parseJson(task.custom_values_json, {}) : task[key] ?? null])) : null;
    return reply({id: item.id, key: item.issue_key, task: draft.restricted ? null : draft.task, local, warnings: draft.warnings, errors: draft.errors});
  }
  if (request.method === 'PUT' && !path[3]) {
    const draft = settings.parse(await body(request));
    if (draft.project_id !== Number(source.project_id) || draft.kind !== source.kind || draft.url.replace(/\/$/, '') !== source.url || draft.project_key !== source.project_key) throw new WorkError(409, 'Исходный сервер и проекты переноса менять нельзя');
    await transaction(async connection => {
      const [[current]] = await connection.query('SELECT * FROM jira_transfer_sources WHERE id=? FOR UPDATE', [id]);
      if (current.revision !== draft.revision || ['preparing', 'running', 'cutover'].includes(current.status)) throw new WorkError(409, 'Остановите перенос и обновите настройки');
      await connection.query("UPDATE jira_transfer_sources SET name=?,mapping_json=?,include_files=?,credentials_encrypted=?,user_id=?,status='draft',revision=revision+1 WHERE id=?", [draft.name, JSON.stringify(draft.mapping), draft.include_files, draft.credentials ? encryptSecret(JSON.stringify(draft.credentials)) : current.credentials_encrypted, user.id, id]);
    });
    await audit(user, 'jira.source.updated', 'jira_transfer', id);
    return reply({ok: true});
  }
  if (request.method === 'POST' && path[3] === 'actions') {
    const input = z.object({revision: z.number().int().positive(), action: z.enum(['prepare', 'start', 'pause', 'resume', 'relink', 'cutover', 'resolve']), item_id: positiveId.optional(), choice: z.enum(['local', 'jira']).optional(), accept_warnings: z.boolean().default(false), confirmation: z.string().max(50).optional()}).strict().parse(await body(request));
    await transaction(async connection => {
      const [[current]] = await connection.query('SELECT * FROM jira_transfer_sources WHERE id=? FOR UPDATE', [id]);
      if (current.revision !== input.revision || current.status === 'cutover') throw new WorkError(409, 'Перенос изменился или проект уже переключён');
      let status = current.status, phase = current.phase;
      if (input.action === 'prepare') {
        if (['preparing', 'running'].includes(status)) throw new WorkError(409, 'Сначала остановите текущий перенос');
        await connection.query("UPDATE jira_transfer_sources SET run_number=run_number+1,cursor_value=NULL,catalog_json=NULL,prepared_at=NULL,completed_at=NULL WHERE id=?", [id]);
        status = 'preparing'; phase = 'listing';
      } else if (input.action === 'start') {
        if (status !== 'preview') throw new WorkError(409, 'Сначала подготовьте и проверьте перенос');
        const report = await transferReport(current);
        if (!report.total || Number(report.errors)) throw new WorkError(409, 'Исправьте ошибки сопоставления и повторите подготовку');
        if ((Number(report.warnings) || Number(report.missing)) && !input.accept_warnings) throw new WorkError(409, 'Подтвердите ознакомление с предупреждениями сверки');
        status = 'running'; phase = 'tasks';
      } else if (input.action === 'pause') {
        if (!['running', 'preparing'].includes(status)) throw new WorkError(409, 'Перенос уже остановлен');
        status = 'paused';
      } else if (input.action === 'resume') {
        if (!['paused', 'failed'].includes(status)) throw new WorkError(409, 'Продолжать можно только остановленный перенос');
        status = ['listing', 'details'].includes(phase) ? 'preparing' : 'running';
      } else if (input.action === 'relink') {
        if (status !== 'completed') throw new WorkError(409, 'Дождитесь окончания задач');
        status = 'running'; phase = 'links';
        await connection.query('UPDATE jira_transfer_sources SET cursor_value=NULL WHERE id=?', [id]);
      } else if (input.action === 'resolve') {
        if (status !== 'completed' || !input.item_id || !input.choice) throw new WorkError(409, 'Выберите конфликт после завершения прохода');
        const [[item]] = await connection.query('SELECT i.*,t.version_number FROM jira_transfer_items i LEFT JOIN tasks t ON t.id=i.task_id AND t.project_id=? WHERE i.id=? AND i.source_id=? FOR UPDATE', [current.project_id, input.item_id, id]);
        if (item?.status !== 'conflict' || !item.version_number) throw new WorkError(409, 'Задача конфликта недоступна; восстановите её перед повтором');
        await connection.query("UPDATE jira_transfer_items SET status='pending',choice=?,choice_version=? WHERE id=?", [input.choice, item.version_number, item.id]);
        status = 'running'; phase = 'tasks';
      } else if (input.action === 'cutover') {
        const report = await transferReport(current);
        if (!report.ready || input.confirmation !== current.project_key || ((Number(report.warnings) || Number(report.missing)) && !input.accept_warnings)) throw new WorkError(409, 'Завершите сверку и подтвердите ключ проекта и предупреждения');
        await connection.query('UPDATE jira_transfer_sources SET cutover_at=CURRENT_TIMESTAMP WHERE id=?', [id]);
        status = 'cutover'; phase = 'finished';
      }
      await connection.query('UPDATE jira_transfer_sources SET status=?,phase=?,user_id=?,revision=revision+1,lease_token=NULL,lease_until=NULL,attempts=0,error_code=NULL,available_at=CURRENT_TIMESTAMP WHERE id=?', [status, phase, user.id, id]);
    });
    await audit(user, `jira.transfer.${input.action}`, 'jira_transfer', id, {item_id: input.item_id, choice: input.choice, accepted_warnings: input.accept_warnings});
    return reply({ok: true});
  }
  throw new WorkError(404, 'Действие переноса не найдено');
}
