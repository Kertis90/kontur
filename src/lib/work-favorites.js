import {z} from 'zod';
import {one,rows,transaction,parseJson} from './db.js';
import {body,reply,positiveId,projectFor,WorkError} from './work-common.js';
import {planAccess} from './work-plans.js';
import {knowledgeSpaceAccess,knowledgeAccessAtLeast} from './knowledge-access.js';
import {apiBackgroundAllowed} from './api-access.js';
const kind=z.enum(['project','board','plan','article']);
export const favoritesSchema=z.object({revision:z.number().int().min(0),items:z.array(z.object({kind,id:positiveId}).strict()).max(30).refine(items=>new Set(items.map(i=>`${i.kind}:${i.id}`)).size===items.length,'Ссылки не должны повторяться')}).strict();
// Возвращает название и адрес только после актуальной проверки исходного объекта.
export async function favoriteFor(user,item){
 const scope=item.kind==='plan'?'planning:read':item.kind==='article'?'knowledge:read':'projects:read';
 if(!await apiBackgroundAllowed(user,user.api_token_id,scope))throw new WorkError(403,'Нет доступа к разделу');
 if(['project','board'].includes(item.kind)){const p=await projectFor(user,item.id);return {...item,title:p.name,href:`/?view=${item.kind==='board'?'board':'dashboard'}&project=${p.id}`};}
 if(item.kind==='plan'){const p=await planAccess(user,await one('SELECT * FROM work_plans WHERE id=? AND workspace_id=?',[item.id,user.workspace_id]));return {...item,title:p.title,href:`/?view=work&tab=plans&plan=${p.id}`};}
 const article=await one('SELECT a.id,a.title,a.status,a.space_id FROM knowledge_articles a JOIN knowledge_spaces s ON s.id=a.space_id WHERE a.id=? AND s.workspace_id=?',[item.id,user.workspace_id]);
 if(!article)throw new WorkError(404,'Статья не найдена');
 const access=await knowledgeSpaceAccess(user,article.space_id);
 if(!knowledgeAccessAtLeast(access.level,article.status==='published'?'view':'edit'))throw new WorkError(403,'Статья недоступна');
 return {...item,title:article.title,href:`/?view=knowledge&article=${article.id}`};
}
// Скрывает отозванные ссылки без раскрытия названий и количества недоступных объектов.
async function visibleFavorites(user,items){const visible=[];for(const item of items){try{visible.push(await favoriteFor(user,item));}catch(e){if(![403,404].includes(e.status))throw e;}}return visible;}
// Хранит упорядоченное избранное пользователя и подбирает только доступные ссылки.
export async function favoritesApi(request,path,user){
 if(path.length===2&&path[1]==='choices'&&request.method==='GET'){
  const params=new URL(request.url).searchParams,type=kind.parse(params.get('kind')||'project'),query=z.string().max(180).parse(params.get('q')||''),search=`%${query.replace(/[\\%_]/g,'\\$&')}%`;
  let candidates;
  if(['project','board'].includes(type))candidates=await rows('SELECT id FROM projects WHERE workspace_id=? AND deleted_at IS NULL AND name LIKE ? ORDER BY name LIMIT 200',[user.workspace_id,search]);
  else if(type==='plan')candidates=await rows('SELECT id FROM work_plans WHERE workspace_id=? AND archived=FALSE AND title LIKE ? ORDER BY updated_at DESC LIMIT 200',[user.workspace_id,search]);
  else candidates=await rows('SELECT a.id FROM knowledge_articles a JOIN knowledge_spaces s ON s.id=a.space_id WHERE s.workspace_id=? AND a.title LIKE ? ORDER BY a.title LIMIT 200',[user.workspace_id,search]);
  return reply({items:(await visibleFavorites(user,candidates.map(i=>({kind:type,id:i.id})))).slice(0,50)});
 }
 if(path.length!==1)throw new WorkError(404,'Метод избранного не найден');
 if(request.method==='GET'){const stored=await one('SELECT * FROM user_favorites WHERE user_id=?',[user.id]);return reply({revision:stored?.revision||0,items:await visibleFavorites(user,parseJson(stored?.items_json,[]))});}
 if(request.method==='PUT'){
  const data=favoritesSchema.parse(await body(request));
  return transaction(async c=>{await c.query('SELECT id FROM users WHERE id=? AND workspace_id=? FOR UPDATE',[user.id,user.workspace_id]);const [[old]]=await c.query('SELECT revision FROM user_favorites WHERE user_id=?',[user.id]);if(Number(old?.revision||0)!==data.revision)throw new WorkError(409,'Избранное изменилось на другом устройстве. Обновите список');
   const items=[];for(const item of data.items)items.push(await favoriteFor(user,item));
   await c.query('INSERT INTO user_favorites(user_id,items_json) VALUES(?,?) ON DUPLICATE KEY UPDATE items_json=VALUES(items_json),revision=revision+1',[user.id,JSON.stringify(data.items)]);return reply({revision:data.revision+1,items});
  });
 }
 throw new WorkError(404,'Метод избранного не найден');
}
