import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {one,rows,transaction} from './db.js';
import {encryptSecret,decryptSecret} from './crypto.js';
import {getAiSettings} from './ai-settings.js';
import {apiBackgroundAllowed} from './api-access.js';
import {workspaceFor,WorkError,body,reply,positiveId} from './work-common.js';
import {audit} from './audit.js';
import {embedTexts} from './semantic-embeddings.js';
import {semanticHash,semanticChunks,vectorBuckets,neighboringBuckets,cosine} from './semantic-vectors.js';
import {SEMANTIC_KINDS,SEMANTIC_SCOPES,nextSemanticSource,semanticSource} from './semantic-sources.js';

export async function semanticActor(user,permission,scope){
 const actor=await one("SELECT * FROM users WHERE id=? AND workspace_id=? AND status='active'",[user.id,user.workspace_id]);
 if(!actor||!await apiBackgroundAllowed(actor,user.api_token_id,scope))throw new WorkError(403,'Доступ к поиску отозван');
 await workspaceFor(actor,permission);return {...actor,api_token_id:user.api_token_id};
}
async function config(workspaceId,required=true){
 const settings=await one('SELECT * FROM semantic_settings WHERE workspace_id=?',[workspaceId])||{enabled:false,profile_id:null,model:'',revision:0};
 const ai=await getAiSettings(workspaceId),profile=ai.profiles.find(p=>p.id===settings.profile_id);
 const ready=Boolean(settings.enabled&&ai.enabled&&profile?.enabled&&settings.model);
 if(required&&!ready)throw new WorkError(409,'Семантический поиск не настроен');
 return {settings,profile,ready,namespace:semanticHash(JSON.stringify([profile?.id,profile?.revision,settings.model,settings.revision,'chunks-v1-lsh64']))};
}
async function sourceAllowed(user,kind){return apiBackgroundAllowed(user,user.api_token_id,SEMANTIC_SCOPES[kind]);}
export async function semanticApi(request,path,user){
 if(path[1]==='settings'){
  if(user.api_token_id)throw new WorkError(403,'Настройки доступны после входа через браузер');await workspaceFor(user,'ai.configure');
  if(request.method==='GET'){const c=await config(user.workspace_id,false),ai=await getAiSettings(user.workspace_id);return reply({...c.settings,ready:c.ready,profiles:ai.profiles.map(p=>({id:p.id,name:p.name,enabled:p.enabled}))});}
  if(request.method==='PUT'){
   const d=z.object({revision:z.number().int().nonnegative(),enabled:z.boolean(),profile_id:z.string().uuid().nullable(),model:z.string().trim().max(200)}).parse(await body(request));
   const ai=await getAiSettings(user.workspace_id),p=ai.profiles.find(p=>p.id===d.profile_id);
   if(d.enabled&&(!ai.enabled||!p?.enabled||!d.model||!p.base_url.startsWith('https://')))throw new WorkError(422,'Выберите включённое HTTPS-подключение ИИ и модель embeddings');
   await transaction(async c=>{await c.query('SELECT id FROM workspaces WHERE id=? FOR UPDATE',[user.workspace_id]);const [[old]]=await c.query('SELECT revision FROM semantic_settings WHERE workspace_id=?',[user.workspace_id]);if(Number(old?.revision||0)!==d.revision)throw new WorkError(409,'Настройки изменены');await c.query('INSERT INTO semantic_settings(workspace_id,enabled,profile_id,model) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE enabled=VALUES(enabled),profile_id=VALUES(profile_id),model=VALUES(model),revision=revision+1',[user.workspace_id,d.enabled,d.profile_id,d.model]);});await audit(user,'semantic.settings','workspace',user.workspace_id);return reply({ok:true});
  }
 }
 if(path[1]==='jobs'){
  user=await semanticActor(user,'semantic.index',request.method==='GET'?'semantic:read':'semantic:write');
  if(request.method==='GET')return reply(await rows('SELECT id,status,kind_index,cursor_id,indexed_count,skipped_count,error_code,created_at,updated_at FROM semantic_jobs WHERE workspace_id=? AND user_id=? ORDER BY id DESC LIMIT 50',[user.workspace_id,user.id]));
  if(request.method==='POST'&&!path[2]){
   for(const kind of SEMANTIC_KINDS)if(!await sourceAllowed(user,kind))throw new WorkError(403,`Для индексации нужен scope ${SEMANTIC_SCOPES[kind]}`);
   const c=await config(user.workspace_id);const id=await transaction(async tx=>{await tx.query('SELECT id FROM workspaces WHERE id=? FOR UPDATE',[user.workspace_id]);const [[pending]]=await tx.query("SELECT id FROM semantic_jobs WHERE workspace_id=? AND status IN ('queued','running') LIMIT 1",[user.workspace_id]);if(pending)throw new WorkError(409,'В пространстве уже выполняется индексация');const [r]=await tx.query('INSERT INTO semantic_jobs(workspace_id,user_id,api_token_id,namespace) VALUES(?,?,?,?)',[user.workspace_id,user.id,user.api_token_id||null,c.namespace]);return r.insertId;});await audit(user,'semantic.index.queued','semantic_job',id);return reply({id},202);
  }
  if(request.method==='POST'&&path[2]){
   const id=positiveId.parse(path[2]),d=z.object({action:z.enum(['resume','cancel'])}).parse(await body(request));
   const c=await config(user.workspace_id,d.action==='resume');
   await transaction(async tx=>{await tx.query('SELECT id FROM workspaces WHERE id=? FOR UPDATE',[user.workspace_id]);const [[job]]=await tx.query('SELECT * FROM semantic_jobs WHERE id=? AND workspace_id=? AND user_id=? FOR UPDATE',[id,user.workspace_id,user.id]);if(!job)throw new WorkError(404,'Задание не найдено');if(d.action==='resume'){if(!['failed','cancelled'].includes(job.status)||job.namespace!==c.namespace)throw new WorkError(409,'Нужна новая индексация или задание уже выполняется');const [[pending]]=await tx.query("SELECT id FROM semantic_jobs WHERE workspace_id=? AND status IN ('queued','running') LIMIT 1",[user.workspace_id]);if(pending)throw new WorkError(409,'Уже есть активное задание');}await tx.query('UPDATE semantic_jobs SET status=?,error_code=NULL,lease_token=NULL,lease_until=NULL WHERE id=?',[d.action==='resume'?'queued':'cancelled',id]);});return reply({ok:true});
  }
 }
 if(path[1]==='search'&&request.method==='POST')return reply(await searchSemantic(user,await body(request)));

 throw new WorkError(404,'Метод семантического поиска не найден');
}

