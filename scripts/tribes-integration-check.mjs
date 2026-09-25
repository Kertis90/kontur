import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import bcrypt from 'bcryptjs';
import {browserEnv} from './browser-env.mjs';
import {load} from './test-module-loader.mjs';
Object.assign(process.env,browserEnv);
const database=await import('../src/lib/db.js'),{db,one,rows,transaction}=database;
const {tribesApi}=await import('../src/lib/work-tribes.js');
const {plansApi}=await import('../src/lib/work-plans.js');
const {handleProjectAccessApi}=await import('../src/lib/project-access.js');
const {projectPermissionSet}=await import('../src/lib/permissions.js');
const admin=await one('SELECT * FROM users WHERE email=?',[browserEnv.ADMIN_EMAIL]),tag=randomUUID().slice(0,8);

// Вызывает настоящий обработчик на одноразовом стенде с реальными проверками доступа.
async function call(handler,actor,method,path,body){const response=await handler(new Request(`https://kontur.test/api/${path}`,{method,...(body?{body:JSON.stringify(body)}:{})}),path.split('/'),actor);return response.json();}
// Создаёт тестовый вход, который затем используется браузером без подмены авторизации.
async function person(name,email,role){await rows("INSERT INTO users(workspace_id,email,display_name,password_hash,global_role,status) VALUES(?,?,?,?,?,'active') ON DUPLICATE KEY UPDATE password_hash=VALUES(password_hash),global_role=VALUES(global_role),status='active'",[admin.workspace_id,email,name,await bcrypt.hash('disposable-tribe-check-123',12),role]);return one('SELECT * FROM users WHERE email=?',[email]);}
// Получает последнюю версию трайба перед изменением состава.
async function add(leader,tribeId,user,extra={}){const {tribe}=await call(tribesApi,leader,'GET',`tribes/${tribeId}`);return call(tribesApi,leader,'PUT',`tribes/${tribeId}/members`,{revision:tribe.revision,user_id:user.id,...extra});}
// Назначает роль по текущей версии доступа проекта.
async function grant(leader,projectId,type,principalId,role){const current=await call(handleProjectAccessApi,leader,'GET',`projects/${projectId}/access`);return call(handleProjectAccessApi,leader,'POST',`projects/${projectId}/access`,{principal_type:type,principal_id:principalId,project_role:role,revision:current.revision});}

