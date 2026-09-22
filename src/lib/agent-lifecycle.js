import {z} from 'zod';
import {one,rows,transaction,parseJson} from './db.js';
import {body,reply,WorkError,positiveId} from './work-common.js';
import {agentSchema} from './agent-schema.js';
import {agentAccess,validateAgentConfigAccess} from './agent-sources.js';
import {identityActor} from './agent-identities.js';
import {audit} from './audit.js';
const draftSchema=agentSchema.extend({identity_id:positiveId.nullable().default(null),draft_revision:z.number().int().nonnegative().default(0)});
export async function readAgentDraft(agent){
 const saved=await one('SELECT * FROM ai_agent_drafts WHERE agent_id=?',[agent.id]),deployment=await one('SELECT * FROM ai_agent_deployments WHERE agent_id=?',[agent.id]);
 return {id:agent.id,project_id:agent.project_id,name:saved?.name||agent.name,enabled:saved?Boolean(saved.enabled):Boolean(agent.enabled),config:saved?parseJson(saved.config_json):agent.config,identity_id:saved?saved.identity_id:deployment?.identity_id||null,draft_revision:saved?.revision||0,base_revision:saved?.base_revision||agent.revision,revision:agent.revision};
}
export async function agentLifecycleApi(request,path,user,{getAgent,saveAgent}){
 const method=request.method;
 if(method==='POST'&&path[1]==='drafts'){
  const d=draftSchema.parse(await body(request));await agentAccess(user,d.project_id,'agent.manage',true);await validateAgentConfigAccess(user,d.project_id,d.config);
  if(d.identity_id)await validateAgentConfigAccess(await identityActor(user,d.identity_id,d.project_id),d.project_id,d.config);
  const saved=await transaction(async c=>{
   const saved=await saveAgent(user,{project_id:d.project_id,name:d.name,enabled:false,config:d.config},null,{connection:c});
   await c.query('UPDATE ai_agent_deployments SET published=FALSE,identity_id=? WHERE agent_id=?',[d.identity_id,saved.id]);
   await c.query('INSERT INTO ai_agent_drafts(agent_id,base_revision,name,enabled,config_json,identity_id,updated_by) VALUES(?,?,?,?,?,?,?)',[saved.id,saved.revision,d.name,d.enabled,JSON.stringify(d.config),d.identity_id,user.id]);return {...saved,draft_revision:1};
  });await audit(user,'agent.draft.created','ai_agent',saved.id);return reply(saved,201);
 }
 if(!['draft','publish'].includes(path[2]))return null;
 const agent=await getAgent(user,positiveId.parse(path[1]),'agent.manage');
 if(method==='GET'&&path[2]==='draft')return reply(await readAgentDraft(agent));
 if(method==='PUT'&&path[2]==='draft'){
  const d=draftSchema.parse(await body(request));if(d.project_id!==Number(agent.project_id))throw new WorkError(422,'Проект черновика нельзя изменить');
  await validateAgentConfigAccess(user,d.project_id,d.config);if(d.identity_id)await validateAgentConfigAccess(await identityActor(user,d.identity_id,d.project_id),d.project_id,d.config);
  const version=await transaction(async c=>{await c.query('SELECT id FROM projects WHERE id=? FOR UPDATE',[agent.project_id]);const [[current]]=await c.query('SELECT revision FROM ai_agents WHERE id=? FOR UPDATE',[agent.id]);if(current.revision!==d.revision)throw new WorkError(409,'Опубликованная версия изменилась. Обновите редактор');const [[old]]=await c.query('SELECT revision FROM ai_agent_drafts WHERE agent_id=? FOR UPDATE',[agent.id]);if(Number(old?.revision||0)!==d.draft_revision)throw new WorkError(409,'Черновик изменён другим сотрудником');const revision=d.draft_revision+1;
   await c.query('INSERT INTO ai_agent_drafts(agent_id,revision,base_revision,name,enabled,config_json,identity_id,updated_by) VALUES(?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE revision=VALUES(revision),base_revision=VALUES(base_revision),name=VALUES(name),enabled=VALUES(enabled),config_json=VALUES(config_json),identity_id=VALUES(identity_id),updated_by=VALUES(updated_by)',[agent.id,revision,current.revision,d.name,d.enabled,JSON.stringify(d.config),d.identity_id,user.id]);return revision;});
  await audit(user,'agent.draft.saved','ai_agent',agent.id);return reply({id:agent.id,draft_revision:version,revision:agent.revision});
 }
 if(method==='POST'&&path[2]==='publish'){
  const d=z.object({revision:positiveId,draft_revision:positiveId}).strict().parse(await body(request));
  const saved=await transaction(async c=>{
   await c.query('SELECT id FROM projects WHERE id=? FOR UPDATE',[agent.project_id]);const [[current]]=await c.query('SELECT revision FROM ai_agents WHERE id=? FOR UPDATE',[agent.id]),[[draft]]=await c.query('SELECT * FROM ai_agent_drafts WHERE agent_id=? FOR UPDATE',[agent.id]);
   if(!draft||draft.revision!==d.draft_revision||current.revision!==d.revision||draft.base_revision!==current.revision)throw new WorkError(409,'Черновик или опубликованная версия изменились. Сохраните актуальный черновик');
   const executor=draft.identity_id?await identityActor(user,draft.identity_id,agent.project_id):user;
   const saved=await saveAgent(user,{project_id:agent.project_id,name:draft.name,enabled:Boolean(draft.enabled),config:parseJson(draft.config_json),revision:current.revision},agent.id,{connection:c,executor,identityId:draft.identity_id});
   await c.query('DELETE FROM ai_agent_drafts WHERE agent_id=? AND revision=?',[agent.id,draft.revision]);return saved;
  });await audit(user,'agent.published','ai_agent',agent.id);return reply(saved);
 }
 throw new WorkError(404,'Метод публикации агента не найден');
}
