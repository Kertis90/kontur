import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {rows,one,transaction,parseJson} from './db.js';
import {body,reply,positiveId,WorkError} from './work-common.js';
import {changeTask,taskChangeSchema} from './work-tasks.js';
const column=z.enum(['title','priority','stage_id','assignee_id','due_date','progress']);
const filter=z.object({projectId:positiveId.nullable().optional(),assigneeId:positiveId.nullable().optional(),priority:z.enum(['','critical','high','medium','low']).optional(),stageId:positiveId.nullable().optional(),query:z.string().max(200).optional()});
const columns=z.array(column).min(1).max(6).refine(v=>new Set(v).size===v.length,'Столбцы не должны повторяться');
export const viewConfigSchema=z.object({columns,filter:filter.default({}),pinned:z.array(z.object({id:z.string().uuid(),name:z.string().trim().min(1).max(100),filter,columns})).max(30).default([])});
export async function viewsApi(request,path,user){
 if(path[0]==='views'&&path.length===1){
  if(request.method==='GET'){const item=await one('SELECT * FROM user_work_views WHERE user_id=?',[user.id]);return reply({revision:item?.revision||0,config:parseJson(item?.config_json,{columns:['title','priority','stage_id','assignee_id','due_date'],filter:{},pinned:[]})});}
  if(request.method==='PUT'){const d=z.object({revision:z.number().int().min(0),config:viewConfigSchema}).parse(await body(request));return transaction(async c=>{await c.query('SELECT id FROM users WHERE id=? FOR UPDATE',[user.id]);const [[old]]=await c.query('SELECT revision FROM user_work_views WHERE user_id=?',[user.id]);if(Number(old?.revision||0)!==d.revision)throw new WorkError(409,'Настройки изменены на другом устройстве');await c.query('INSERT INTO user_work_views(user_id,config_json) VALUES(?,?) ON DUPLICATE KEY UPDATE config_json=VALUES(config_json),revision=revision+1',[user.id,JSON.stringify(d.config)]);return reply({revision:d.revision+1,config:d.config});});}
 }
 if(path[0]==='task-changes'&&path.length===1&&request.method==='POST'){
  const d=z.object({task_id:positiveId,version_number:positiveId,patch:taskChangeSchema.refine(p=>Object.keys(p).length>0).refine(p=>!p.custom_values,'Для дополнительных атрибутов используйте карточку задачи')}).parse(await body(request));
  return transaction(async c=>{const [[before]]=await c.query('SELECT * FROM tasks WHERE id=? FOR UPDATE',[d.task_id]);if(!before)throw new WorkError(404,'Задача не найдена');const changed=await changeTask(user,d.task_id,d.patch,c,{version:d.version_number}),id=randomUUID(),previous=Object.fromEntries(Object.keys(d.patch).map(k=>[k,before[k]]));await c.query('INSERT INTO task_undo_actions(id,user_id,task_id,version_number,before_json,expires_at) VALUES(?,?,?,?,?,DATE_ADD(CURRENT_TIMESTAMP,INTERVAL 10 MINUTE))',[id,user.id,d.task_id,changed.version_number,JSON.stringify(previous)]);return reply({...changed,undo_id:id});});
 }
 if(path[0]==='undo'&&path.length===2&&request.method==='POST')return transaction(async c=>{const [[action]]=await c.query('SELECT * FROM task_undo_actions WHERE id=? AND user_id=? AND used_at IS NULL AND expires_at>CURRENT_TIMESTAMP FOR UPDATE',[z.string().uuid().parse(path[1]),user.id]);if(!action)throw new WorkError(409,'Отмена уже выполнена или срок истёк');const result=await changeTask(user,action.task_id,parseJson(action.before_json,{}),c,{version:action.version_number});await c.query('UPDATE task_undo_actions SET used_at=CURRENT_TIMESTAMP WHERE id=?',[action.id]);return reply(result);});
 throw new WorkError(404,'Метод представления не найден');
}
