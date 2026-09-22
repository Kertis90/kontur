import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import crypto from "node:crypto";
import * as adapter from "../src/lib/ai-client.js";
import * as sdk from "livekit-server-sdk";

const parseJson = (value, fallback = {}) => typeof value === "string" ? JSON.parse(value) : value ?? fallback;
const fail = async () => { throw new Error("Unexpected infrastructure operation"); };
async function load(name, overrides = {}, env = {}, globals = {}) {
  const context = vm.createContext({ console, Buffer, URL, URLSearchParams, Request, Response, Headers, FormData, Blob, TextEncoder, TextDecoder, ReadableStream, AbortSignal, AbortController, Date, setTimeout, clearTimeout, setInterval, clearInterval, process: { env }, fetch: fail, ...globals });
  const modules = new Map();
  const stubs = { "db.js": { one: fail, rows: fail, transaction: fail, db: { query: fail }, parseJson }, "audit.js": { audit: async () => {} }, ...overrides };
  stubs["db.js"]={one:fail,rows:fail,transaction:fail,db:{query:fail},parseJson,...overrides["db.js"]};
  function synthetic(values, identifier) { return new vm.SyntheticModule(Object.keys(values), function () { for (const [key,value] of Object.entries(values)) this.setExport(key,value); }, { context, identifier }); }
  async function moduleFor(identifier) {
    if (modules.has(identifier)) return modules.get(identifier);
    const base = identifier.split("/").at(-1);
    let module;
    if (stubs[identifier] || stubs[base]) module = synthetic(stubs[identifier] || stubs[base], identifier);
    else if (!identifier.startsWith("file:")) module = synthetic(await import(identifier), identifier);
    else module = new vm.SourceTextModule(await fs.readFile(new URL(identifier), "utf8"), { context, identifier });
    modules.set(identifier, module); return module;
  }
  const root = await moduleFor(new URL(`../src/lib/${name}`, import.meta.url).href);
  await root.link((specifier, referencing) => moduleFor(specifier.startsWith(".") ? new URL(specifier.endsWith(".js") ? specifier : `${specifier}.js`, referencing.identifier).href : specifier));
  await root.evaluate(); return root.namespace;
}
const profile = { id: crypto.randomUUID(), name: "Локальная модель", base_url: "http://llm.test/v1", enabled: true, protocol: "chat_completions", model: "test-model", token_parameter: "max_completion_tokens", max_output_tokens: 1000, max_input_chars: 4000, temperature: null, timeout_seconds: 30, instructions: "", revision: "v1" };

test("AI adapters honor both protocols and do not send unspecified temperature", async () => {
  let observed;
  const fetcher = async (url, options) => { observed = { url, ...options, body: JSON.parse(options.body) }; return Response.json({ choices: [{ message: { content: "Итог" }, finish_reason: "stop" }], usage: { prompt_tokens: 12, completion_tokens: 4 } }); };
  const result = await adapter.generateAiText(profile,"secret","system","data",fetcher);
  assert.equal(result.text,"Итог"); assert.equal(result.input_tokens,12);
  assert.equal(observed.url,"http://llm.test/v1/chat/completions");
  assert.equal(observed.body.max_completion_tokens,1000); assert.equal(Object.hasOwn(observed.body,"temperature"),false);
  assert.equal(observed.redirect,"error"); assert.equal(observed.headers.Authorization,"Bearer secret");
  const response = await adapter.generateAiText({ ...profile, protocol: "responses" },"","system","data",async (url, options) => {
    const body = JSON.parse(options.body); assert.ok(url.endsWith("/responses")); assert.equal(body.store,false); assert.equal(body.max_output_tokens,1000); assert.equal(options.headers.Authorization,undefined);
    return Response.json({ status: "incomplete", output: [{ type:"message", content:[{type:"output_text",text:"Часть ответа"}]}] });
  });
  assert.equal(response.incomplete,true);
});