try{
 const leader=await person('Лидер трайба проверки','browser-tribe-leader@example.invalid','tribe_leader'),member=await person('Сотрудник трайба проверки','browser-tribe-member@example.invalid','member'),other=await person('Другой руководитель','browser-tribe-other@example.invalid','project_manager');
 const tribe=await call(tribesApi,leader,'POST','tribes',{name:`Трайб доступа ${tag}`}),second=await call(tribesApi,admin,'POST','tribes',{name:`Другой трайб ${tag}`,leader_id:admin.id});
 await assert.rejects(()=>call(tribesApi,other,'GET',`tribes/${tribe.id}`),{status:404});
 await assert.rejects(()=>call(tribesApi,{...leader,workspace_id:leader.workspace_id+999},'GET',`tribes/${tribe.id}`),{status:404});
 await add(leader,tribe.id,member,{can_manage_space:true,can_create_projects:true});await add(admin,second.id,member);
 const details=await call(tribesApi,member,'GET',`tribes/${tribe.id}`);assert.equal(details.tribe.can_manage_members,false);
 await assert.rejects(()=>call(tribesApi,member,'PUT',`tribes/${tribe.id}/members`,{revision:details.tribe.revision,user_id:other.id,can_manage_projects:true}),{status:403});
 await call(tribesApi,member,'PATCH',`tribes/${tribe.id}`,{revision:details.tribe.revision,name:`Трайб доступа ${tag}`,description:'Сотрудник настроил своё пространство',color:'#e30611'});
 await assert.rejects(()=>call(tribesApi,member,'PATCH',`tribes/${second.id}`,{revision:1,name:'Чужой трайб',description:'',color:'#e30611'}),{status:403});
 const workflow=await one('SELECT id FROM workflows WHERE workspace_id=? ORDER BY id LIMIT 1',[admin.workspace_id]);
 const plan=await call(plansApi,leader,'POST','plans',{title:`Проект трайба ${tag}`,request_id:randomUUID()});
 const started=await call(plansApi,leader,'POST',`plans/${plan.id}/start-project`,{revision:1,tribe_id:tribe.id,key_code:`TA${tag.toUpperCase()}`,workflow_id:workflow.id});
 const project=await one('SELECT * FROM projects WHERE id=?',[started.project_id]);assert.equal(project.owner_id,leader.id);assert.equal(project.tribe_id,tribe.id);assert.equal(project.access_mode,'members');
 assert.equal((await projectPermissionSet(other,project)).size,0);assert.equal((await projectPermissionSet(member,project)).size,0);
 await assert.rejects(()=>grant(leader,project.id,'user',other.id,'member'),{status:422});
 await grant(leader,project.id,'user',member.id,'viewer');assert.ok((await projectPermissionSet(member,project)).has('project.browse'));assert.equal((await projectPermissionSet(member,project)).has('task.edit'),false);
 const group=await rows('INSERT INTO access_groups(workspace_id,code,name) VALUES(?,?,?)',[admin.workspace_id,`tribe-${tag}`,`Группа трайба ${tag}`]);
 await rows('INSERT INTO access_group_members(group_id,user_id) VALUES(?,?),(?,?)',[group.insertId,member.id,group.insertId,other.id]);await grant(leader,project.id,'group',group.insertId,'member');
 assert.ok((await projectPermissionSet(member,project)).has('task.edit'));assert.equal((await projectPermissionSet(other,project)).size,0);
 await call(handleProjectAccessApi,leader,'DELETE',`projects/${project.id}/access/user/${member.id}`);assert.ok((await projectPermissionSet(member,project)).has('task.edit'));
 await rows('UPDATE access_groups SET active=FALSE WHERE id=?',[group.insertId]);assert.equal((await projectPermissionSet(member,project)).size,0);await rows('UPDATE access_groups SET active=TRUE WHERE id=?',[group.insertId]);
 await rows('UPDATE access_group_members SET expires_at=DATE_SUB(CURRENT_TIMESTAMP,INTERVAL 1 DAY) WHERE group_id=? AND user_id=?',[group.insertId,member.id]);assert.equal((await projectPermissionSet(member,project)).size,0);await rows('UPDATE access_group_members SET expires_at=NULL WHERE group_id=? AND user_id=?',[group.insertId,member.id]);
 await grant(leader,project.id,'user',member.id,'manager');await assert.rejects(()=>call(handleProjectAccessApi,member,'DELETE',`projects/${project.id}/access/user/${leader.id}`),{status:409});
 const current=await call(handleProjectAccessApi,leader,'GET',`projects/${project.id}/access`);
 await assert.rejects(()=>call(handleProjectAccessApi,member,'POST',`projects/${project.id}/access/owner`,{user_id:member.id,revision:current.revision}),{status:403});
 await assert.rejects(()=>call(handleProjectAccessApi,leader,'POST',`projects/${project.id}/access`,{principal_type:'user',principal_id:member.id,project_role:'viewer',revision:current.revision+10}),{status:409});
 await call(handleProjectAccessApi,leader,'POST',`projects/${project.id}/access/owner`,{user_id:member.id,revision:current.revision});assert.equal((await one('SELECT owner_id FROM projects WHERE id=?',[project.id])).owner_id,member.id);
 const latest=await call(tribesApi,leader,'GET',`tribes/${tribe.id}`);await assert.rejects(()=>call(tribesApi,leader,'DELETE',`tribes/${tribe.id}/members/${member.id}`,{revision:latest.tribe.revision}),{status:409});
 await add(leader,tribe.id,other);await grant(member,project.id,'user',other.id,'viewer');assert.ok((await projectPermissionSet(other,project)).has('project.browse'));
 const after=await call(tribesApi,leader,'GET',`tribes/${tribe.id}`);await call(tribesApi,leader,'DELETE',`tribes/${tribe.id}/members/${other.id}`,{revision:after.tribe.revision});assert.equal((await projectPermissionSet(other,project)).size,0);
 const {createWorkTask}=await import('../src/lib/work-tasks.js');
 await transaction(connection=>createWorkTask(leader,project.id,{title:'Материалы для решения сотрудника'},connection));
 const settingsModule=await import('../src/lib/ai-settings.js'),budgetModule=await import('../src/lib/ai-budget.js'),settings=await settingsModule.getAiSettings(admin.workspace_id);
 // Включает ИИ только в тестовом исполнителе; до согласования внешний сервис не вызывается.
 const runtime=await load('agent-runtime.js',{'db.js':database,'ai-settings.js':{...settingsModule,getAiSettings:async()=>({...settings,enabled:true})},'ai-budget.js':{...budgetModule,generateMeteredAi:async()=>{throw new Error('Модель не должна вызываться до решения сотрудника');}}},browserEnv);
 const {saveAgent}=await load('work-agents.js',{'db.js':database,'ai-settings.js':{...settingsModule,getAiSettings:async()=>({...settings,enabled:true})}},browserEnv);
 const {agentsApi}=await import('../src/lib/work-agents.js');
 const {pendingAgentApprovals}=await import('../src/lib/agent-approvals.js');
 for(const platform of ['server','desktop','phone']){
  const saved=await saveAgent(leader,{project_id:project.id,name:`Согласование ${platform} ${tag}`,enabled:true,config:{profile_id:settings.profiles[0].id,instructions:'Подготовь сводку после решения сотрудника.',trigger:{type:'manual'},sources:{tasks:{enabled:true,fields:['title'],limit:3},quality:{enabled:false}},actions:[],flow:{nodes:[{id:'review',name:'Решение сотрудника',type:'approval',message:'Проверьте материалы перед продолжением',reviewer_ids:[member.id],timeout_hours:48,next:'$end'}]}}});
  const queued=await runtime.enqueueAgentRun(leader,await runtime.getAgent(leader,saved.id),{key:randomUUID(),dryRun:false});await runtime.processAgentRun(queued.id);
  const run=await one('SELECT * FROM ai_agent_runs WHERE id=?',[queued.id]);assert.equal(run.status,'review',run.error_text);
  assert.ok((await pendingAgentApprovals(member)).items.some(item=>item.id===run.id));assert.ok(!(await pendingAgentApprovals(leader)).items.some(item=>item.id===run.id));
  if(platform==='server'){
   const decision={node_id:'review',revision:1,decision:'approve',note:'Материалы проверены'};
   await assert.rejects(()=>call(agentsApi,leader,'POST',`agents/runs/${run.id}/gate`,decision),{status:403});
   await call(agentsApi,member,'POST',`agents/runs/${run.id}/gate`,decision);
   assert.equal((await one('SELECT status FROM ai_agent_runs WHERE id=?',[run.id])).status,'queued');
   assert.ok(!(await pendingAgentApprovals(member)).items.some(item=>item.id===run.id));
   await assert.rejects(()=>call(agentsApi,member,'POST',`agents/runs/${run.id}/gate`,decision),{status:409});
  }
 }
 console.log(`${browserEnv.DB_ENGINE}: трайбы, делегирование, закрытые проекты, владелец, группы, сроки, отзыв доступа, защита версий и согласования ИИ проверены.`);
}finally{await db.end();}
