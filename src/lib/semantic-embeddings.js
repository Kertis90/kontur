import {rows} from './db.js';
import {reserveAiCall,settledAiCharge} from './ai-budget.js';
import {aiProfileKey} from './ai-settings.js';
import {integrationRequest} from './integration-http.js';
import {unitVector} from './semantic-vectors.js';
import {WorkError} from './work-common.js';
export function parseEmbeddings(result,count){
 if(!Array.isArray(result?.data)||result.data.length!==count)throw new WorkError(502,'Провайдер вернул неверное количество векторов');
 const found=new Map();for(const row of result.data){if(!Number.isInteger(row.index)||row.index<0||row.index>=count||found.has(row.index))throw new WorkError(502,'Некорректные индексы векторов');try{found.set(row.index,unitVector(row.embedding));}catch{throw new WorkError(502,'Некорректный вектор от провайдера');}}
 const vectors=Array.from({length:count},(_,i)=>found.get(i));if(vectors.some(v=>v.length!==vectors[0].length))throw new WorkError(502,'Размерности векторов различаются');return vectors;
}
export async function embedTexts(user,profile,model,texts){
 if(!texts.length||texts.length>16)throw new WorkError(422,'Пакет должен содержать от 1 до 16 фрагментов');
 const reservation=await reserveAiCall(user,'semantic_embeddings',{...profile,model,max_output_tokens:0},'',texts.join('\n'));
 try{
  const key=aiProfileKey(profile),response=await integrationRequest(profile.base_url.replace(/\/$/,'')+'/embeddings',{method:'POST',body:JSON.stringify({model,input:texts,encoding_format:'float'}),headers:key?{Authorization:`Bearer ${key}`}:{},maxResponseBytes:3000000});
  if(response.status!==200)throw new WorkError(response.status===429?429:502,'Провайдер embeddings отклонил запрос');
  let result;try{result=JSON.parse(response.text);}catch{throw new WorkError(502,'Провайдер вернул неверный JSON');}
  const vectors=parseEmbeddings(result,texts.length),charge=settledAiCharge({input_tokens:result.usage?.prompt_tokens,output_tokens:0},reservation.reserved);
  await rows('UPDATE ai_usage_ledger SET status=?,charged_tokens=?,input_tokens=?,output_tokens=0,completed_at=CURRENT_TIMESTAMP WHERE id=?',[charge.known?'completed':'uncertain',charge.charged,charge.known?result.usage.prompt_tokens:null,reservation.id]);return vectors;
 }catch(e){await rows("UPDATE ai_usage_ledger SET status='uncertain',completed_at=CURRENT_TIMESTAMP WHERE id=?",[reservation.id]);throw e;}
}