test("AI errors never echo provider secrets or submitted data", async () => {
  await assert.rejects(adapter.generateAiText(profile,"private-key","s","sensitive-project",async () => new Response("private-key sensitive-project",{status:401})),(error) => error.status === 502 && !/private-key|sensitive-project/.test(error.message));
  await assert.rejects(adapter.generateAiText(profile,"","s","d",async () => Response.json({choices:[]})),/не вернула текст/);
  await assert.rejects(adapter.listAiModels(profile,"",async () => Response.json({models:[]})),/введите модель вручную/);
  assert.deepEqual(await adapter.listAiModels(profile,"",async () => Response.json({data:[{id:"b"},{id:"a"},{id:"a"}]})),["a","b"]);
});

test("endpoint validation rejects metadata, URL credentials, redirects and full method URLs", () => {
  for (const url of ["file:///etc/passwd","http://169.254.169.254/v1","http://metadata.google.internal/v1","https://user:pass@llm.test/v1","https://llm.test/v1?key=secret","https://llm.test/v1/chat/completions"])
    assert.throws(() => adapter.normalizeAiBaseUrl(url), adapter.AiError);
  assert.equal(adapter.normalizeAiBaseUrl("http://10.0.0.7:11434/v1/"),"http://10.0.0.7:11434/v1");
});

test("settings strip both LLM and speech encrypted keys", async () => {
  const settings = await load("ai-settings.js");
  const result = settings.publicAiSettings({ profiles:[{id:"1",name:"Model",api_key_encrypted:"encrypted-key"}],speech:{api_key_encrypted:"encrypted-speech",model:"whisper"} });
  assert.equal(result.profiles[0].api_key_encrypted,undefined); assert.equal(result.profiles[0].api_key_configured,true);
  assert.equal(result.speech.api_key_encrypted,undefined); assert.equal(result.speech.api_key_configured,true);
  assert.equal(JSON.stringify(result).includes("encrypted-"),false);
});

async function permissionsFixture({ membership = null, groupRole = null, decisions = [], project = { id:7,workspace_id:1,group_id:null }, token = null } = {}) {
  return load("permissions.js", { "db.js": { parseJson, one: async (sql) => sql.includes("project_members") ? membership && {project_role:membership} : project, rows: async (sql) => {
    if (sql.includes("FROM project_access_requests")) return [];
    if (sql.includes("FROM access_assignments")) return decisions;
    if (sql.includes("FROM project_group_access")) return groupRole ? [{project_role:groupRole}] : [];
    if (sql.includes("SELECT DISTINCT id, code, name")) return groupRole ? [{id:3,code:"team",name:"Команда"}] : [];
    if (sql.includes("FROM permission_schemes")) return [];
    throw new Error(sql);
  } } });
}
const user = {id:2,workspace_id:1,global_role:"member",email:"member@test"};
test("group grants work without direct membership; an explicit deny wins", async () => {
  const normal = await permissionsFixture({groupRole:"member"});
  const allowed = await normal.projectPermissionSet(user,7);
  assert.ok(allowed.has("project.browse")); assert.ok(allowed.has("task.edit")); assert.equal(allowed.has("project.delete"),false);
  const denied = await permissionsFixture({groupRole:"manager",decisions:[{permission_key:"project.delete",effect:"deny"}]});
  const permissions = await denied.projectPermissionSet(user,7); assert.ok(permissions.has("project.edit")); assert.equal(permissions.has("project.delete"),false);
  const browseDenied = await permissionsFixture({groupRole:"manager",decisions:[{permission_key:"project.browse",effect:"deny"}]});
  assert.equal((await browseDenied.projectPermissionSet(user,7)).size,0);
});

test("administrators keep full access, but deleted and foreign projects stay closed", async () => {
  const normal = await permissionsFixture();
  const admin = { ...user, global_role:"admin" };
  const keys = await normal.projectPermissionSet(admin,7);
  for (const key of ["project.access.manage","project.delete","conference.record","conference.recording.view","ai.conference.summarize"]) assert.ok(keys.has(key),key);
  const deleted = await permissionsFixture({project:{id:7,workspace_id:1,deleted_at:"2026-09-08"}});
  assert.equal((await deleted.projectPermissionSet(admin,7)).size,0);
  assert.ok((await deleted.projectPermissionSet(admin,7,null,true)).has("project.delete"));
  const foreign = await permissionsFixture({project:{id:7,workspace_id:99}}); assert.equal((await foreign.projectPermissionSet(admin,7)).size,0);
});

