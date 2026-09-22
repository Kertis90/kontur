import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {load} from './test-module-loader.mjs';
import {apiRequestError} from '../src/lib/api-access.js';
const exec=promisify(execFile),user={id:2,workspace_id:1},conference={id:10,workspace_id:1,project_id:7,created_by:1,status:'live',captions_enabled:true,conference_mode:'interactive'},client_id='37030f88-64f6-4bfa-bd36-04a286773bf0';
const permissions={hasProjectPermission:async()=>false,projectPermissionSet:async()=>new Set(),workspacePermissionSet:async()=>new Set()};
test('caption chunks validate base64 and unique request IDs',async()=>{const m=await load('conference-captions.js');const valid={client_id,mime_type:'audio/wav',audio_base64:'AQIDBA=='};assert.equal(m.captionChunkSchema.safeParse(valid).success,true);for(const patch of [{client_id:'reuse'},{audio_base64:'***'},{audio_base64:'A'}])assert.equal(m.captionChunkSchema.safeParse({...valid,...patch}).success,false);});
test('caption conversion decodes real audio and rejects oversized duration and disguised playlists',async()=>{
 const {normalizeCaptionAudio}=await load('caption-audio.js');
 for(const [format,codec,mime]of [['webm','libopus','audio/webm;codecs=opus'],['wav','pcm_s16le','audio/wav'],['ogg','libopus','audio/ogg']]){const {stdout}=await exec('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','sine=frequency=600:duration=1','-c:a',codec,'-f',format,'pipe:1'],{encoding:'buffer',maxBuffer:1000000});const r=await normalizeCaptionAudio(stdout,mime);assert.ok(r.duration>.95&&r.duration<1.1);assert.equal(r.buffer.subarray(0,4).toString(),'RIFF');}
 const {stdout}=await exec('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','anullsrc=r=16000:cl=mono','-t','13','-f','wav','pipe:1'],{encoding:'buffer',maxBuffer:1000000});await assert.rejects(normalizeCaptionAudio(stdout,'audio/wav'),e=>e.status===422);
 await assert.rejects(normalizeCaptionAudio(Buffer.from('#EXTM3U\nhttps://example.test/audio.ts'),'audio/webm'),e=>e.status===422);
});
test('caption API tokens require both conference write and AI write',()=>{const request=new Request('https://example.test/api/work/conference-captions/10/chunks',{method:'POST'}),actor={...user,api_token_id:7,api_enabled:true,allowed_scopes_json:['conference:write','ai:write'],scopes_json:['conference:write']};assert.match(apiRequestError(actor,request),/ai:write/);assert.equal(apiRequestError({...actor,scopes_json:['conference:write','ai:write']},request),null);});
test('a conference invitation alone cannot start microphone transcription',async()=>{
 const m=await load('conference-captions.js',{'recordings.js':{recordingConferenceAccess:async()=>conference},'permissions.js':permissions,'db.js':{one:async()=>({...user,status:'active'})}});
 await assert.rejects(m.conferenceCaptionsApi(new Request('https://example.test/api/work/conference-captions/10/chunks',{method:'POST',body:JSON.stringify({client_id,mime_type:'audio/wav',audio_base64:'AQIDBA=='})}),['conference-captions','10','chunks'],user),e=>e.status===403);
});
test('caption reservations enforce user/workspace time, load and pacing before provider calls',async()=>{
 let usage={workspace_seconds:0,user_seconds:0,pending:0,recent:0},written=0;
 const m=await load('conference-captions.js',{'db.js':{transaction:async f=>f({query:async sql=>{if(sql.includes('SELECT id FROM workspaces'))return [[]];if(sql.startsWith('SELECT id,payload_hash'))return [[]];if(sql.includes('SUM(reserved_seconds)'))return [[usage]];written++;return [{insertId:1}];}})}});
 const speech={caption_user_minutes:1,caption_workspace_minutes:2,caption_concurrency:2},run=()=>m.reserveCaption(user,conference,{client_id},'hash',speech);
 await run();assert.equal(written,1);for(const patch of [{user_seconds:49},{workspace_seconds:109},{pending:2},{recent:1}]){usage={workspace_seconds:0,user_seconds:0,pending:0,recent:0,...patch};await assert.rejects(run(),e=>e.status===429);}assert.equal(written,1);
});
test('completed caption retries are cached and conflicting or pending requests cannot repeat recognition',async()=>{
 let saved={id:8,payload_hash:'hash',status:'completed',text:'Решение принято'};
 const m=await load('conference-captions.js',{'db.js':{transaction:async f=>f({query:async sql=>{if(sql.includes('SELECT id FROM workspaces'))return [[]];if(sql.startsWith('SELECT id,payload_hash'))return [[saved]];throw Error('No additional reservation expected');}})}});
 const run=hash=>m.reserveCaption(user,conference,{client_id},hash,{});assert.equal((await run('hash')).text,'Решение принято');await assert.rejects(run('different'),e=>e.status===409);saved={...saved,status:'processing'};await assert.rejects(run('hash'),e=>e.status===409);
});
test('waiting visitors see no captions until admitted',async()=>{
 let reads=0;const m=await load('conference-captions.js',{'recordings.js':{recordingConferenceAccess:async()=>({...conference,waiting_room:true})},'permissions.js':permissions,'ai-settings.js':{getAiSettings:async()=>({speech:{enabled:true,live_captions:true}}),aiProfileKey:()=>''},'db.js':{one:async()=>({status:'waiting'}),rows:async()=>{reads++;return [];}}});const r=await m.conferenceCaptionsApi(new Request('https://example.test/api/work/conference-captions/10'),['conference-captions','10'],user);assert.equal((await r.json()).items.length,0);assert.equal(reads,0);
});
