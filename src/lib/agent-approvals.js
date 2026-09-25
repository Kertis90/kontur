import {rows,parseJson} from './db.js';
import {agentAccess,agentScope,checkAgentRefs} from './agent-sources.js';

// Показывает только ожидающие решения, назначенные сотруднику и доступные ему сейчас.
export async function pendingAgentApprovals(user){
 await agentScope(user,'agents:read');
 const pending=await rows("SELECT r.*,a.name AS agent_name,p.name AS project_name,p.key_code,u.display_name AS actor_name,c.node_id,c.revision AS checkpoint_revision,c.reviewers_json,c.status AS checkpoint_status,c.expires_at,c.expires_at<=CURRENT_TIMESTAMP AS expired FROM ai_agent_runs r JOIN ai_agents a ON a.id=r.agent_id JOIN projects p ON p.id=r.project_id JOIN users u ON u.id=r.actor_id LEFT JOIN ai_agent_checkpoints c ON c.run_id=r.id WHERE r.workspace_id=? AND r.status='review' AND a.enabled=TRUE AND a.revision=r.agent_revision ORDER BY r.created_at,r.id LIMIT 500",[user.workspace_id]);
 const result=[];
 for(const run of pending){
  const meta=parseJson(run.source_meta_json,{}),config=parseJson(run.config_json,{}),reviewers=parseJson(run.reviewers_json,[]);
  if(meta.dry_run)continue;
  const gate=run.checkpoint_status==='waiting';
  if(gate&&(run.expired||(reviewers.length&&!reviewers.includes(Number(user.id)))))continue;
  if(!gate&&(meta.waiting_gate||(config.mode!=='review'&&!meta.review_required)))continue;
  try{
   await agentAccess(user,run.project_id,'agent.approve');
   await agentAccess(user,run.project_id,'agent.view');
   await checkAgentRefs(user,run.project_id,parseJson(run.source_refs_json,[]));
   result.push({id:run.id,project_id:run.project_id,agent_name:run.agent_name,project_name:run.project_name,project_key:run.key_code,actor_name:run.actor_name,kind:gate?'step':'actions',message:gate?String(meta.gate_message||'Сценарий ждёт вашего решения'):String(parseJson(run.result_json,{}).summary||'Проверьте предложенные действия').slice(0,600),created_at:run.created_at,expires_at:gate?run.expires_at:null});
  }catch(error){if(![403,404].includes(error.status))throw error;}
 }
 return {items:result,limit:500};
}