test("delegated project access cannot grant a more powerful role or remove the last manager", async () => {
  const perms = await permissionsFixture({membership:"member"});
  const own = await perms.projectPermissionSet(user,7); own.add("project.access.manage");
  const granted = [];
  const module = await load("project-access.js", { "permissions.js": { projectPermissionSet:async () => own, hasWorkspacePermission:async () => false, PERMISSION_CATALOG:perms.PERMISSION_CATALOG, PROJECT_MEMBERSHIP_DEFAULTS:perms.PROJECT_MEMBERSHIP_DEFAULTS }, "db.js": { parseJson,one:async () => ({id:7,workspace_id:1}),rows:fail,transaction:async (work) => work({query:async (sql) => { if(sql.includes("project_role='manager'")) return [[{user_id:2}]]; if(sql.startsWith("SELECT")) return [[{id:7}]]; granted.push(sql); return [{affectedRows:1}]; }}) } });
  assert.equal(module.grantableProjectRoles(own).some((role) => role.key === "manager"),false);
  await assert.rejects(module.changeProjectAccess(user,7,{principal_type:"user",principal_id:3,project_role:"manager"}), (error) => error.status === 403);
  await assert.rejects(module.removeProjectAccess(user,7,"user",2), (error) => error.status === 409);
  assert.equal(granted.length,0);
});

test("API AI scope is separate from conference writes and is rechecked after revocation", async () => {
  let token = {enabled:true,scopes_json:["ai:write"],allowed_scopes_json:["ai:write"]};
  const access = await load("api-access.js", {"db.js":{one:async () => token,parseJson}});
  const caller = {...user,api_token_id:4,api_enabled:true,scopes_json:["conference:write"],allowed_scopes_json:["conference:write","ai:write"]};
  assert.match(access.apiRequestError(caller,new Request("https://test/api/conferences/10/recordings/1/transcribe",{method:"POST"})),/ai:write/);
  assert.equal(await access.apiBackgroundAllowed(user,4,"ai:write"),true); token=null;
  assert.equal(await access.apiBackgroundAllowed(user,4,"ai:write"),false);
});

test("long meeting summaries include all parts and retain provenance", async () => {
  const ai = await load("ai-service.js");
  const records = Array.from({length:8},(_,i) => ({start_seconds:i*600,text:`ФРАГМЕНТ_${i} `+"факты ".repeat(600)}));
  const seen = [];
  const result = await ai.generateSourceSummary(profile,"",{recording_id:1,job_type:"conference",instructions:""},{records,conference:{title:"Большая встреча"}},async () => {},async (_profile,_key,system,input) => {
    seen.push(input); assert.match(system,/расшифровке аудиозаписи/);
    return {text:"Решение по фрагменту; открытый вопрос.",input_tokens:100,output_tokens:20,incomplete:false};
  });
  for (let i=0;i<8;i++) assert.ok(seen.some((input) => input.includes(`ФРАГМЕНТ_${i}`)),`missing part ${i}`);
  assert.equal(result.input_tokens,seen.length*100); assert.ok(seen.length>2); assert.equal(result.incomplete,false);
  const budgeted = ai.boundedAiContext({source:"test"},[{text:"first"},{text:"x".repeat(300)}],90);
  assert.equal(budgeted.included,1); assert.doesNotThrow(() => JSON.parse(JSON.stringify(budgeted.input)));
});

