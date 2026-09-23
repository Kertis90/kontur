import {z} from 'zod';
import {transaction} from './db.js';
import {body, reply, WorkError} from './work-common.js';
import {audit} from './audit.js';

// Сохраняет название организации только для интерактивного владельца или администратора.
export async function onboardingApi(request, user) {
  if (request.method !== 'PUT') throw new WorkError(405, 'Доступно только сохранение названия');
  if (user.api_token_id || user.is_service || !['owner', 'admin'].includes(user.global_role)) throw new WorkError(403, 'Название организации меняет владелец или администратор');
  const draft = z.object({name: z.string().trim().min(2).max(120), previous_name: z.string().max(120)}).strict().parse(await body(request));
  await transaction(async connection => {
    const [[workspace]] = await connection.query('SELECT name FROM workspaces WHERE id=? FOR UPDATE', [user.workspace_id]);
    if (!workspace || workspace.name !== draft.previous_name) throw new WorkError(409, 'Название уже изменилось. Обновите страницу.');
    await connection.query('UPDATE workspaces SET name=? WHERE id=?', [draft.name, user.workspace_id]);
  });
  await audit(user, 'workspace.renamed', 'workspace', user.workspace_id);
  return reply({name: draft.name});
}
