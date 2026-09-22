import {assertIdentityModelBudget} from './agent-identity-policy.js';
import {randomUUID} from 'node:crypto';
import {one,rows,transaction} from './db.js';
import {getAiSettings} from './ai-settings.js';
import {AiError,generateAiText} from './ai-client.js';
import {hasWorkspacePermission} from './permissions.js';
import {reply} from './work-common.js';
export const DEFAULT_AI_BUDGET={enabled:false,monthly_user_tokens:1000000,monthly_workspace_tokens:10000000,max_concurrent:10};
export function estimateAiReservation(profile,system,prompt){return Buffer.byteLength(system,'utf8')+Buffer.byteLength(prompt,'utf8')+Number(profile.max_output_tokens)+1024;}
export function settledAiCharge(result,reserve){
 const valid=n=>Number.isSafeInteger(n)&&n>=0;
 return valid(result?.input_tokens)&&valid(result?.output_tokens)?{charged:result.input_tokens+result.output_tokens,known:true}:{charged:reserve,known:false};
}
export async function reserveAiCall(user,purpose,profile,system,prompt){
 const settings=await getAiSettings(user.workspace_id),budget={...DEFAULT_AI_BUDGET,...settings.budget},reserved=estimateAiReservation(profile,system,prompt),id=randomUUID();
 if(!Number.isSafeInteger(reserved)||reserved<0)throw new AiError(422,'Неверный размер контекста ИИ');
 await transaction(async c=>{
  await c.query('SELECT id FROM workspaces WHERE id=? FOR UPDATE',[user.workspace_id]);
  const [[usage]]=await c.query("SELECT COALESCE(SUM(charged_tokens),0) AS workspace_tokens,COALESCE(SUM(IF(user_id=?,charged_tokens,0)),0) AS user_tokens,COUNT(IF(status='reserved' AND created_at>DATE_SUB(CURRENT_TIMESTAMP,INTERVAL 10 MINUTE),1,NULL)) AS pending FROM ai_usage_ledger WHERE workspace_id=? AND created_at>=DATE_FORMAT(UTC_DATE(),'%Y-%m-01')",[user.id,user.workspace_id]);
  if(Number(usage.pending)>=budget.max_concurrent)throw new AiError(429,'Слишком много одновременных обращений к ИИ. Повторите позже');
  if(budget.enabled&&(Number(usage.workspace_tokens)+reserved>budget.monthly_workspace_tokens||Number(usage.user_tokens)+reserved>budget.monthly_user_tokens))throw new AiError(429,'Месячный бюджет токенов ИИ не позволяет зарезервировать этот запрос');
  await assertIdentityModelBudget(user,profile.id,reserved,c);
  await c.query('INSERT INTO ai_usage_ledger(id,workspace_id,user_id,purpose,profile_id,model,reserved_tokens,charged_tokens) VALUES(?,?,?,?,?,?,?,?)',[id,user.workspace_id,user.id,purpose,profile.id,profile.model,reserved,reserved]);
 });return {id,reserved};
}
export async function generateMeteredAi(user,purpose,profile,key,system,prompt){
 const reservation=await reserveAiCall(user,purpose,profile,system,prompt);
 try{
  const result=await generateAiText(profile,key,system,prompt),charge=settledAiCharge(result,reservation.reserved);
  await rows('UPDATE ai_usage_ledger SET status=?,charged_tokens=?,input_tokens=?,output_tokens=?,completed_at=CURRENT_TIMESTAMP WHERE id=?',[charge.known?'completed':'uncertain',charge.charged,result.input_tokens,result.output_tokens,reservation.id]);
  return result;
 }catch(e){await rows("UPDATE ai_usage_ledger SET status='uncertain',completed_at=CURRENT_TIMESTAMP WHERE id=?",[reservation.id]);throw e;}
}
export async function aiUsageApi(request,user){
 if(request.method!=='GET')throw new AiError(404,'Метод бюджета не найден');
 const workspace=new URL(request.url).searchParams.get('scope')==='workspace';
 if(workspace&&!await hasWorkspacePermission(user,'ai.configure'))throw new AiError(403,'Сводка пространства доступна администратору ИИ');
 const settings=await getAiSettings(user.workspace_id),filter=workspace?'':' AND l.user_id=?',params=workspace?[user.workspace_id]:[user.workspace_id,user.id];
 const people=await rows(`SELECT l.user_id,u.display_name,COUNT(*) AS calls,SUM(l.charged_tokens) AS charged_tokens,SUM(COALESCE(l.input_tokens,0)) AS known_input_tokens,SUM(COALESCE(l.output_tokens,0)) AS known_output_tokens,SUM(l.status='uncertain') AS uncertain_calls,SUM(l.status='reserved') AS reserved_calls FROM ai_usage_ledger l JOIN users u ON u.id=l.user_id WHERE l.workspace_id=? AND l.created_at>=DATE_FORMAT(UTC_DATE(),'%Y-%m-01')${filter} GROUP BY l.user_id,u.display_name ORDER BY charged_tokens DESC`,params);
 const purposes=await rows(`SELECT l.purpose,l.model,COUNT(*) AS calls,SUM(l.charged_tokens) AS charged_tokens FROM ai_usage_ledger l WHERE l.workspace_id=? AND l.created_at>=DATE_FORMAT(UTC_DATE(),'%Y-%m-01')${filter} GROUP BY l.purpose,l.model ORDER BY charged_tokens DESC`,params);
 return reply({month:new Date().toISOString().slice(0,7),scope:workspace?'workspace':'self',budget:{...DEFAULT_AI_BUDGET,...settings.budget},people,purposes,note:'Учёт текстовых генераций с момента обновления. Неизвестный расход и ошибки сохраняют предварительный резерв. Тариф провайдера и распознавание аудио сюда не входят.'});
}
