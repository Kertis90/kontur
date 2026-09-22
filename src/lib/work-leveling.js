import {rows,parseJson} from './db.js';
import {workspaceFor,visibleProjects,dateOnly,reply,WorkError} from './work-common.js';
import {projectPermissionSet} from './permissions.js';
import {suggestLeveling} from './leveling.js';
export async function levelingApi(request,user){
 await workspaceFor(user,'capacity.view');if(request.method!=='GET')throw new WorkError(405,'Доступен только просмотр предложений');
 const url=new URL(request.url),start=dateOnly.parse(url.searchParams.get('start')),end=dateOnly.parse(url.searchParams.get('end'));
 if(end<start||Date.parse(end)-Date.parse(start)>31*86400000)throw new WorkError(422,'Выберите период до 32 дней');
 const [people,calendars,absences,allocations,tasks]=await Promise.all([
  rows("SELECT * FROM users WHERE workspace_id=? AND status='active'",[user.workspace_id]),rows('SELECT * FROM resource_calendars WHERE workspace_id=?',[user.workspace_id]),rows('SELECT * FROM resource_absences WHERE workspace_id=? AND start_date<=? AND end_date>=?',[user.workspace_id,end,start]),
  rows("SELECT a.* FROM resource_allocations a JOIN projects p ON p.id=a.project_id WHERE p.workspace_id=? AND p.deleted_at IS NULL AND p.status='active' AND a.start_date<=? AND a.end_date>=?",[user.workspace_id,end,start]),
  rows("SELECT t.id,t.project_id,t.title,t.assignee_id,t.version_number,t.task_number,t.estimate_minutes,t.progress,t.start_date,t.due_date,s.is_done,p.key_code FROM tasks t JOIN projects p ON p.id=t.project_id JOIN workflow_stages s ON s.id=t.stage_id WHERE p.workspace_id=? AND p.deleted_at IS NULL AND p.status='active' AND s.is_done=FALSE",[user.workspace_id])]);
 const projects=await visibleProjects(user),eligible={};for(const project of projects){const actor=await projectPermissionSet(user,project);if(!actor.has('task.assign')||!actor.has('task.edit'))continue;eligible[project.id]=[];for(const person of people)if((await projectPermissionSet(person,project)).has('project.browse'))eligible[project.id].push(person.id);}
 return reply({...suggestLeveling({people,tasks,calendars,absences,allocations,eligible,start,end}),start,end,note:'Оценка оставшейся работы на выбранное окно, без проверки навыков и зависимостей. Учитываются все проекты, рабочие недели и отсутствия. Резерв и задачи одного проекта учитываются по максимуму, чтобы не считать часы дважды. Задачи без оценки не участвуют. Применяйте предложения по одному после проверки.'});
}
