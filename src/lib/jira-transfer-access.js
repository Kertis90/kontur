import {one, rows, parseJson} from './db.js';
import {projectFor, workspaceFor, WorkError, validUsers, dateOnly} from './work-common.js';
import {fieldAccess} from './work-access.js';
import {decryptSecret} from './crypto.js';

// Проверяет действующего сотрудника и права управления переносом в выбранный проект.
export async function transferAccess(user, projectId, write = false) {
  const actor = await one("SELECT * FROM users WHERE id=? AND workspace_id=? AND status='active'", [user.id, user.workspace_id]);
  if (!actor || actor.is_service || user.api_token_id) throw new WorkError(403, 'Перенос Jira доступен сотруднику через вход в приложение');
  await workspaceFor(actor, 'import.manage');
  await projectFor(actor, projectId, 'project.admin', write);
  if ((await fieldAccess(actor, projectId)).some(field => !field.can_read || (write && !field.can_edit))) throw new WorkError(403, 'Для сверки переноса нужен доступ ко всем полям проекта');
  return actor;
}

// Расшифровывает снимок и явно останавливает обработку при недоступном ключе.
export function transferDecode(value) {
  try { return JSON.parse(decryptSecret(value)); } catch { throw new WorkError(409, 'Не удалось прочитать защищённые данные переноса'); }
}

// Проверяет значения дополнительных полей по текущим определениям и сотрудникам проекта.
export async function validateTransferFields(user, projectId, values) {
  const definitions = await rows('SELECT * FROM task_field_definitions WHERE workspace_id=? AND active=TRUE', [user.workspace_id]);
  for (const field of definitions) if (field.required && !Object.hasOwn(values || {}, field.code)) throw new WorkError(422, `Сопоставьте обязательное поле «${field.label}»`);
  for (const [key, value] of Object.entries(values || {})) {
    const field = definitions.find(entry => entry.code === key);
    if (!field) throw new WorkError(422, `Дополнительное поле «${key}» не найдено`);
    if (value == null || value === '') { if (field.required) throw new WorkError(422, `Заполните поле «${field.label}»`); continue; }
    const options = parseJson(field.options_json, []).map(option => typeof option === 'object' ? option.value ?? option.label : option);
    let valid = true;
    if (field.field_type === 'text') valid = typeof value === 'string' && value.length <= 10000;
    if (field.field_type === 'number') valid = typeof value === 'number' && Number.isFinite(value);
    if (field.field_type === 'boolean') valid = typeof value === 'boolean';
    if (field.field_type === 'date') valid = dateOnly.safeParse(value).success;
    if (field.field_type === 'select') valid = options.includes(value);
    if (field.field_type === 'multiselect') valid = Array.isArray(value) && value.every(item => options.includes(item));
    if (field.field_type === 'url') { try {valid = ['https:', 'http:'].includes(new URL(value).protocol);} catch {valid = false;} }
    if (field.field_type === 'user') {valid = Number.isSafeInteger(value) && value > 0; if (valid) await validUsers(user, [value], projectId);}
    if (!valid) throw new WorkError(422, `Значение поля «${field.label}» не подходит его типу`);
  }
}

// Возвращает только безопасные настройки подключения без сохранённых реквизитов и аренды обработчика.
export function publicTransfer(source) {
  const {credentials_encrypted, lease_token, lease_until, mapping_json, catalog_json, ...safe} = source;
  return {...safe, include_files: Boolean(source.include_files), mapping: parseJson(mapping_json, {}), catalog: parseJson(catalog_json, {})};
}

// Подсчитывает результаты всего переноса без загрузки исходных текстов в память.
export async function transferReport(source) {
  const result = await one(`SELECT COUNT(*) AS total,
    COALESCE(SUM(status='done'),0) AS done, COALESCE(SUM(status='excluded'),0) AS excluded,
    COALESCE(SUM(status='conflict'),0) AS conflicts, COALESCE(SUM(status='error'),0) AS errors,
    COALESCE(SUM(status IN ('pending','fetch')),0) AS pending,
    COALESCE(SUM(GREATEST(files_expected-files_done,0)),0) AS files_missing,
    COALESCE(SUM(links_pending),0) AS links_pending,
    COALESCE(SUM(JSON_LENGTH(warnings_json)),0) AS warnings
    FROM jira_transfer_items WHERE source_id=? AND seen_run=?`, [source.id, source.run_number]);
  const missing = await one('SELECT COUNT(*) AS total FROM jira_transfer_items WHERE source_id=? AND seen_run<>?', [source.id, source.run_number]);
  const ready = source.status === 'completed' && result.total > 0 && !Number(result.conflicts) && !Number(result.errors) && !Number(result.pending) && !Number(result.files_missing) && !Number(result.links_pending);
  return {...result, missing: missing.total, ready};
}
