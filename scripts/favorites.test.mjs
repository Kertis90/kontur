import test from 'node:test';
import assert from 'node:assert/strict';
import {load} from './test-module-loader.mjs';
const user={id:1,workspace_id:1};
// Подменяет только инфраструктуру и сохраняет реальную проверку типов и маршрутов.
async function favorites(overrides={}){return load('work-favorites.js',{'work-plans.js':{planAccess:async(u,p)=>{if(!p)throw Object.assign(new Error('Нет плана'),{status:404});return p;}},'api-access.js':{apiBackgroundAllowed:async()=>true},'knowledge-access.js':{knowledgeSpaceAccess:async()=>({level:'none'}),knowledgeAccessAtLeast:()=>false},...overrides});}
test('избранное скрывает отозванный доступ, не раскрывая сохранённое название',async()=>{
 const {favoritesApi}=await favorites({'db.js':{one:async sql=>sql.includes('user_favorites')?{revision:4,items_json:[{kind:'project',id:2},{kind:'plan',id:3}]}:null}});
 const response=await favoritesApi(new Request('http://local/api/work/favorites'),['favorites'],user);
 assert.deepEqual(await response.json(),{revision:4,items:[]});
});
test('права API на исходный раздел проверяются даже у сохранённой ссылки',async()=>{
 let reads=0;const {favoriteFor}=await favorites({'api-access.js':{apiBackgroundAllowed:async()=>false},'db.js':{one:async()=>{reads++;return {id:2};}}});
 await assert.rejects(()=>favoriteFor(user,{kind:'plan',id:2}),{status:403});assert.equal(reads,0);
});
test('дубликаты и неизвестные типы отклоняются, порядок разных ссылок сохраняется',async()=>{
 const {favoritesSchema}=await favorites();assert.equal(favoritesSchema.safeParse({revision:0,items:[{kind:'project',id:1},{kind:'project',id:1}]}).success,false);
 assert.equal(favoritesSchema.safeParse({revision:0,items:[{kind:'secret',id:1}]}).success,false);
 const data=favoritesSchema.parse({revision:0,items:[{kind:'board',id:1},{kind:'project',id:1}]});assert.equal(data.items[0].kind,'board');
});
test('конфликт версии не записывает устаревшее избранное',async()=>{
 let writes=0;const {favoritesApi}=await favorites({'db.js':{transaction:async fn=>fn({query:async sql=>{if(sql.includes('SELECT revision'))return [[{revision:3}]];if(sql.startsWith('INSERT'))writes++;return [[]];}})}});
 await assert.rejects(()=>favoritesApi(new Request('http://local/api/work/favorites',{method:'PUT',body:JSON.stringify({revision:2,items:[]})}),['favorites'],user),{status:409});assert.equal(writes,0);
});