test("AI requests are idempotent and share cached results only for matching source data", async () => {
  const jobs=[]; let sequence=0;
  const database={parseJson,db:{query:fail},one:async(sql)=>sql.includes("FROM projects")?{id:7,workspace_id:1,key_code:"PROD",name:"Проект"}:{tasks:1,completed:0},rows:async()=>[{id:1,task_number:1,title:"Задача",is_done:false}],transaction:async(work)=>work({query:async(sql,args=[])=>{
    if(sql.includes("FOR UPDATE"))return [[{id:1}]];
    if(sql.includes("requested_by=? AND request_id=?"))return [jobs.filter((job)=>job.request_id===args[2])];
    if(sql.includes("AND cache_key=?"))return [jobs.filter((job)=>job.cache_key===args[1])];
    if(sql.includes("COUNT(*) AS value") || sql.includes("FROM work_ai_requests"))return [[{value:0}]];
    if(sql.startsWith("INSERT INTO ai_jobs")) { const job={id:++sequence,workspace_id:args[0],project_id:args[1],conference_id:args[2],job_type:args[3],requested_by:args[4],request_id:args[5],cache_key:args[6],profile_id:args[7],instructions:args[11],source_meta_json:args[13],status:"queued"};jobs.push(job);return [{insertId:job.id}]; }
    if(sql.includes("FROM ai_jobs WHERE id=?"))return [jobs.filter((job)=>job.id===args[0])];
    throw new Error(sql);
  }})};
  const ai=await load("ai-service.js",{"db.js":database,"permissions.js":{hasProjectPermission:async()=>true,projectPermissionSet:async()=>new Set(),workspacePermissionSet:async()=>new Set(),hasWorkspacePermission:async()=>false},"ai-settings.js":{getAiSettings:async()=>({enabled:true,daily_user_limit:30,profiles:[profile]}),chooseAiProfile:()=>profile,aiProfileKey:()=>""}});
  const data={request_id:crypto.randomUUID(),instructions:"Риски",regenerate:false};
  const first=await ai.createAiJob(user,"project",7,data); assert.equal(first.cached,false);
  const retry=await ai.createAiJob(user,"project",7,data); assert.equal(retry.job.id,first.job.id);
  const shared=await ai.createAiJob(user,"project",7,{...data,request_id:crypto.randomUUID()}); assert.equal(shared.cached,true);assert.equal(shared.job.id,first.job.id);
  await assert.rejects(ai.createAiJob(user,"project",7,{...data,instructions:"Другое"}),(error)=>error.status===409);
  const fresh=await ai.createAiJob(user,"project",7,{...data,request_id:crypto.randomUUID(),regenerate:true});assert.notEqual(fresh.job.id,first.job.id);assert.equal(jobs.length,2);
});

test("a user who can see chat summaries cannot see a recording summary without recording access", async () => {
  let queried;
  const ai = await load("ai-service.js", {"permissions.js":{hasProjectPermission:async (_u,_p,key) => key !== "conference.recording.view",projectPermissionSet:async()=>new Set(),workspacePermissionSet:async()=>new Set(),hasWorkspacePermission:async()=>false},"ai-settings.js":{getAiSettings:async () => ({enabled:true,profiles:[]}),chooseAiProfile:fail,aiProfileKey:fail},"recordings.js":{assertRecording:async () => { throw Object.assign(new Error("Нет прав"),{status:403}); }},"db.js":{parseJson,one:async (sql) => {
    if(sql.includes("FROM ai_jobs")) return {id:1,recording_id:9,conference_id:10,project_id:7,job_type:"conference"};
    if(sql.includes("FROM conferences")) return {id:10,project_id:7,created_by:2};
    return {id:7};
  },rows:async (sql) => { queried=sql; return []; },transaction:fail,db:{query:fail}}});
  await ai.listSourceAiJobs(user,"conference",10); assert.match(queried,/AND recording_id IS NULL/);
  await assert.rejects(ai.getAiJob(user,1), (error) => error.status === 403);
});

