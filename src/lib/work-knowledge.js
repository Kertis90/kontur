import {knowledgeCrdtApi,staleArticles} from './work-knowledge-crdt.js';
import crypto from 'node:crypto';
import { z } from 'zod';
import { rows,one,transaction } from './db.js';
import { WorkError,positiveId,body,reply,dateOnly,validUsers } from './work-common.js';
import { knowledgeSpaceAccess,knowledgeAccessAtLeast } from './knowledge-access.js';
import { createNotification } from './events.js';

async function articleFor(user,id,required='view'){
  const article=await one('SELECT a.* FROM knowledge_articles a JOIN knowledge_spaces s ON s.id=a.space_id WHERE a.id=? AND s.workspace_id=?',[positiveId.parse(id),user.workspace_id]);
  if(!article)throw new WorkError(404,'Статья не найдена');
  const access=await knowledgeSpaceAccess(user,article.space_id);
  if(!knowledgeAccessAtLeast(access.level,required)||article.status!=='published'&&!knowledgeAccessAtLeast(access.level,'edit'))throw new WorkError(403,'Нет доступа к статье');
  return {...article,access_level:access.level};
}
export async function saveArticleRevision(c,article,userId){
  await c.query('INSERT IGNORE INTO knowledge_article_revisions(article_id,version_number,title,body,changed_by) VALUES(?,?,?,?,?)',[article.id,article.version_number,article.title,article.body,userId]);
}
export async function knowledgeReviewReminders(){
  await transaction(async c=>{
    const [articles]=await c.query('SELECT * FROM knowledge_articles WHERE steward_id IS NOT NULL AND review_due_date<=CURRENT_DATE AND (review_reminded_date IS NULL OR review_reminded_date<>review_due_date) LIMIT 100 FOR UPDATE SKIP LOCKED');
    for(const a of articles){await createNotification(a.steward_id,'knowledge.review_due','Проверьте актуальность статьи',a.title,'article',a.id,`/?view=knowledge&article=${a.id}`,c);await c.query('UPDATE knowledge_articles SET review_reminded_date=review_due_date WHERE id=?',[a.id]);}
  });
}
export async function knowledgeWorkApi(request,path,user){
  if(path[1]==='stale'&&request.method==='GET')return staleArticles(user);
  const method=request.method,article=await articleFor(user,path[1],method==='GET'||path[2]==='presence'||path[2]==='collaboration'&&path[3]==='sync'?'view':'edit');
  if(['collaboration','restore'].includes(path[2]))return knowledgeCrdtApi(request,path,user,article,saveArticleRevision);
  if(method!=='GET'&&['initialize','blocks'].includes(path[2])&&await one('SELECT article_id FROM knowledge_crdt WHERE article_id=?',[article.id]))throw new WorkError(409,'Используйте совместный редактор текста; абзацный режим отключён');
  if(method==='GET'){
    const [blocks,people,annotations,history]=await Promise.all([
      rows('SELECT * FROM knowledge_blocks WHERE article_id=? AND deleted_at IS NULL ORDER BY position,id',[article.id]),
      rows('SELECT u.id,u.display_name,u.avatar_color FROM knowledge_collaborators c JOIN users u ON u.id=c.user_id WHERE c.article_id=? AND c.seen_at>DATE_SUB(CURRENT_TIMESTAMP,INTERVAL 45 SECOND)',[article.id]),
      rows('SELECT a.*,u.display_name AS author_name FROM knowledge_annotations a JOIN users u ON u.id=a.author_id WHERE article_id=? ORDER BY a.id DESC',[article.id]),
      rows('SELECT r.id,r.version_number,r.created_at,u.display_name AS editor FROM knowledge_article_revisions r JOIN users u ON u.id=r.changed_by WHERE article_id=? ORDER BY version_number DESC LIMIT 100',[article.id])]);
    if(path[2]==='history'&&path[3])return reply(await one('SELECT title,body,version_number,created_at FROM knowledge_article_revisions WHERE article_id=? AND version_number=?',[article.id,positiveId.parse(path[3])]));
    return reply({article,blocks,people,annotations,history});
  }
  if(method==='POST'&&path[2]==='presence'){
    await rows('INSERT INTO knowledge_collaborators(article_id,user_id,seen_at) VALUES(?,?,CURRENT_TIMESTAMP) ON DUPLICATE KEY UPDATE seen_at=CURRENT_TIMESTAMP',[article.id,user.id]);return reply({ok:true});
  }
  if(method==='POST'&&path[2]==='initialize'){
    await transaction(async c=>{
      const [[current]]=await c.query('SELECT * FROM knowledge_articles WHERE id=? FOR UPDATE',[article.id]);
      const [[existing]]=await c.query('SELECT COUNT(*) AS total FROM knowledge_blocks WHERE article_id=?',[article.id]);
      if(existing.total)return;
      const blocks=current.body.split(/\n\s*\n/).filter(Boolean);if(!blocks.length)blocks.push('');
      for(const [index,text]of blocks.entries())await c.query('INSERT INTO knowledge_blocks(id,article_id,position,body,updated_by) VALUES(?,?,?,?,?)',[crypto.randomUUID(),article.id,index*1000,text,user.id]);
    });return reply({ok:true});
  }
  if(['POST','PATCH','DELETE'].includes(method)&&path[2]==='blocks'){
    const d=method==='DELETE'?z.object({revision:positiveId}).parse(await body(request)):z.object({body:z.string().max(100000),revision:positiveId.optional(),after_id:z.string().uuid().nullable().optional()}).parse(await body(request));
    const result=await transaction(async c=>{
      const [[current]]=await c.query('SELECT * FROM knowledge_articles WHERE id=? FOR UPDATE',[article.id]);
      if(path[3]){
        const [[block]]=await c.query('SELECT * FROM knowledge_blocks WHERE id=? AND article_id=? AND deleted_at IS NULL FOR UPDATE',[z.string().uuid().parse(path[3]),article.id]);
        if(!block)throw new WorkError(404,'Блок удалён');if(Number(block.revision)!==Number(d.revision))throw new WorkError(409,'Этот блок уже изменили. Сравните версии перед сохранением',{block});
        if(method==='DELETE')await c.query('UPDATE knowledge_blocks SET deleted_at=CURRENT_TIMESTAMP,revision=revision+1 WHERE id=?',[block.id]);
        else await c.query('UPDATE knowledge_blocks SET body=?,revision=revision+1,updated_by=? WHERE id=?',[d.body,user.id,block.id]);
      }else{
        const [blocks]=await c.query('SELECT id FROM knowledge_blocks WHERE article_id=? AND deleted_at IS NULL ORDER BY position,id',[article.id]);
        const index=d.after_id?blocks.findIndex(b=>b.id===d.after_id)+1:blocks.length;
        if(d.after_id&&!index)throw new WorkError(409,'Исходный блок уже удалён');
        const blockId=crypto.randomUUID();blocks.splice(index,0,{id:blockId});
        await c.query('INSERT INTO knowledge_blocks(id,article_id,position,body,updated_by) VALUES(?,?,?,?,?)',[blockId,article.id,0,d.body,user.id]);
        for(const [i,b]of blocks.entries())await c.query('UPDATE knowledge_blocks SET position=? WHERE id=?',[i*1000,b.id]);
      }
      const [blocks]=await c.query('SELECT * FROM knowledge_blocks WHERE article_id=? AND deleted_at IS NULL ORDER BY position,id',[article.id]);
      const text=blocks.map(b=>b.body).join('\n\n');if(text.length>1000000)throw new WorkError(422,'Статья превышает допустимый размер');
      await saveArticleRevision(c,current,user.id);
      await c.query("UPDATE knowledge_articles SET body=?,version_number=version_number+1,review_status='none',reviewed_version=NULL,status=IF(steward_id IS NULL,status,'draft') WHERE id=?",[text,article.id]);return {blocks,version_number:current.version_number+1};
    });return reply(result);
  }
  if(method==='POST'&&path[2]==='comments'){
    const d=z.object({block_id:z.string().uuid().nullable().default(null),quote_text:z.string().max(2000).default(''),body:z.string().trim().min(1).max(5000)}).parse(await body(request));
    if(d.block_id&&!await one('SELECT id FROM knowledge_blocks WHERE id=? AND article_id=? AND deleted_at IS NULL',[d.block_id,article.id]))throw new WorkError(422,'Блок не найден');
    const created=await rows('INSERT INTO knowledge_annotations(article_id,block_id,quote_text,body,author_id) VALUES(?,?,?,?,?)',[article.id,d.block_id,d.quote_text,d.body,user.id]);return reply({id:created.insertId},201);
  }
  if(method==='PATCH'&&path[2]==='comments'){
    const d=z.object({resolved:z.boolean()}).parse(await body(request));await rows('UPDATE knowledge_annotations SET resolved_at=? WHERE id=? AND article_id=?',[d.resolved?new Date():null,positiveId.parse(path[3]),article.id]);return reply({ok:true});
  }
  if(method==='PATCH'&&path[2]==='review'){
    const d=z.object({action:z.enum(['configure','request','approve','reject','publish']),version_number:positiveId,steward_id:positiveId.nullable().optional(),review_due_date:dateOnly.nullable().optional()}).parse(await body(request));
    if(['configure','approve','reject','publish'].includes(d.action)&&!knowledgeAccessAtLeast(article.access_level,'admin')&&Number(article.steward_id)!==Number(user.id))throw new WorkError(403,'Требуются права ответственного или администратора пространства');
    if(d.steward_id){await validUsers(user,[d.steward_id]);const target=await one('SELECT * FROM users WHERE id=?',[d.steward_id]);const access=await knowledgeSpaceAccess(target,article.space_id);if(!knowledgeAccessAtLeast(access.level,'edit'))throw new WorkError(422,'Ответственный должен иметь доступ к редактированию статьи');}
    await transaction(async c=>{
      const [[current]]=await c.query('SELECT * FROM knowledge_articles WHERE id=? FOR UPDATE',[article.id]);if(current.version_number!==d.version_number)throw new WorkError(409,'Статья изменилась, обновите её перед принятием решения');
      if(['configure','approve','reject','publish'].includes(d.action)&&!knowledgeAccessAtLeast(article.access_level,'admin')&&Number(current.steward_id)!==Number(user.id))throw new WorkError(403,'Ответственный изменён другим пользователем');
      if(d.action==='configure')await c.query("UPDATE knowledge_articles SET steward_id=?,review_due_date=?,review_status='none',reviewed_version=NULL WHERE id=?",[d.steward_id??null,d.review_due_date??null,article.id]);
      if(d.action==='request'){
        if(!current.steward_id)throw new WorkError(422,'Назначьте ответственного за статью');
        await c.query("UPDATE knowledge_articles SET review_status='pending',reviewed_version=NULL WHERE id=?",[article.id]);
        await createNotification(current.steward_id,'knowledge.review','Статья ждёт проверки',current.title,'article',article.id,`/?view=knowledge&article=${article.id}`,c);
      }
      if(['approve','reject'].includes(d.action)){
        if(current.review_status!=='pending')throw new WorkError(409,'Статья не ожидает согласования');
        await c.query('UPDATE knowledge_articles SET review_status=?,reviewed_by=?,reviewed_version=? WHERE id=?',[d.action==='approve'?'approved':'rejected',user.id,current.version_number,article.id]);
      }
      if(d.action==='publish'){
        if(current.review_status!=='approved'||current.reviewed_version!==current.version_number)throw new WorkError(409,'Сначала согласуйте текущую версию');
        await c.query("UPDATE knowledge_articles SET status='published',published_at=CURRENT_TIMESTAMP WHERE id=?",[article.id]);
      }
    });return reply({ok:true});
  }
  throw new WorkError(404,'Метод совместного редактирования не найден');
}
