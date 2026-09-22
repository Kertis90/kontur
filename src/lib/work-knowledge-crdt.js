import * as Y from 'yjs';
import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {rows,one,transaction,parseJson} from './db.js';
import {body,reply,positiveId,WorkError} from './work-common.js';
import {knowledgeSpaceAccess,knowledgeAccessAtLeast} from './knowledge-access.js';
import {makeDocument,documentBody} from './knowledge-crdt.js';
const hash=value=>createHash('sha256').update(value).digest('hex');
const binary=z.string().max(2000000).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);
const relative=z.object({type:z.object({client:z.number().int().nonnegative(),clock:z.number().int().nonnegative()}).nullable().optional(),tname:z.literal('body').nullable().optional(),item:z.object({client:z.number().int().nonnegative(),clock:z.number().int().nonnegative()}).nullable().optional(),assoc:z.number().int().min(-1).max(1).optional()}).strict().nullable();
async function currentAccess(user,article,edit=false){if(!article)throw new WorkError(404,'Статья удалена');const access=await knowledgeSpaceAccess(user,article.space_id);if(!knowledgeAccessAtLeast(access.level,edit?'edit':'view')||article.status!=='published'&&!knowledgeAccessAtLeast(access.level,'edit'))throw new WorkError(403,'Доступ к статье изменился');}
async function resetState(c,article){const doc=makeDocument(article.body),state=Buffer.from(Y.encodeStateAsUpdate(doc)),epoch=randomUUID();doc.destroy();await c.query('INSERT INTO knowledge_crdt(article_id,epoch,state_blob,body_hash) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE epoch=VALUES(epoch),state_blob=VALUES(state_blob),body_hash=VALUES(body_hash)',[article.id,epoch,state,hash(article.body)]);await c.query('DELETE FROM knowledge_cursors WHERE article_id=?',[article.id]);await c.query('UPDATE knowledge_blocks SET deleted_at=CURRENT_TIMESTAMP,revision=revision+1 WHERE article_id=? AND deleted_at IS NULL',[article.id]);return {enabled:true,epoch,update:state.toString('base64'),version_number:article.version_number};}
export async function knowledgeCrdtApi(request,path,user,article,saveArticleRevision){
 if(path[2]==='restore'&&request.method==='POST'){
  const d=z.object({version_number:positiveId,restore_version:positiveId}).parse(await body(request));
  return transaction(async c=>{const [[current]]=await c.query('SELECT * FROM knowledge_articles WHERE id=? FOR UPDATE',[article.id]);await currentAccess(user,current,true);if(current.version_number!==d.version_number)throw new WorkError(409,'Статья уже изменена; сравните версии заново');const [[old]]=await c.query('SELECT * FROM knowledge_article_revisions WHERE article_id=? AND version_number=?',[article.id,d.restore_version]);if(!old)throw new WorkError(404,'Версия не найдена');await saveArticleRevision(c,current,user.id);await c.query("UPDATE knowledge_articles SET title=?,body=?,version_number=version_number+1,review_status='none',reviewed_version=NULL,status=IF(steward_id IS NULL,status,'draft') WHERE id=?",[old.title,old.body,article.id]);await resetState(c,{...current,title:old.title,body:old.body,version_number:current.version_number+1});return reply({version_number:current.version_number+1});});
 }
 if(request.method==='GET'){
  const stored=await one('SELECT * FROM knowledge_crdt WHERE article_id=?',[article.id]);
  if(!stored||stored.body_hash!==hash(article.body))return reply({enabled:false,version_number:article.version_number});
  return reply({enabled:true,epoch:stored.epoch,update:Buffer.from(stored.state_blob).toString('base64'),version_number:article.version_number});
 }
 if(path[3]==='initialize'&&request.method==='POST')return transaction(async c=>{const [[current]]=await c.query('SELECT * FROM knowledge_articles WHERE id=? FOR UPDATE',[article.id]);await currentAccess(user,current,true);const [[stored]]=await c.query('SELECT * FROM knowledge_crdt WHERE article_id=?',[article.id]);if(stored&&stored.body_hash===hash(current.body))return reply({enabled:true,epoch:stored.epoch,update:Buffer.from(stored.state_blob).toString('base64'),version_number:current.version_number});return reply(await resetState(c,current));});
 if(path[3]==='sync'&&request.method==='POST'){
  const d=z.object({epoch:z.string().uuid(),client_id:z.string().uuid(),update:binary.optional(),vector:binary.refine(v=>v.length<=16000,'Слишком большой вектор'),anchor:relative.optional(),focus:relative.optional()}).parse(await body(request));
  const result=await transaction(async c=>{const [[current]]=await c.query('SELECT * FROM knowledge_articles WHERE id=? FOR UPDATE',[article.id]);await currentAccess(user,current,Boolean(d.update));const [[stored]]=await c.query('SELECT * FROM knowledge_crdt WHERE article_id=?',[article.id]);if(!stored||stored.epoch!==d.epoch||stored.body_hash!==hash(current.body))throw new WorkError(409,'Статья восстановлена или изменена в другом редакторе. Сохраните свои правки отдельно и откройте актуальную версию',{epoch_changed:true});
   const doc=new Y.Doc();try{
    Y.applyUpdate(doc,new Uint8Array(stored.state_blob));
    try{if(d.update)Y.applyUpdate(doc,new Uint8Array(Buffer.from(d.update,'base64')));}catch{throw new WorkError(422,'Некорректное обновление совместного документа');}
    let text;try{text=documentBody(doc);}catch(e){throw new WorkError(422,e.message);}
    const state=Buffer.from(Y.encodeStateAsUpdate(doc));if(state.length>8000000)throw new WorkError(413,'История совместного документа достигла лимита. Сохраните текст отдельно и переоткройте его через основной редактор');
    const changed=text!==current.body;
    if(d.update){await c.query('UPDATE knowledge_crdt SET state_blob=?,body_hash=? WHERE article_id=?',[state,hash(text),article.id]);if(changed){await saveArticleRevision(c,current,user.id);await c.query("UPDATE knowledge_articles SET body=?,version_number=version_number+1,review_status='none',reviewed_version=NULL,status=IF(steward_id IS NULL,status,'draft') WHERE id=?",[text,article.id]);}}
    await c.query('INSERT INTO knowledge_cursors(article_id,user_id,client_id,epoch,anchor_json,focus_json,seen_at) VALUES(?,?,?,?,?,?,CURRENT_TIMESTAMP) ON DUPLICATE KEY UPDATE epoch=VALUES(epoch),anchor_json=VALUES(anchor_json),focus_json=VALUES(focus_json),seen_at=CURRENT_TIMESTAMP',[article.id,user.id,d.client_id,stored.epoch,JSON.stringify(d.anchor??null),JSON.stringify(d.focus??null)]);
    let update;try{update=Buffer.from(Y.encodeStateAsUpdate(doc,new Uint8Array(Buffer.from(d.vector,'base64')))).toString('base64');}catch{throw new WorkError(422,'Некорректный вектор синхронизации');}
    return {enabled:true,epoch:stored.epoch,version_number:current.version_number+(changed?1:0),update,vector:Buffer.from(Y.encodeStateVector(doc)).toString('base64')};
   }finally{doc.destroy();}
  });
  const people=await rows("SELECT c.client_id,c.user_id,c.anchor_json,c.focus_json,u.display_name,u.avatar_color FROM knowledge_cursors c JOIN users u ON u.id=c.user_id WHERE c.article_id=? AND c.epoch=? AND c.seen_at>DATE_SUB(CURRENT_TIMESTAMP,INTERVAL 30 SECOND) AND u.status='active' ORDER BY c.seen_at DESC LIMIT 100",[article.id,result.epoch]);
  return reply({...result,people:people.map(p=>({...p,anchor:parseJson(p.anchor_json,null),focus:parseJson(p.focus_json,null),anchor_json:undefined,focus_json:undefined}))});
 }
 throw new WorkError(404,'Метод совместного документа не найден');
}
export async function staleArticles(user){
 const articles=await rows('SELECT a.id,a.space_id,a.title,a.review_due_date,a.review_status,a.status,u.display_name AS steward_name,s.name AS space_name FROM knowledge_articles a JOIN knowledge_spaces s ON s.id=a.space_id LEFT JOIN users u ON u.id=a.steward_id WHERE s.workspace_id=? AND a.review_due_date<CURRENT_DATE AND a.status<>\'archived\' ORDER BY a.review_due_date,a.id',[user.workspace_id]),permissions=new Map(),visible=[];
 for(const article of articles){if(!permissions.has(article.space_id))permissions.set(article.space_id,(await knowledgeSpaceAccess(user,article.space_id)).level);const level=permissions.get(article.space_id);if(knowledgeAccessAtLeast(level,'view')&&(article.status==='published'||knowledgeAccessAtLeast(level,'edit')))visible.push(article);}return reply(visible);
}
