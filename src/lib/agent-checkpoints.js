import {one,rows,transaction,parseJson} from './db.js';
import {encryptSecret,decryptSecret} from './crypto.js';
import {WorkError} from './work-common.js';
import {agentAccess,agentScope,checkAgentRefs} from './agent-sources.js';
export async function loadAgentCheckpoint(run){
 const saved=await one("SELECT * FROM ai_agent_checkpoints WHERE run_id=? AND status='ready'",[run.id]);
 if(!saved?.snapshot_encrypted)return null;
 try{return {...saved,snapshot:JSON.parse(decryptSecret(saved.snapshot_encrypted))};}catch{throw new WorkError(409,'Не удалось прочитать сохранённое состояние сценария');}
}
export async function pauseAgentAtGate(run,node,snapshot,meta){
 const encrypted=encryptSecret(JSON.stringify(snapshot));if(encrypted.length>2000000)throw new WorkError(422,'Слишком большой контекст для сохранения согласования');
 await transaction(async c=>{
  await c.query('SELECT id FROM projects WHERE id=? FOR UPDATE',[run.project_id]);const [[agent]]=await c.query('SELECT enabled,revision FROM ai_agents WHERE id=? FOR UPDATE',[run.agent_id]);
  const [[live]]=await c.query('SELECT status FROM ai_agent_runs WHERE id=? FOR UPDATE',[run.id]);
  if(live?.status!=='running'||!agent.enabled||agent.revision!==run.agent_revision)throw new WorkError(409,'Запуск остановлен или версия изменена');
  await c.query("INSERT INTO ai_agent_checkpoints(run_id,node_id,status,reviewers_json,snapshot_encrypted,expires_at) VALUES(?,?,'waiting',?,?,DATE_ADD(CURRENT_TIMESTAMP,INTERVAL ? HOUR)) ON DUPLICATE KEY UPDATE revision=revision+1,node_id=VALUES(node_id),status='waiting',reviewers_json=VALUES(reviewers_json),snapshot_encrypted=VALUES(snapshot_encrypted),expires_at=VALUES(expires_at),decided_by=NULL,decision_note=NULL,decided_at=NULL",[run.id,node.id,JSON.stringify(node.reviewer_ids),encrypted,node.timeout_hours]);
  await c.query("UPDATE ai_agent_runs SET status='review',source_meta_json=? WHERE id=?",[JSON.stringify({...meta,waiting_gate:node.id,gate_message:node.message}),run.id]);
 });
}
export async function decideAgentGate(user,run,d,verifyRun){
 await agentAccess(user,run.project_id,'agent.approve',true);await agentScope(user,'agents:approve');
 await checkAgentRefs(user,run.project_id,parseJson(run.source_refs_json,[]),{versions:true});
 const live=await verifyRun(run,'review');await checkAgentRefs(live.actor,run.project_id,parseJson(run.source_refs_json,[]),{versions:true});
 return transaction(async c=>{
  await c.query('SELECT id FROM projects WHERE id=? FOR UPDATE',[run.project_id]);const [[agent]]=await c.query('SELECT enabled,revision FROM ai_agents WHERE id=? FOR UPDATE',[run.agent_id]);const [[locked]]=await c.query('SELECT status,source_meta_json FROM ai_agent_runs WHERE id=? FOR UPDATE',[run.id]);
  const [[checkpoint]]=await c.query('SELECT *,expires_at<=CURRENT_TIMESTAMP AS expired FROM ai_agent_checkpoints WHERE run_id=? FOR UPDATE',[run.id]);
  if(!checkpoint||checkpoint.status!=='waiting'||checkpoint.revision!==d.revision||checkpoint.node_id!==d.node_id||locked?.status!=='review'||!agent.enabled||agent.revision!==run.agent_revision)throw new WorkError(409,'Согласование уже обработано или сценарий изменился');
  if(checkpoint.expired)throw new WorkError(409,'Срок согласования истёк. Запустите сценарий заново');
  const reviewers=parseJson(checkpoint.reviewers_json,[]);if(reviewers.length&&!reviewers.includes(Number(user.id)))throw new WorkError(403,'Этот шаг назначен другим согласующим');
  const meta={...parseJson(locked.source_meta_json,{}),waiting_gate:null};
  if(d.decision==='reject'){
   await c.query("UPDATE ai_agent_checkpoints SET status='rejected',decided_by=?,decision_note=?,decided_at=CURRENT_TIMESTAMP WHERE run_id=?",[user.id,d.note,run.id]);
   await c.query("UPDATE ai_agent_runs SET status='rejected',source_meta_json=?,completed_at=CURRENT_TIMESTAMP WHERE id=?",[JSON.stringify(meta),run.id]);return {status:'rejected'};
  }
  const snapshot=JSON.parse(decryptSecret(checkpoint.snapshot_encrypted));snapshot.decisions={...snapshot.decisions,[checkpoint.node_id]:{approved:true,summary:d.note||'Согласовано',reviewed_by:user.id}};
  await c.query("UPDATE ai_agent_checkpoints SET status='ready',snapshot_encrypted=?,decided_by=?,decision_note=?,decided_at=CURRENT_TIMESTAMP WHERE run_id=?",[encryptSecret(JSON.stringify(snapshot)),user.id,d.note,run.id]);
  await c.query("UPDATE ai_agent_runs SET status='queued',source_meta_json=? WHERE id=?",[JSON.stringify(meta),run.id]);return {status:'queued'};
 });
}
// Закрывает просроченные согласования и запуски атомарно в обеих поддерживаемых БД.
export async function expireAgentGates(){
 await transaction(async c=>{
  const [expired]=await c.query("SELECT r.id FROM ai_agent_runs r JOIN ai_agent_checkpoints c ON c.run_id=r.id WHERE r.status='review' AND c.status='waiting' AND c.expires_at<=CURRENT_TIMESTAMP FOR UPDATE");
  for(const run of expired){
   await c.query("UPDATE ai_agent_runs SET status='failed',error_text='Срок согласования шага истёк',completed_at=CURRENT_TIMESTAMP WHERE id=?",[run.id]);
   await c.query("UPDATE ai_agent_checkpoints SET status='expired' WHERE run_id=?",[run.id]);
  }
 });
}