export async function searchSemantic(user,input,{spaceIds=[],limit=15}={}){
 user=await semanticActor(user,'ai.search','semantic:read');const d=z.object({query:z.string().trim().min(2).max(2000),kinds:z.array(z.enum(SEMANTIC_KINDS)).min(1).max(3).default(SEMANTIC_KINDS)}).parse(input);
  const kinds=[...new Set(d.kinds)];for(const kind of kinds)if(!await sourceAllowed(user,kind))throw new WorkError(403,`Нужен scope ${SEMANTIC_SCOPES[kind]}`);
  const c=await config(user.workspace_id),[vector]=await embedTexts(user,c.profile,c.settings.model,[d.query]),neighbors=neighboringBuckets(vector),params=[user.workspace_id,c.namespace];
  const clauses=neighbors.map(b=>{params.push(b.band,...b.values);return `(b.band=? AND b.bucket IN (${b.values.map(()=>'?')}))`;});
  params.push(...kinds);
  const spaceFilter=spaceIds.length?` AND d.kind='knowledge' AND d.source_id IN (SELECT id FROM knowledge_articles WHERE space_id IN (${spaceIds.map(()=>'?')}))`:'';params.push(...spaceIds);
  const candidates=await rows(`SELECT d.*,COUNT(*) AS matches FROM semantic_buckets b JOIN semantic_documents d ON d.id=b.document_id WHERE b.workspace_id=? AND b.namespace=? AND (${clauses.join(' OR ')}) AND d.kind IN (${kinds.map(()=>'?')})${spaceFilter} GROUP BY d.id ORDER BY matches DESC,d.id DESC LIMIT 1000`,params);
  user=await semanticActor(user,'ai.search','semantic:read');if((await config(user.workspace_id)).namespace!==c.namespace)throw new WorkError(409,'Настройки модели изменены. Повторите поиск');
  const sources=new Map(),best=new Map();
  for(const row of candidates){const key=`${row.kind}:${row.source_id}`;if(!sources.has(key)){try{if(!await sourceAllowed(user,row.kind))throw new WorkError(403,'Доступ отозван');sources.set(key,await semanticSource(user,row.kind,row.source_id));}catch(e){if(![403,404,409].includes(e.status))throw e;sources.set(key,null);}}
   const source=sources.get(key);if(!source||source.hash!==row.content_hash)continue;let saved;try{saved=JSON.parse(decryptSecret(row.vector_encrypted));}catch{continue;}if(!Array.isArray(saved))continue;const score=cosine(vector,saved);if(!Number.isFinite(score)||score<0.1||score<=(best.get(key)?.score??-1))continue;
   best.set(key,{kind:row.kind,id:row.source_id,title:source.title,url:source.url,snippet:source.text.slice(row.chunk_start,row.chunk_start+Math.min(row.chunk_length,1200)),fragment_start:row.chunk_start,content_hash:source.hash,score});
  }
  // Recheck the winning sources immediately before returning any content.
  const results=[];for(const found of [...best.values()].sort((a,b)=>b.score-a.score).slice(0,limit)){try{const now=await semanticSource(user,found.kind,found.id);if(now.hash===sources.get(`${found.kind}:${found.id}`).hash&&await sourceAllowed(user,found.kind))results.push(found);}catch(e){if(![403,404,409].includes(e.status))throw e;}}
  return {results,approximate:true,note:'Поиск по проиндексированным материалам. Изменённые документы появятся после обновления индекса; выдача не является полным перечнем совпадений.'};
}

