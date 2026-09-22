import test from 'node:test';
import assert from 'node:assert/strict';
import {load} from './test-module-loader.mjs';
import {unitVector,cosine,vectorBuckets,neighboringBuckets,semanticChunks,semanticHash} from '../src/lib/semantic-vectors.js';
test('semantic vectors reject invalid provider output and preserve cosine and stable buckets',()=>{
 for(const value of [[],Array(32).fill(0),Array(32).fill(Infinity),Array(32).fill('1')])assert.throws(()=>unitVector(value));
 const v=unitVector(Array(32).fill(2));assert.ok(Math.abs(cosine(v,v)-1)<1e-10);assert.equal(cosine(v,[1]),-1);assert.deepEqual(vectorBuckets(v),vectorBuckets(unitVector(Array(32).fill(5))));assert.equal(neighboringBuckets(v).length,8);assert.equal(new Set(neighboringBuckets(v)[0].values).size,9);
 const chunks=semanticChunks('x'.repeat(200000));assert.ok(chunks.every(c=>c.text.length<=4000));assert.equal(chunks.at(-1).start+chunks.at(-1).text.length,128000);
});
test('embedding responses are reordered by index and duplicates and mixed dimensions are refused',async()=>{
 const m=await load('semantic-embeddings.js');const vector=Array(32).fill(1),larger=Array(64).fill(1);
 assert.equal(m.parseEmbeddings({data:[{index:1,embedding:vector},{index:0,embedding:vector}]},2).length,2);
 assert.throws(()=>m.parseEmbeddings({data:[{index:0,embedding:vector},{index:0,embedding:vector}]},2));
 assert.throws(()=>m.parseEmbeddings({data:[{index:0,embedding:vector},{index:1,embedding:larger}]},2));
});
test('semantic search excludes forbidden and stale documents and checks winning source again',async()=>{
 const v=unitVector(Array(32).fill(1)),hash=semanticHash('current'),calls=new Map();const user={id:1,workspace_id:1};
 const m=await load('work-semantic.js',{
  'db.js':{one:async sql=>sql.includes('semantic_settings')?{enabled:true,model:'embedding',profile_id:'p',revision:1}:user,rows:async()=>[1,2,3].map(id=>({source_id:id,kind:'task',content_hash:id===3?'old':hash,vector_encrypted:JSON.stringify(v),chunk_start:0,chunk_length:7}))},
  'ai-settings.js':{getAiSettings:async()=>({enabled:true,profiles:[{id:'p',revision:'r',enabled:true}]})},
  'permissions.js':{projectPermissionSet:async()=>new Set(),workspacePermissionSet:async()=>new Set(['ai.search'])},
  'api-access.js':{apiBackgroundAllowed:async()=>true},'semantic-embeddings.js':{embedTexts:async()=>[v]},'crypto.js':{decryptSecret:x=>x,encryptSecret:x=>x},
  'semantic-sources.js':{SEMANTIC_KINDS:['task','knowledge','recording'],SEMANTIC_SCOPES:{task:'tasks:read'},nextSemanticSource:async()=>null,semanticSource:async(_u,_k,id)=>{calls.set(id,(calls.get(id)||0)+1);if(id===2)throw Object.assign(new Error('forbidden'),{status:403});return {hash,title:'Allowed',text:'current',url:'/?task=1'};}}
 });
 const r=await m.semanticApi(new Request('https://kontur.test/api/work/semantic/search',{method:'POST',body:JSON.stringify({query:'meaning',kinds:['task']})}),['semantic','search'],user);const result=await r.json();assert.deepEqual(result.results.map(r=>r.id),[1]);assert.equal(calls.get(1),2);assert.equal(calls.get(2),1);
});
