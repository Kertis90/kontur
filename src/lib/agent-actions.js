import {randomUUID} from 'node:crypto';
import {WorkError,projectFor} from './work-common.js';
import {createWorkTask,changeTask} from './work-tasks.js';
import {emitEvent} from './events.js';
import {agentChatAccess,agentKnowledgeAccess,extraScope} from './agent-extra-sources.js';
import {AGENT_ACTION_CATALOG} from './agent-catalog.js';
export async function assertAgentAction(user,projectId,action){
 const rule=AGENT_ACTION_CATALOG.find(r=>r.key===action.type);if(!rule)throw new WorkError(422,'Неизвестное действие');
 await extraScope(user,rule.scope);if(rule.permission)await projectFor(user,projectId,rule.permission,true);
 if(action.type==='assign_task')await projectFor(user,projectId,'task.edit',true);
 if(action.type==='create_article')await agentKnowledgeAccess(user,action.space_id,true);
 if(action.type==='chat_message')await agentChatAccess(user,action.channel_id,projectId,true);
}
export async function executeAgentAction(user,run,action,c,versions){
 await assertAgentAction(user,run.project_id,action);
 if(action.type==='create_task')return createWorkTask(user,run.project_id,{title:action.title,description:action.description+`\n\nСоздано агентом, запуск #${run.id}.`,priority:action.priority},c,{depth:1});
 if(action.type==='create_article'){
  const [item]=await c.query("INSERT INTO knowledge_articles(space_id,title,slug,body,status,author_id) VALUES(?,?,?,?,'draft',?)",[action.space_id,action.title,`agent-${run.id}-${randomUUID()}`,action.body,user.id]);return {article_id:item.insertId};
 }
 if(action.type==='chat_message'){
  const [item]=await c.query('INSERT INTO chat_messages(channel_id,sender_id,body) VALUES(?,?,?)',[action.channel_id,user.id,action.body+`\n\nИИ-агент · запуск #${run.id}`]);await c.query('UPDATE chat_channels SET updated_at=CURRENT_TIMESTAMP WHERE id=?',[action.channel_id]);return {channel_id:action.channel_id,message_id:item.insertId};
 }
 const [[task]]=await c.query('SELECT id,project_id,version_number FROM tasks WHERE id=? FOR UPDATE',[action.task_id]);
 if(!task||Number(task.project_id)!==Number(run.project_id)||Number(task.version_number)!==Number(versions.get(Number(action.task_id))))throw new WorkError(409,'Задача изменилась; запустите агента заново');
 if(['update_task','move_task','assign_task'].includes(action.type)){
  const patch=action.type==='update_task'?action.patch:action.type==='move_task'?{stage_id:action.stage_id}:{assignee_id:action.assignee_id};
  const changed=await changeTask(user,task.id,patch,c,{version:versions.get(Number(task.id)),depth:1});versions.set(Number(task.id),changed.version_number);return changed;
 }
 if(action.type==='checklist_item'){
  const [[position]]=await c.query('SELECT COALESCE(MAX(position),0)+1 AS value FROM task_checklist_items WHERE task_id=?',[task.id]);
  const [item]=await c.query('INSERT INTO task_checklist_items(task_id,title,position) VALUES(?,?,?)',[task.id,action.title,position.value]);
  await c.query('UPDATE tasks SET version_number=version_number+1 WHERE id=?',[task.id]);const version=Number(task.version_number)+1;versions.set(Number(task.id),version);
  await c.query("INSERT INTO task_revisions(task_id,changed_by,version_number,change_type,changes_json) VALUES(?,?,?,'updated',?)",[task.id,user.id,version,JSON.stringify({checklist_added:item.insertId,agent_run_id:run.id})]);
  await emitEvent({workspaceId:user.workspace_id,eventType:'task.updated',aggregateType:'task',aggregateId:task.id,payload:{project_id:run.project_id,task_id:task.id,automation_depth:1,agent_run_id:run.id,changed_fields:['checklist']}},c);return {task_id:task.id,checklist_item_id:item.insertId,version_number:version};
 }
 if(action.type==='comment'){
  const [item]=await c.query('INSERT INTO comments(task_id,author_id,body) VALUES(?,?,?)',[task.id,user.id,action.body+`\n\nИИ-агент · запуск #${run.id}`]);
  await emitEvent({workspaceId:user.workspace_id,eventType:'comment.created',aggregateType:'task',aggregateId:task.id,payload:{project_id:run.project_id,task_id:task.id,comment_id:item.insertId,automation_depth:1,agent_run_id:run.id}},c);return {task_id:task.id,comment_id:item.insertId};
 }
 throw new WorkError(422,'Действие не поддерживается');
}
export function agentActionPrompt(config){
 const examples={create_task:'{type:"create_task",title,description,priority,reason}',comment:'{type:"comment",task_id,body,reason}',update_task:'{type:"update_task",task_id,patch:{priority,due_date,start_date,progress,estimate_minutes,title,description},reason}; передавай только изменяемые поля',move_task:'{type:"move_task",task_id,stage_id,reason}',assign_task:'{type:"assign_task",task_id,assignee_id,reason}',checklist_item:'{type:"checklist_item",task_id,title,reason}',create_article:'{type:"create_article",space_id,title,body,reason}; только черновик',chat_message:'{type:"chat_message",channel_id,body,reason}'};
 return config.actions.map(a=>examples[a]).join('\n')+'\nОграничения целей и атрибутов: '+JSON.stringify({stage_ids:config.policy.allowed_stage_ids,assignee_ids:config.policy.allowed_assignee_ids,space_ids:config.policy.article_space_ids,channel_ids:config.policy.chat_channel_ids,editable_fields:config.policy.editable_fields});
}
