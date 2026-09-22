import {z} from 'zod';
import {rows,one,transaction} from './db.js';
import {body,reply,positiveId,dateOnly,projectFor,WorkError,validUsers} from './work-common.js';
import {projectPermissionSet} from './permissions.js';
import {audit} from './audit.js';
const number=z.number().finite().min(-1e12).max(1e12);
export const objectiveSchema=z.object({project_id:positiveId,title:z.string().trim().min(2).max(300),description:z.string().max(10000).default(''),owner_id:positiveId,due_date:dateOnly,archived:z.boolean().default(false),revision:positiveId.optional()}).strict();
export const keyResultSchema=z.object({title:z.string().trim().min(2).max(300),mode:z.enum(['manual','tasks']),unit:z.string().trim().max(30).default('%'),start_value:number,target_value:number,weight:z.number().min(0.01).max(1000).default(1),task_ids:z.array(positiveId).max(500).default([])}).strict().refine(d=>d.mode==='tasks'||d.target_value!==d.start_value,'Начальное и целевое значения должны различаться');
export const resultProgress=(start,target,current)=>target===start?0:Math.max(0,Math.min(100,(current-start)/(target-start)*100));
export function objectiveProgress(results){const weight=results.reduce((sum,r)=>sum+Number(r.weight),0);return weight?Math.round(results.reduce((sum,r)=>sum+r.progress*Number(r.weight),0)/weight):0;}
async function access(user,projectId,permission='okr.view'){
 const project=await projectFor(user,projectId),rights=await projectPermissionSet(user,project);
 if(permission==='okr.view'?!['okr.view','okr.manage','okr.update'].some(p=>rights.has(p)):!rights.has(permission))throw new WorkError(403,'Нет доступа к целям и OKR');
 if(permission!=='okr.view'&&project.status!=='active')throw new WorkError(409,'Проект в архиве');return project;
}
async function objectiveFor(user,id,permission='okr.view'){
 const objective=await one('SELECT * FROM work_objectives WHERE id=?',[positiveId.parse(id)]);if(!objective)throw new WorkError(404,'Цель не найдена');await access(user,objective.project_id,permission);return objective;
}
export async function objectivesApi(request,path,user){
 const method=request.method,params=new URL(request.url).searchParams;
 if(path.length===1&&method==='GET'){
  const project=await access(user,positiveId.parse(params.get('project_id'))),objectives=await rows('SELECT o.*,u.display_name AS owner_name FROM work_objectives o JOIN users u ON u.id=o.owner_id WHERE o.project_id=? ORDER BY archived,due_date,id DESC LIMIT 500',[project.id]);
  for(const objective of objectives){
   const results=await rows('SELECT k.* FROM objective_key_results k WHERE k.objective_id=? ORDER BY k.id',[objective.id]);
   for(const result of results){const tasks=await rows('SELECT t.id,t.title,s.is_done FROM objective_task_links l JOIN tasks t ON t.id=l.task_id JOIN workflow_stages s ON s.id=t.stage_id WHERE l.key_result_id=? AND t.project_id=?',[result.id,project.id]);result.tasks=tasks;result.actual_value=result.mode==='tasks'?(tasks.length?tasks.filter(t=>t.is_done).length/tasks.length*100:0):Number(result.current_value);result.progress=resultProgress(Number(result.start_value),Number(result.target_value),result.actual_value);}
   objective.results=results;objective.progress=objectiveProgress(results);
  }return reply(objectives);
 }
 if(path.length===1&&method==='POST'||path.length===2&&method==='PUT'){
  const d=objectiveSchema.parse(await body(request));await access(user,d.project_id,'okr.manage');await validUsers(user,[d.owner_id],d.project_id);
  let id;if(path[1]){const current=await objectiveFor(user,path[1],'okr.manage');if(current.project_id!==d.project_id)throw new WorkError(422,'Проект цели нельзя изменить');const updated=await rows('UPDATE work_objectives SET title=?,description=?,owner_id=?,due_date=?,archived=?,revision=revision+1 WHERE id=? AND revision=?',[d.title,d.description,d.owner_id,d.due_date,d.archived,current.id,d.revision||0]);if(!updated.affectedRows)throw new WorkError(409,'Цель уже изменена');id=current.id;}
  else id=(await rows('INSERT INTO work_objectives(project_id,title,description,owner_id,due_date,created_by) VALUES(?,?,?,?,?,?)',[d.project_id,d.title,d.description,d.owner_id,d.due_date,user.id])).insertId;
  await audit(user,'objective.saved','objective',id);return reply({id});
 }
 const objective=await objectiveFor(user,path[1],method==='GET'?'okr.view':path[4]==='checkins'?'okr.update':'okr.manage');
 if(objective.archived&&method!=='GET')throw new WorkError(409,'Цель находится в архиве');
 if(path[2]==='results'&&path.length===3&&method==='POST'){
  const d=keyResultSchema.parse(await body(request));
  if(d.task_ids.length){const found=await rows(`SELECT id FROM tasks WHERE project_id=? AND id IN (${d.task_ids.map(()=>'?').join(',')})`,[objective.project_id,...d.task_ids]);if(found.length!==new Set(d.task_ids).size)throw new WorkError(422,'Связанная задача недоступна');}
  const id=await transaction(async c=>{const [[locked]]=await c.query('SELECT archived FROM work_objectives WHERE id=? FOR UPDATE',[objective.id]);if(locked.archived)throw new WorkError(409,'Цель в архиве');const [[count]]=await c.query('SELECT COUNT(*) AS total FROM objective_key_results WHERE objective_id=?',[objective.id]);if(count.total>=50)throw new WorkError(409,'Максимум 50 показателей на цель');const start=d.mode==='tasks'?0:d.start_value,target=d.mode==='tasks'?100:d.target_value;const [result]=await c.query('INSERT INTO objective_key_results(objective_id,title,mode,unit,start_value,target_value,current_value,weight) VALUES(?,?,?,?,?,?,?,?)',[objective.id,d.title,d.mode,d.mode==='tasks'?'%':d.unit,start,target,start,d.weight]);for(const taskId of new Set(d.task_ids))await c.query('INSERT INTO objective_task_links(key_result_id,task_id) VALUES(?,?)',[result.insertId,taskId]);return result.insertId;});return reply({id},201);
 }
 if(path[2]==='results'&&path[3]){
  const kr=await one('SELECT * FROM objective_key_results WHERE id=? AND objective_id=?',[positiveId.parse(path[3]),objective.id]);if(!kr)throw new WorkError(404,'Показатель не найден');
  if(path.length===4&&method==='PUT'){
   const d=z.object({revision:positiveId,data:keyResultSchema}).strict().parse(await body(request));if(d.data.mode!==kr.mode)throw new WorkError(422,'Тип показателя не меняется');
   if(d.data.task_ids.length){const found=await rows(`SELECT id FROM tasks WHERE project_id=? AND id IN (${d.data.task_ids.map(()=>'?').join(',')})`,[objective.project_id,...d.data.task_ids]);if(found.length!==new Set(d.data.task_ids).size)throw new WorkError(422,'Связанная задача недоступна');}
   await transaction(async c=>{const [[locked]]=await c.query('SELECT archived FROM work_objectives WHERE id=? FOR UPDATE',[objective.id]);if(locked.archived)throw new WorkError(409,'Цель в архиве');const [changed]=await c.query('UPDATE objective_key_results SET title=?,unit=?,start_value=?,target_value=?,weight=?,revision=revision+1 WHERE id=? AND revision=?',[d.data.title,kr.mode==='tasks'?'%':d.data.unit,kr.mode==='tasks'?0:d.data.start_value,kr.mode==='tasks'?100:d.data.target_value,d.data.weight,kr.id,d.revision]);if(!changed.affectedRows)throw new WorkError(409,'Показатель уже изменён');await c.query('DELETE FROM objective_task_links WHERE key_result_id=?',[kr.id]);for(const taskId of new Set(d.data.task_ids))await c.query('INSERT INTO objective_task_links(key_result_id,task_id) VALUES(?,?)',[kr.id,taskId]);});await audit(user,'objective.result.updated','key_result',kr.id);return reply({ok:true});
  }
  if(path[4]==='checkins'&&method==='GET')return reply(await rows('SELECT c.*,u.display_name AS actor FROM objective_checkins c JOIN users u ON u.id=c.user_id WHERE c.key_result_id=? ORDER BY c.id DESC LIMIT 200',[kr.id]));
  if(path[4]==='checkins'&&method==='POST'){
   await access(user,objective.project_id,'okr.update');if(kr.mode!=='manual')throw new WorkError(422,'Прогресс этого показателя считается по задачам');
   const d=z.object({revision:positiveId,value:number,confidence:z.enum(['on_track','at_risk','off_track']),note:z.string().trim().min(1).max(10000)}).strict().parse(await body(request));
   await transaction(async c=>{const [[locked]]=await c.query('SELECT archived FROM work_objectives WHERE id=? FOR UPDATE',[objective.id]);if(locked.archived)throw new WorkError(409,'Цель в архиве');const [updated]=await c.query('UPDATE objective_key_results SET current_value=?,confidence=?,revision=revision+1 WHERE id=? AND revision=?',[d.value,d.confidence,kr.id,d.revision]);if(!updated.affectedRows)throw new WorkError(409,'Показатель уже обновлён');await c.query('INSERT INTO objective_checkins(key_result_id,value,confidence,note,user_id) VALUES(?,?,?,?,?)',[kr.id,d.value,d.confidence,d.note,user.id]);});await audit(user,'objective.checkin','key_result',kr.id);return reply({ok:true});
  }
 }
 throw new WorkError(404,'Метод целей не найден');
}
