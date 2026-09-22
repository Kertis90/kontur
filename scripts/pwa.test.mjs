import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import {mergeChatMessages,atChatBottom} from '../src/lib/chat-client.js';
const source=await fs.readFile(new URL('../public/sw.js',import.meta.url),'utf8');
function fixture(options={}){
 const handlers={},shown=[],opened=[],deleted=[],put=[],waits=[];
 const caches={open:async()=>({addAll:async()=>{},put:async(...args)=>put.push(args)}),keys:async()=>['kontur-shell-v9','kontur-shell-v10','another-app'],delete:async key=>deleted.push(key),match:async key=>options.cached?.[typeof key==='string'?key:new URL(key.url).pathname]};
 const self={location:{origin:'https://kontur.test'},addEventListener:(name,fn)=>handlers[name]=fn,skipWaiting:async()=>{},registration:{showNotification:async(...args)=>shown.push(args)},clients:{claim:async()=>{},matchAll:async()=>options.clients||[],openWindow:async url=>opened.push(url)}};
 vm.runInNewContext(source,{self,caches,URL,Response,fetch:options.fetch||(async()=>{throw new Error('offline');})});
 return {shown,opened,deleted,put,async dispatch(name,event={}){let response;handlers[name]({...event,waitUntil:p=>waits.push(p),respondWith:p=>response=p});const value=await response;await Promise.all(waits);return value;}};
}
test('offline navigation can use shell; missing JS never receives HTML',async()=>{
 const f=fixture({cached:{'/':new Response('<html>shell</html>',{headers:{'content-type':'text/html'}})}});
 const nav=await f.dispatch('fetch',{request:{url:'https://kontur.test/?view=chat',method:'GET',mode:'navigate'}});assert.equal(await nav.text(),'<html>shell</html>');
 const js=await f.dispatch('fetch',{request:{url:'https://kontur.test/_next/static/missing.js',method:'GET',mode:'same-origin'}});assert.equal(js.type,'error');
});
test('service worker never intercepts API, private exports, uploads, cross-origin requests or writes',async()=>{
 const f=fixture();
 for(const [url,method] of [['https://kontur.test/api/bootstrap','GET'],['https://kontur.test/private/file','GET'],['https://storage.test/file','GET'],['https://kontur.test/','POST']]) assert.equal(await f.dispatch('fetch',{request:{url,method,mode:'same-origin'}}),undefined);
 await f.dispatch('activate');assert.deepEqual(f.deleted,['kontur-shell-v9']);
});
test('push payload cannot inject message text or an external destination',async()=>{
 const f=fixture();await f.dispatch('push',{data:{json:()=>({title:'evil',body:'private message',url:'https://evil.test',tag:'arbitrary'})}});
 assert.equal(f.shown[0][0],'Контур');assert.equal(f.shown[0][1].body,'Есть новые сообщения или уведомления');assert.equal(f.shown[0][1].data.url,'/');
 await f.dispatch('notificationclick',{notification:{close(){},data:{url:'//evil.test'}}});assert.deepEqual(f.opened,['/']);
});
test('notification click focuses an existing workspace and routes to the exact channel',async()=>{
 const messages=[];let focused=0,closed=0;
 const f=fixture({clients:[{url:'https://kontur.test/',focus:async()=>focused++,postMessage:message=>messages.push(message)}]});
 await f.dispatch('notificationclick',{notification:{close:()=>closed++,data:{url:'/?view=chat&channel=123'}}});
 assert.equal(closed,1);assert.equal(focused,1);assert.equal(messages[0].url,'/?view=chat&channel=123');assert.equal(f.opened.length,0);
});
test('chat merge preserves older history and orders overlapping pages without duplicate messages',()=>{
 const value=mergeChatMessages([{id:4,body:'old'},{id:9}], [{id:2},{id:4,body:'updated'},{id:10}]);
 assert.deepEqual(value.map(m=>m.id),[2,4,9,10]);assert.equal(value[1].body,'updated');
 assert.equal(atChatBottom({scrollHeight:1000,scrollTop:0,clientHeight:500}),false);
 assert.equal(atChatBottom({scrollHeight:1000,scrollTop:500,clientHeight:500}),true);
 assert.equal(atChatBottom(null),false);
});
