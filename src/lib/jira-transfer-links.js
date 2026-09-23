import {one, rows, transaction, parseJson} from './db.js';
import {projectFor, WorkError} from './work-common.js';
import {transferDecode} from './jira-transfer-access.js';
import {transferDraft} from './jira-transfer-model.js';
import {jiraLink} from './jira-import-model.js';
import {assertDependencyCycle} from './work-tasks.js';
import {emitEvent} from './events.js';

// Находит перенесённую задачу этого сервера, проверяя текущий доступ к её проекту.
async function targetFor(connection, source, key, actor) {
  const [matches] = await connection.query('SELECT i.task_id,t.project_id FROM jira_transfer_items i JOIN jira_transfer_sources s ON s.id=i.source_id JOIN tasks t ON t.id=i.task_id AND t.project_id=s.project_id WHERE s.workspace_id=? AND s.url=? AND (i.issue_id=? OR i.issue_key=?) AND i.status=\'done\'', [source.workspace_id, source.url, String(key), String(key)]);
  if (matches.length !== 1) return null;
  await projectFor(actor, matches[0].project_id, 'project.browse');
  return matches[0];
}

// Устанавливает родителя или эпик только при отсутствии конфликтующего локального значения и циклов.
async function hierarchy(connection, task, target, column) {
  if (Number(task.id) === Number(target.task_id)) throw new WorkError(409, 'Связь задачи с собой');
  if (task[column] && Number(task[column]) !== Number(target.task_id)) throw new WorkError(409, 'Родитель или эпик изменён в Контуре');
  if (Number(task[column]) === Number(target.task_id)) return false;
  if (Number(task.project_id) !== Number(target.project_id)) throw new WorkError(409, 'Родитель или эпик находится в другом проекте');
  const [parents] = await connection.query(`WITH RECURSIVE parents AS (SELECT id,${column},CAST(id AS CHAR(10000)) AS path FROM tasks WHERE id=? UNION ALL SELECT t.id,t.${column},CONCAT(p.path,',',t.id) FROM tasks t JOIN parents p ON t.id=p.${column} WHERE FIND_IN_SET(t.id,p.path)=0) SELECT id FROM parents WHERE id=?`, [target.task_id, task.id]);
  if (parents.length) throw new WorkError(409, 'Связь создаст цикл');
  await connection.query(`UPDATE tasks SET ${column}=? WHERE id=?`, [target.task_id, task.id]);
  return true;
}

// Достраивает связи после всех пакетов и сохраняет препятствия для итоговой сверки.
export async function transferLinks(source, actor, lockedSource) {
  const item = await one("SELECT * FROM jira_transfer_items WHERE source_id=? AND seen_run=? AND status='done' AND id>? ORDER BY id LIMIT 1", [source.id, source.run_number, Number(source.cursor_value || 0)]);
  if (!item) {await rows("UPDATE jira_transfer_sources SET status='completed',phase='finished',completed_at=CURRENT_TIMESTAMP,cursor_value=NULL WHERE id=? AND lease_token=?", [source.id, source.lease_token]);return;}
  await projectFor(actor, source.project_id, 'task.edit', true);
  const draft = transferDraft(transferDecode(item.payload_encrypted), parseJson(source.mapping_json, {}));
  const warnings = [...draft.warnings];
  let pending = 0;
  await transaction(async connection => {
    await lockedSource(connection, source);
    await connection.query('SELECT id FROM workspaces WHERE id=? FOR UPDATE', [source.workspace_id]);
    const [[task]] = await connection.query('SELECT * FROM tasks WHERE id=? AND project_id=? FOR UPDATE', [item.task_id, source.project_id]);
    if (!task) {await connection.query("UPDATE jira_transfer_items SET status='conflict',warnings_json=? WHERE id=?", [JSON.stringify(['Перенесённая задача удалена или перемещена']), item.id]);return;}
    const changed = new Set();
    const links = [...draft.links.map(link => ({...link, relation: 'dependency'})), ...(draft.parent ? [{key: draft.parent, relation: 'parent_task_id'}] : []), ...(draft.epic ? [{key: draft.epic, relation: 'epic_task_id'}] : [])];
    for (const link of links) {
      try {
        const target = await targetFor(connection, source, link.key, actor);
        if (!target) throw new WorkError(409, 'Целевая задача пока не перенесена или неоднозначна');
        if (link.relation !== 'dependency') {if (await hierarchy(connection, task, target, link.relation)) changed.add(task.id);continue;}
        const edge = jiraLink(item.task_id, target.task_id, link);
        if (!edge) throw new WorkError(409, 'Тип связи не сопоставлен');
        await projectFor(actor, target.project_id, 'task.edit', true);
        if (edge.task_id === edge.depends_on_task_id) throw new WorkError(409, 'Связь с собой');
        const [[existing]] = await connection.query('SELECT dependency_type FROM task_dependencies WHERE task_id=? AND depends_on_task_id=?', [edge.task_id, edge.depends_on_task_id]);
        if (existing) {if (existing.dependency_type !== edge.dependency_type) throw new WorkError(409, 'В Контуре сохранён другой тип связи');continue;}
        if (edge.dependency_type === 'blocks') await assertDependencyCycle(connection, edge.task_id, edge.depends_on_task_id);
        await connection.query('INSERT INTO task_dependencies(task_id,depends_on_task_id,dependency_type) VALUES(?,?,?)', [edge.task_id, edge.depends_on_task_id, edge.dependency_type]);
        changed.add(edge.task_id);
      } catch (error) {if (![403, 409, 422].includes(error.status)) throw error;pending++;warnings.push(`Связь ${link.key}: ${error.status === 403 ? 'нет доступа к целевой задаче' : error.message}`);}
    }
    for (const taskId of changed) {
      await connection.query('UPDATE tasks SET version_number=version_number+1 WHERE id=?', [taskId]);
      const [[current]] = await connection.query('SELECT version_number,project_id,title FROM tasks WHERE id=?', [taskId]);
      await connection.query("INSERT INTO task_revisions(task_id,changed_by,version_number,change_type,changes_json) VALUES(?,?,?,'updated',?)", [taskId, actor.id, current.version_number, JSON.stringify({jira_links: true})]);
      await emitEvent({workspaceId: source.workspace_id, eventType: 'task.updated', aggregateType: 'task', aggregateId: taskId, payload: {task_id: taskId, project_id: current.project_id, title: current.title, changed_fields: ['dependencies']}}, connection);
    }
    await connection.query('UPDATE jira_transfer_items SET links_pending=?,warnings_json=? WHERE id=?', [pending, JSON.stringify(warnings), item.id]);
    await connection.query('UPDATE jira_transfer_sources SET cursor_value=? WHERE id=?', [String(item.id), source.id]);
  });
}