test("recording history reveals only the active indicator without file permissions", async () => {
  let reads=0;
  const recordings = await load("recordings.js", {"permissions.js":{hasProjectPermission:async () => false,projectPermissionSet:async()=>new Set(),workspacePermissionSet:async()=>new Set(),hasWorkspacePermission:async()=>false},"db.js":{one:async (sql) => sql.includes("c.*") ? {id:10,project_id:7,created_by:2} : sql.includes("SELECT id, status") ? {id:5,status:"recording"} : {user_id:2},rows:async () => { reads++; return []; },transaction:fail},"storage.js":{bucket:()=>"private",objectInfo:fail}}, {RECORDING_ENABLED:"true"});
  const result = await recordings.listRecordings(user,10);
  assert.equal(result.active.status,"recording"); assert.equal(result.can_view,false); assert.equal(result.recordings.length,0); assert.equal(reads,0);
  await assert.rejects(recordings.assertRecording(user,10,5), (error) => error.status === 403);
});

test("S3 completion is verified before a recording becomes available", async () => {
  const updates=[]; let exists=false;
  const recordings = await load("recordings.js", {"storage.js":{bucket:()=>"private",objectInfo:async () => { if(!exists) throw new Error("storage down"); return {size:1200}; }},"db.js":{one:fail,rows:async (...args) => updates.push(args),transaction:fail}});
  const record={id:5,status:"stopping",object_key:"workspaces/1/conferences/10/recordings/file.mp4",egress_id:"EG_1",stop_requested:true};
  const info={egressId:"EG_1",status:3,startedAt:BigInt(1e9),fileResults:[{filename:record.object_key,duration:BigInt(120e9)}]};
  await recordings.syncRecording(record,info); assert.equal(updates.length,0);
  exists=true; await recordings.syncRecording(record,info); assert.equal(updates[0][1][1],"completed"); assert.ok(updates[0][1].includes(1200));
  const other={...info,egressId:"EG_foreign"}; await recordings.syncRecording(record,other); assert.equal(updates.length,1);
});

test("recording start retries reuse a reservation and do not launch another Egress", async () => {
  let starts=0;
  const previous={id:5,workspace_id:1,conference_id:10,created_by:2,request_id:crypto.randomUUID(),status:"recording"};
  const recordings=await load("recordings.js", {"livekit-server-sdk":{...sdk,EgressClient:class {async startRoomCompositeEgress(){starts++;}}},"permissions.js":{hasProjectPermission:async()=>true,projectPermissionSet:async()=>new Set(),workspacePermissionSet:async()=>new Set(),hasWorkspacePermission:async()=>false},"storage.js":{bucket:()=>"private",objectInfo:fail},"db.js":{one:async(sql)=>sql.includes("c.*")?{id:10,project_id:7,created_by:2,status:"live",media_room_ready_at:"ready"}:previous,rows:fail,transaction:async(work)=>work({query:async(sql)=>sql.includes("request_id")?[[previous]]:[[{id:10}]]})}}, {RECORDING_ENABLED:"true",LIVEKIT_API_URL:"http://media.test",LIVEKIT_API_KEY:"test",LIVEKIT_API_SECRET:"test"});
  const result=await recordings.startRecording(user,10,previous.request_id);
  assert.equal(result.id,5); assert.equal(starts,0);
});

test("private video downloads support safe single byte ranges and reject invalid ranges", async () => {
  const recording=await load("recording-api.js");
  const range=recording.recordingByteRange;
  assert.deepEqual({...range("bytes=0-99",1000)},{start:0,end:99});
  assert.deepEqual({...range("bytes=-100",1000)},{start:900,end:999});
  assert.deepEqual({...range("bytes=900-",1000)},{start:900,end:999});
  for(const bad of ["bytes=1000-","bytes=5-1","bytes=0-1,5-8","bytes=-0","bytes=-","invalid"]) assert.equal(range(bad,1000),false,bad);
});

test("completed transcription is shared and does not contact STT again", async () => {
  const transcription=await load("recording-jobs.js", {"recordings.js":{assertRecording:async()=>({status:"completed",transcript_status:"completed"}),recordingConferenceAccess:async()=>({id:10}),RecordingError:class extends Error {}},"ai-settings.js":{getAiSettings:fail,aiProfileKey:fail}});
  const result=await transcription.queueRecordingTranscription(user,10,5);
  assert.equal(result.cached,true); assert.equal(result.status,"completed");
});