export async function pollSemanticJobs(){
 const token=randomUUID();const job=await transaction(async c=>{const [[j]]=await c.query("SELECT * FROM semantic_jobs WHERE status IN ('queued','running') AND (lease_until IS NULL OR lease_until<CURRENT_TIMESTAMP) ORDER BY updated_at,id LIMIT 1 FOR UPDATE SKIP LOCKED");if(!j)return null;await c.query("UPDATE semantic_jobs SET status='running',lease_token=?,lease_until=DATE_ADD(CURRENT_TIMESTAMP,INTERVAL 90 SECOND) WHERE id=?",[token,j.id]);return j;});if(!job)return;
 try{
  let user=await semanticActor({id:job.user_id,workspace_id:job.workspace_id,api_token_id:job.api_token_id},'semantic.index','semantic:write'),c=await config(job.workspace_id);if(c.namespace!==job.namespace)throw new WorkError(409,'Настройки изменены');
  const kind=SEMANTIC_KINDS[job.kind_index];if(!kind){await rows("UPDATE semantic_jobs SET status='completed',lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=?",[job.id,token]);return;}
  if(!await sourceAllowed(user,kind))throw new WorkError(403,'Доступ к источнику отозван');const next=await nextSemanticSource(job.workspace_id,kind,job.cursor_id);
  if(!next){await rows('UPDATE semantic_jobs SET kind_index=kind_index+1,cursor_id=0,lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=?',[job.id,token]);return;}
  let source;try{source=await semanticSource(user,kind,next.id);}catch(e){if(![403,404,409].includes(e.status))throw e;}
  let chunks=[],vectors=[];const existing=source?await one('SELECT content_hash FROM semantic_documents WHERE workspace_id=? AND namespace=? AND kind=? AND source_id=? LIMIT 1',[job.workspace_id,job.namespace,kind,next.id]):null;
  if(source&&existing?.content_hash!==source.hash){chunks=semanticChunks(source.text);for(let i=0;i<chunks.length;i+=16){const lease=await one("SELECT id FROM semantic_jobs WHERE id=? AND lease_token=? AND status='running' AND lease_until>CURRENT_TIMESTAMP",[job.id,token]);if(!lease)return;user=await semanticActor(user,'semantic.index','semantic:write');if(!await sourceAllowed(user,kind))throw new WorkError(403,'Доступ отозван');const fresh=await semanticSource(user,kind,next.id);if(fresh.hash!==source.hash)throw new WorkError(409,'Документ изменился');vectors.push(...await embedTexts(user,c.profile,c.settings.model,chunks.slice(i,i+16).map(x=>x.text)));}}
  if(source){user=await semanticActor(user,'semantic.index','semantic:write');if(!await sourceAllowed(user,kind)||(await semanticSource(user,kind,next.id)).hash!==source.hash)throw new WorkError(409,'Доступ или документ изменился');}
  await transaction(async tx=>{await tx.query('SELECT id FROM workspaces WHERE id=? FOR UPDATE',[job.workspace_id]);const [[live]]=await tx.query('SELECT lease_token,status FROM semantic_jobs WHERE id=? FOR UPDATE',[job.id]);if(live?.lease_token!==token||live.status!=='running')return;
   if(chunks.length){await tx.query('DELETE FROM semantic_documents WHERE workspace_id=? AND namespace=? AND kind=? AND source_id=?',[job.workspace_id,job.namespace,kind,next.id]);for(let i=0;i<chunks.length;i++){const [r]=await tx.query('INSERT INTO semantic_documents(workspace_id,namespace,kind,source_id,chunk_index,content_hash,chunk_start,chunk_length,vector_encrypted) VALUES(?,?,?,?,?,?,?,?,?)',[job.workspace_id,job.namespace,kind,next.id,i,source.hash,chunks[i].start,chunks[i].text.length,encryptSecret(JSON.stringify(vectors[i]))]);const buckets=vectorBuckets(vectors[i]);for(let band=0;band<8;band++)await tx.query('INSERT INTO semantic_buckets(document_id,workspace_id,namespace,band,bucket) VALUES(?,?,?,?,?)',[r.insertId,job.workspace_id,job.namespace,band,buckets[band]]);}}
   await tx.query('UPDATE semantic_jobs SET cursor_id=?,indexed_count=indexed_count+?,skipped_count=skipped_count+?,lease_token=NULL,lease_until=NULL WHERE id=?',[next.id,source?1:0,source?0:1,job.id]);
  });
 }catch(e){await rows("UPDATE semantic_jobs SET status='failed',error_code=?,lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=?",[e.status===403?'ACCESS_REVOKED':e.status===429?'AI_LIMIT':e.status===409?'SOURCE_OR_MODEL_CHANGED':'EMBEDDING_FAILED',job.id,token]);}
}
