import { z } from "zod";
import { one, rows, parseJson } from "./db.js";
import { emitEvent } from "./events.js";
import { projectFor, validUsers, WorkError, dateOnly, positiveId } from "./work-common.js";
import { assertFieldEdits } from "./work-access.js";

export const taskChangeSchema=z.object({
  title:z.string().trim().min(1).max(300).optional(),description:z.string().max(100000).optional(),
  priority:z.enum(['critical','high','medium','low']).optional(),assignee_id:positiveId.nullable().optional(),
  stage_id:positiveId.optional(),due_date:dateOnly.nullable().optional(),start_date:dateOnly.nullable().optional(),
  estimate_minutes:z.number().int().min(0).max(10000000).nullable().optional(),progress:z.number().int().min(0).max(100).optional(),
  custom_values:z.record(z.unknown()).optional(),
}).strict();
export async function assertDependencyCycle(connection,taskId,dependsOn){
  if(Number(taskId)===Number(dependsOn))throw new WorkError(422,'Задача не может блокировать сама себя');
  const [found]=await connection.query(`WITH RECURSIVE parents AS (
    SELECT depends_on_task_id AS id,CAST(CONCAT(task_id,',',depends_on_task_id) AS CHAR(10000)) AS path FROM task_dependencies WHERE task_id=? AND dependency_type='blocks'
    UNION ALL SELECT d.depends_on_task_id,CONCAT(parents.path,',',d.depends_on_task_id) FROM task_dependencies d JOIN parents ON d.task_id=parents.id WHERE d.dependency_type='blocks' AND FIND_IN_SET(d.depends_on_task_id,parents.path)=0)
    SELECT id FROM parents WHERE id=? LIMIT 1`,[dependsOn,taskId]);
  if(found.length)throw new WorkError(409,'Эта связь создаст цикл зависимостей');
}
export async function assertTaskGates(user, task, patch, connection=null) {
  await assertFieldEdits(user,task.project_id,patch.custom_values,parseJson(task.custom_values_json,{}));
  if(!patch.stage_id||Number(patch.stage_id)===Number(task.stage_id))return;
  const query=connection?async(sql,params)=>(await connection.query(sql,params))[0]:rows;
  const [gate]=await query("SELECT * FROM approval_gates WHERE project_id=? AND stage_id=?",[task.project_id,patch.stage_id]);
  if(!gate)return;
  const [approved]=await query("SELECT id FROM approval_requests WHERE task_id=? AND status='approved' AND task_version_number=? ORDER BY id DESC LIMIT 1",[task.id,task.version_number]);
  const [pending]=await query("SELECT id FROM approval_requests WHERE task_id=? AND status IN ('pending','rejected') AND id>COALESCE(?,0) LIMIT 1",[task.id,approved?.id||0]);
  if(!approved||pending)throw new WorkError(409,"Для перехода требуется завершённое согласование задачи");
  const substantive=['title','description','priority','assignee_id','due_date','start_date','estimate_minutes','story_points','issue_type_id'];
  if(substantive.some(key=>Object.hasOwn(patch,key)&&String(patch[key]??'')!==String(task[key]??'')))throw new WorkError(409,'Сохраните изменения задачи и согласуйте новую версию перед переходом');
  if(patch.custom_values&&Object.entries(patch.custom_values).some(([key,value])=>JSON.stringify(value)!==JSON.stringify(parseJson(task.custom_values_json,{})[key])))throw new WorkError(409,'Изменённые атрибуты требуют нового согласования');
  const combined={...task,...patch,custom_values:{...parseJson(task.custom_values_json,{}),...patch.custom_values}};
  const missing=parseJson(gate.required_fields_json,[]).filter(field=>{const value=field.startsWith('custom.')?combined.custom_values[field.slice(7)]:combined[field];return value==null||value===''||(Array.isArray(value)&&!value.length);});
  if(missing.length)throw new WorkError(422,`Заполните обязательные поля: ${missing.join(', ')}`);
}
export async function changeTask(user,taskId,patch,connection,{version=null,depth=0}={}){
  patch=taskChangeSchema.parse(patch);
  const [[task]]=await connection.query("SELECT * FROM tasks WHERE id=? FOR UPDATE",[positiveId.parse(taskId)]);
  if(!task)throw new WorkError(404,'Задача не найдена');
  const project=await projectFor(user,task.project_id,'task.edit',true);
  if(version!==null&&Number(version)!==Number(task.version_number))throw new WorkError(409,'Задача изменена другим пользователем',{current_version:task.version_number,task_id:task.id});
  if(Object.hasOwn(patch,'assignee_id')&&Number(patch.assignee_id)!==Number(task.assignee_id)){await projectFor(user,task.project_id,'task.assign',true);await validUsers(user,[patch.assignee_id],task.project_id);}
  if(patch.stage_id&&!await one("SELECT id FROM workflow_stages WHERE id=? AND workflow_id=?",[patch.stage_id,project.workflow_id]))throw new WorkError(422,'Этап относится к другому проекту');
  await assertTaskGates(user,task,patch,connection);
  const next={...task,...patch};
  if(next.start_date&&next.due_date&&next.start_date>next.due_date)throw new WorkError(422,'Срок должен быть не раньше начала');
  const updates=[],values=[];
  for(const [field,value] of Object.entries(patch)){
    updates.push(`${field==='custom_values'?'custom_values_json':field}=?`);
    values.push(field==='custom_values'?JSON.stringify({...parseJson(task.custom_values_json,{}),...value}):value);
  }
  if(!updates.length)return {task_id:task.id,version_number:task.version_number};
  await connection.query(`UPDATE tasks SET ${updates.join(',')},version_number=version_number+1 WHERE id=?`,[...values,task.id]);
  await connection.query("INSERT INTO task_revisions(task_id,changed_by,version_number,change_type,changes_json) VALUES(?,?,?,'updated',?)",[task.id,user.id,task.version_number+1,JSON.stringify(patch)]);
  await emitEvent({workspaceId:user.workspace_id,eventType:'task.updated',aggregateType:'task',aggregateId:task.id,payload:{task_id:task.id,project_id:task.project_id,title:next.title,automation_depth:depth,changed_fields:Object.keys(patch)}},connection);
  return {task_id:task.id,version_number:task.version_number+1};
}
export async function createWorkTask(user,projectId,data,connection,{depth=0}={}){
  const project=await projectFor(user,projectId,'task.create',true);
  await connection.query('SELECT id FROM projects WHERE id=? FOR UPDATE',[project.id]);
  const patch=taskChangeSchema.parse(data);
  if(!patch.title)throw new WorkError(422,'Укажите название задачи');
  if(patch.assignee_id){await projectFor(user,project.id,'task.assign',true);await validUsers(user,[patch.assignee_id],project.id);}
  await assertFieldEdits(user,project.id,patch.custom_values,{});
  const stage=await one('SELECT id FROM workflow_stages WHERE workflow_id=? AND (? IS NULL OR id=?) ORDER BY position LIMIT 1',[project.workflow_id,patch.stage_id||null,patch.stage_id||null]);
  if(!stage)throw new WorkError(422,'Этап не найден');
  if(await one('SELECT project_id FROM approval_gates WHERE project_id=? AND stage_id=?',[project.id,stage.id]))throw new WorkError(409,'Создайте задачу на этапе до согласования');
  if(patch.start_date&&patch.due_date&&patch.start_date>patch.due_date)throw new WorkError(422,'Срок должен быть не раньше начала');
  const [[counter]]=await connection.query('SELECT COALESCE(MAX(task_number),0)+1 AS number,COALESCE(MAX(position),0)+1000 AS position FROM tasks WHERE project_id=?',[project.id]);
  const [created]=await connection.query('INSERT INTO tasks(project_id,stage_id,task_number,title,description,priority,assignee_id,reporter_id,start_date,due_date,estimate_minutes,progress,position,rank_value,custom_values_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[project.id,stage.id,counter.number,patch.title,patch.description||'',patch.priority||'medium',patch.assignee_id||null,user.id,patch.start_date||null,patch.due_date||null,patch.estimate_minutes??null,patch.progress||0,counter.position,counter.position,JSON.stringify(patch.custom_values||{})]);
  await emitEvent({workspaceId:user.workspace_id,eventType:'task.created',aggregateType:'task',aggregateId:created.insertId,payload:{task_id:created.insertId,project_id:project.id,title:patch.title,automation_depth:depth}},connection);
  return {task_id:created.insertId,task_key:`${project.key_code}-${counter.number}`,version_number:1};
}