test("STT submits a bounded audio file and does not expose provider error bodies", async () => {
  const transcription=await load("recording-transcription.js", {"ai-settings.js":{getAiSettings:fail,aiProfileKey:()=>"private-key"}});
  const speech={base_url:"https://stt.test/v1",model:"whisper",language:"ru",timeout_seconds:30};
  const text=await transcription.transcribeAudioChunk(speech,Buffer.from("audio"),async(url,options)=>{
    assert.equal(url,"https://stt.test/v1/audio/transcriptions"); assert.equal(options.redirect,"error"); assert.equal(options.body.get("model"),"whisper"); assert.equal(options.body.get("language"),"ru"); assert.equal(options.body.get("file").size,5); return Response.json({text:"Русский текст встречи"});
  }); assert.equal(text,"Русский текст встречи");
  await assert.rejects(transcription.transcribeAudioChunk(speech,Buffer.from("audio"),async()=>new Response("private-key",{status:401})),(error)=>error.status===502&&!error.message.includes("private-key"));
});

test("real ffmpeg splits a long MP4 and transcription resumes from cached chunks", async (t) => {
  const exec = promisify(execFile);
  try { await exec("ffmpeg",["-version"]); } catch { t.skip("ffmpeg is not installed"); return; }
  const directory = await fs.mkdtemp(path.join(process.cwd(),".recording-test-"));
  try {
    const input = path.join(directory,"source.mp4");
    await exec("ffmpeg",["-nostdin","-v","error","-f","lavfi","-i","anullsrc=r=16000:cl=mono","-t","601","-c:a","aac",input]);
    const record={id:5,workspace_id:1,conference_id:10,status:"completed",transcript_requested_by:2,transcript_profile_revision:"v1",object_key:"private.mp4"};
    const writes=[]; let requests=0;
    const db={parseJson,db:{query:async()=>[{affectedRows:1}]},transaction:fail,one:async(sql)=>sql.includes("FROM conference_recordings")?record:{...user,status:"active"},rows:async(sql,params)=>{if(sql.startsWith("SELECT chunk_index")) return [{chunk_index:0,text:"Кэш первой части"}];writes.push({sql,params});return {affectedRows:1};}};
    const module=await load("recording-transcription.js",{
      "db.js":db,
      "storage.js":{bucket:()=>"private",objectInfo:async()=>({size:(await fs.stat(input)).size}),storage:()=>({getObject:async()=>createReadStream(input)})},
      "ai-settings.js":{getAiSettings:async()=>({speech:{enabled:true,revision:"v1",base_url:"https://stt.test/v1",model:"whisper",language:"ru",timeout_seconds:30}}),aiProfileKey:()=>""},
      "recordings.js":{assertRecording:async()=>record,recordingConferenceAccess:async()=>({id:10}),RecordingError:class extends Error{constructor(status,message){super(message);this.status=status;}}},
    },{RECORDING_TEMP_DIR:directory,RECORDING_TRANSCRIBE_MAX_GB:"1"},{fetch:async(_url,options)=>{requests++;assert.ok(options.body.get("file").size<20*1024**2);return Response.json({text:"Вторая часть встречи"});}});
    await module.processRecordingTranscription(5);
    assert.equal(requests,1,"cached first ten minutes must not be transcribed again");
    assert.ok(writes.some((call)=>call.sql.includes("transcript_chunks=?")&&call.params[0]===2));
    const saved=writes.find((call)=>call.sql.startsWith("INSERT INTO conference_recording_transcripts"));
    assert.equal(saved.params[1],1); assert.equal(saved.params[2],600);
    assert.ok(writes.some((call)=>call.sql.includes("transcript_status='completed'")),JSON.stringify(writes.at(-1)));
    assert.deepEqual(await fs.readdir(directory),["source.mp4"],"temporary media is removed");
  } finally { await fs.rm(directory,{recursive:true,force:true}); }
});
