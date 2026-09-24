import {z} from 'zod';
import {positiveId,dateOnly,WorkError} from './work-common.js';
const dates={start_date:dateOnly.nullable().default(null),due_date:dateOnly.nullable().default(null)};
const fields={title:z.string().trim().min(2).max(180),description:z.string().max(10000).default(''),...dates,objective_id:positiveId.nullable().default(null),archived:z.boolean().default(false)};
// Новый план создаётся открытым; архивирование доступно отдельным изменением с проверкой версии.
export const planCreateSchema=z.object({...fields,archived:z.literal(false).default(false),project_id:positiveId.nullable().default(null),request_id:z.string().uuid()}).strict();
export const planUpdateSchema=z.object({...fields,revision:positiveId}).strict();
const itemFields={kind:z.enum(['epic','task']),parent_id:positiveId.nullable().default(null),title:z.string().trim().min(2).max(300),description:z.string().max(10000).default(''),priority:z.enum(['critical','high','medium','low']).default('medium'),assignee_id:positiveId.nullable().default(null),...dates,estimate_minutes:z.number().int().min(0).max(10000000).nullable().default(null),story_points:z.number().min(0).max(1000000).nullable().default(null),objective_id:positiveId.nullable().default(null),state:z.enum(['planning','cancelled']).default('planning')};
export const planItemCreateSchema=z.object({...itemFields,request_id:z.string().uuid()}).strict();
export const planItemUpdateSchema=z.object({...itemFields,revision:positiveId}).strict();
// Проверяет период и единственный допустимый уровень вложенности: эпик → задача.
export function checkPlanDates(data){if(data.start_date&&data.due_date&&data.start_date>data.due_date)throw new WorkError(422,'Срок должен быть не раньше начала');if(data.kind==='epic'&&data.parent_id)throw new WorkError(422,'Эпик не может быть вложен в другой эпик');}
// Защищает запись от перезаписи устаревшим редактором.
export function checkPlanRevision(current,revision){if(Number(current.revision)!==Number(revision))throw new WorkError(409,'План уже изменён. Обновите данные перед сохранением');}
