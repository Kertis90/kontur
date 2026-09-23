import {jiraText} from './work-import.js';
import {jiraExtras} from './jira-import-model.js';

// Приводит значения к стабильному виду для сравнения снимков без зависимости от порядка ключей.
export function transferValue(value) {
  if (Array.isArray(value)) return value.map(transferValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, transferValue(value[key])]));
  return value ?? null;
}

// Сравнивает значения Jira и Контура, включая дополнительные поля.
function same(a, b) {
  return JSON.stringify(transferValue(a)) === JSON.stringify(transferValue(b));
}

// Подготавливает исходную задачу для существующих механизмов задач, истории и файлов.
export function transferDraft(issue, mapping = {}) {
  const fields = issue.fields || {}, errors = [], warnings = [];
  const stage = mapping.stages?.[fields.status?.id] || mapping.stages?.[fields.status?.name];
  if (!stage) errors.push(`Сопоставьте этап «${fields.status?.name || fields.status?.id || 'не указан'}»`);
  if (!issue.id || !issue.key || !fields.summary?.trim()) errors.push('Нет идентификатора, ключа или названия задачи Jira');
  const person = fields.assignee, userKey = person?.accountId || person?.key || person?.name;
  const assignee = mapping.users?.[userKey] || null;
  if (person && !assignee) warnings.push(`Исполнитель «${person.displayName || userKey}» не сопоставлен`);
  const type = mapping.types?.[fields.issuetype?.id] || null;
  if (fields.issuetype && !type) warnings.push(`Тип «${fields.issuetype.name || fields.issuetype.id}» не сопоставлен`);
  const comments = fields.comment?.comments || [];
  // Комментарии Jira Service Management с явной отметкой внутреннего доступа также исключаются.
  const publicComments = comments.filter(comment => !comment.visibility && comment.jsdPublic !== false);
  if (publicComments.length !== comments.length) warnings.push('Комментарии с ограниченным доступом исключены');
  const extra = jiraExtras({...issue, fields: {...fields, comment: {...fields.comment, comments: publicComments}}});
  warnings.push(...extra.warnings);
  const priority = {highest: 'critical', critical: 'critical', high: 'high', medium: 'medium', low: 'low', lowest: 'low', 'критический': 'critical', 'высокий': 'high', 'средний': 'medium', 'низкий': 'low'};
  const priorityName = String(fields.priority?.name || 'medium').toLowerCase();
  if (!priority[priorityName]) warnings.push(`Приоритет «${fields.priority.name}» заменён на средний; проверьте его после переноса`);
  const task = {title: String(fields.summary || ''), description: jiraText(fields.description || ''), stage_id: stage, priority: priority[priorityName] || 'medium', assignee_id: assignee, due_date: fields.duedate || null, issue_type_id: type, custom_values: {}};
  for (const [source, target] of Object.entries(mapping.fields || {})) {
    const value = fields[source];
    task.custom_values[target] = Array.isArray(value) ? value.map(item => item?.value ?? item?.name ?? item) : value?.value ?? value?.name ?? value ?? null;
  }
  for (const key of Object.keys(fields)) if (key.startsWith('customfield_') && fields[key] != null && !mapping.fields?.[key] && key !== mapping.epic_field && key !== mapping.points_field) warnings.push(`Дополнительное поле «${issue.names?.[key] || key}» не сопоставлено`);
  if (mapping.points_field) task.story_points = fields[mapping.points_field] == null ? null : Number(fields[mapping.points_field]);
  if (fields.timeoriginalestimate != null) task.estimate_minutes = Math.ceil(Number(fields.timeoriginalestimate) / 60);
  for (const [key, label] of [['components', 'Компоненты'], ['fixVersions', 'Версии'], ['worklog', 'Трудозатраты'], ['labels', 'Метки']]) {
    const value = fields[key];
    if (Array.isArray(value) ? value.length : value?.total > 0) warnings.push(`${label}: требуется отдельное сопоставление; исходные данные сохранены в подготовленном переносе`);
  }
  if (fields.security) warnings.push('Задача с ограниченным доступом исключена до отдельного переноса прав');
  const files = extra.attachments.map(file => ({...file, url: (fields.attachment || []).find(item => String(item.id) === file.external_id)?.content}));
  return {task, errors, warnings: [...new Set(warnings)], restricted: Boolean(fields.security), history: extra.history, files, links: extra.links, parent: fields.parent?.id || fields.parent?.key || null, epic: mapping.epic_field ? fields[mapping.epic_field] || null : null};
}

// Выбирает безопасное обновление каждого поля и выделяет одновременные изменения.
export function transferDecision(base, local, remote) {
  if (!local) return {action: base ? 'conflict' : 'create', patch: remote, conflicts: base ? ['Задача удалена или перемещена'] : []};
  if (!base) return {action: 'conflict', patch: {}, conflicts: ['Нет предыдущего снимка']};
  const patch = {}, conflicts = [];
  for (const key of Object.keys(remote)) {
    if (key === 'custom_values') {
      const values = {};
      for (const field of Object.keys(remote.custom_values || {})) {
        const before = base.custom_values?.[field], now = local.custom_values?.[field], next = remote.custom_values[field];
        if (same(before, next) || same(now, next)) continue;
        if (!same(before, now)) conflicts.push(`custom.${field}`); else values[field] = next;
      }
      if (Object.keys(values).length) patch.custom_values = values;
    } else if (!same(base[key], remote[key]) && !same(local[key], remote[key])) {
      if (!same(base[key], local[key])) conflicts.push(key); else patch[key] = remote[key];
    }
  }
  return {action: conflicts.length ? 'conflict' : Object.keys(patch).length ? 'update' : same(local, remote) ? 'unchanged' : 'keep', patch, conflicts};
}

// Проверяет полноту переноса перед окончательным переключением проекта.
export function transferReady(records) {
  const counts = {total: records.length, done: 0, conflicts: 0, errors: 0, pending: 0, files_missing: 0, links_pending: 0, warnings: 0};
  for (const row of records) {
    if (row.status === 'done' || row.status === 'excluded') counts.done++;
    else if (row.status === 'conflict') counts.conflicts++;
    else if (row.status === 'error') counts.errors++;
    else counts.pending++;
    counts.files_missing += Math.max(0, Number(row.files_expected || 0) - Number(row.files_done || 0));
    counts.links_pending += Number(row.links_pending || 0);
    counts.warnings += row.warnings?.length || 0;
  }
  return {...counts, ready: counts.total > 0 && !counts.conflicts && !counts.errors && !counts.pending && !counts.files_missing && !counts.links_pending};
}
