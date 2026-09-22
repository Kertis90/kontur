// Contract tests execute the actual route handlers with mocked infrastructure.
// They do not replace migration tests against MySQL or LiveKit load tests.
import test from "node:test";
import {load} from "./test-module-loader.mjs";
const {dashboardFilterSchema,dashboardExtension}=await load("dashboard-access.js");
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import crypto from "node:crypto";
import { z } from "zod";
import * as collaboration from "../src/lib/conference-collaboration.js";

const routeSource = await fs.readFile(new URL("../app/api/[[...path]]/route.js", import.meta.url), "utf8");
const accessSource = await fs.readFile(new URL("../src/lib/api-access.js", import.meta.url), "utf8");
const joinCode = "04bb661f-5fc8-42e8-89cd-c84d9e39da42";
const member = { id: 2, workspace_id: 1, display_name: "Участник" };
const baseConference = { id: 10, workspace_id: 1, created_by: 1, project_id: 7, title: "Демо спринта", status: "live", join_policy: "invite", join_code: joinCode };

async function fixture(options = {}) {
  const user = options.user === undefined ? member : options.user;
  const conference = { ...baseConference, ...options.conference };
  const calls = [];
  const context = vm.createContext({ console, Buffer, Response, Headers, Request, TextEncoder, TextDecoder, ReadableStream, URL, Date, setTimeout, clearTimeout, process: { env: {
    LIVEKIT_API_URL: "http://media.test", LIVEKIT_WS_URL: "ws://media.test", LIVEKIT_API_KEY: "test", LIVEKIT_API_SECRET: "test",
  } } });
  const one = async (sql, params = []) => {
    calls.push({ kind: "one", sql, params });
    if (sql === "SELECT * FROM conferences WHERE id=? AND workspace_id=?")
      return params[0] === conference.id && params[1] === conference.workspace_id ? { ...conference } : null;
    if (sql === "SELECT id FROM projects WHERE id=? AND workspace_id=? AND deleted_at IS NULL") return options.projectDeleted ? null : { id: conference.project_id };
    if (sql === "SELECT participant_role FROM conference_participants WHERE conference_id=? AND user_id=?")
      return options.invited === false ? null : { participant_role: "participant" };
    if (options.one) return options.one(sql, params);
    throw new Error(`Unexpected SELECT: ${sql}`);
  };
  const rows = async (sql, params = []) => {
    calls.push({ kind: "rows", sql, params });
    if (sql.startsWith("INSERT INTO conference_participants")) return { affectedRows: 1 };
    if (options.rows) return options.rows(sql, params);
    throw new Error(`Unexpected query: ${sql}`);
  };
  function synthetic(values) {
    return new vm.SyntheticModule(Object.keys(values), function () {
      for (const [name, value] of Object.entries(values)) this.setExport(name, value);
    }, { context });
  }
  const parseJson = (value, fallback = null) => {
    if (value == null) return fallback;
    if (typeof value === "object") return value;
    try { return JSON.parse(value); } catch { return fallback; }
  };
  const access = new vm.SourceTextModule(accessSource, { context });
  await access.link(() => synthetic({ one, parseJson }));
  await access.evaluate();
  const supplied = {
    "../../../src/lib/chat-rooms.js": {assertChatRoomMembership:async()=>null},
    "../../../src/lib/dashboard-access.js": {dashboardFilterSchema,dashboardExtension},
    "../../../src/lib/work-common.js": { WorkError: class extends Error {} },
    "../../../src/lib/work-access.js": { sanitizeWorkResponse: async (_user,value) => value },
    "node:crypto": { default: crypto },
    zod: { z },
    "next/server": { NextResponse: class extends Response {} },
    "livekit-server-sdk": {
      AccessToken: class {}, DataPacket_Kind: { RELIABLE: 0 },
      RoomServiceClient: class { async sendData(...args) { return options.broadcast?.(...args); } },
    },
    "../../../src/lib/db": { one, rows, db: { query: async (...args) => [await rows(...args)] } },
    "../../../src/lib/auth": { currentUser: async () => user, hasProjectPermission: async (_user, _project, permission) => options.moderator === true && permission === "conference.manage" },
    "../../../src/lib/permissions": { PERMISSION_CATALOG: [] },
    "../../../src/lib/audit": { audit: async () => {} },
    "../../../src/lib/conference-collaboration.js": collaboration,
  };
  const bindings = new Map([...routeSource.matchAll(/import\s+([\s\S]*?)\s+from\s+(['"])(.*?)\2;/g)].map(([, names, , source]) => [source, names]));
  const module = new vm.SourceTextModule(routeSource, { context });
  await module.link((source) => {
    if (source === "../../../src/lib/api-access") return access;
    const names = bindings.get(source).trim();
    const exports = names.startsWith("{") ? names.replace(/[{}]/g, "").split(",").map((name) => name.trim()).filter(Boolean) : ["default"];
    const values = Object.fromEntries(exports.map((name) => [name, () => { throw new Error(`Unexpected dependency: ${source}:${name}`); }]));
    return synthetic({ ...values, ...supplied[source] });
  });
  await module.evaluate();
  return {
    calls,
    async request(method, suffix, body) {
      const url = suffix.startsWith("/") ? `http://kontur.test/api${suffix}` : `http://kontur.test/api/conferences/${suffix}`;
      const request = new Request(url, { method, ...(body !== undefined ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
      return module.namespace[method](request, { params: Promise.resolve({ path: new URL(url).pathname.slice(5).split("/") }) });
    },
  };
}

test("private history, export, questions and people reject an uninvited user", async () => {
  const f = await fixture({ invited: false });
  for (const endpoint of ["messages", "transcript", "questions", "participants"]) {
    const response = await f.request("GET", `10/${endpoint}`);
    assert.equal(response.status, 403, endpoint);
  }
  assert.equal(f.calls.some((call) => call.sql.includes("conference_messages")), false);
});

test("a deleted project closes conference history even for its host", async () => {
  const f = await fixture({ user: { ...member, id: 1 }, projectDeleted: true });
  assert.equal((await f.request("GET", "10/messages")).status,404);
  assert.equal(f.calls.some((call)=>call.sql.includes("conference_messages")),false);
});

test("a link cannot cross workspaces or open an invitation-only conference", async () => {
  const foreign = await fixture({ user: { ...member, workspace_id: 2 }, conference: { join_policy: "link" }, invited: false });
  assert.equal((await foreign.request("GET", `10/messages?join_code=${joinCode}`)).status, 404);
  const invitedOnly = await fixture({ invited: false });
  assert.equal((await invitedOnly.request("GET", `10/messages?join_code=${joinCode}`)).status, 403);
  const linked = await fixture({ invited: false, conference: { join_policy: "link" }, rows: () => [] });
  assert.equal((await linked.request("GET", `10/messages?join_code=${joinCode}`)).status, 200);
  assert.equal((await linked.request("GET", "10/messages?join_code=not-a-code")).status, 422);
});

test("authentication and token policy apply to transcript and writes", async () => {
  const anonymous = await fixture({ user: null });
  assert.equal((await anonymous.request("GET", "10/transcript")).status, 401);
  const readOnly = await fixture({ user: { ...member, api_token_id: 1, api_enabled: true, scopes_json: ["conference:read"], allowed_scopes_json: ["conference:read", "conference:write"] } });
  assert.equal((await readOnly.request("POST", "10/messages", { body: "Привет" })).status, 403);
  assert.equal(readOnly.calls.length, 0);
  const disabled = await fixture({ user: { ...member, api_token_id: 1, api_enabled: false } });
  assert.equal((await disabled.request("GET", "10/transcript")).status, 403);
});

test("history validates mutually exclusive cursors and returns chronological pages", async () => {
  const f = await fixture({ rows: (sql) => sql.includes("DESC") ? [{ id: 3 }, { id: 2 }] : [{ id: 4 }, { id: 5 }] });
  assert.deepEqual(await (await f.request("GET", "10/messages")).json(), [{ id: 2 }, { id: 3 }]);
  assert.deepEqual(await (await f.request("GET", "10/messages?after=3&limit=2")).json(), [{ id: 4 }, { id: 5 }]);
  const query = f.calls.filter((call) => call.kind === "rows").at(-1);
  assert.deepEqual(Array.from(query.params), [10, 3, 2]);
  for (const query of ["after=0&before=10", "limit=251", "after=-1", "after=1.5", "before=0"]) {
    assert.equal((await f.request("GET", `10/messages?${query}`)).status, 422, query);
  }
});

test("finished conferences retain history but reject new messages and hands", async () => {
  const f = await fixture({ conference: { status: "completed" }, rows: () => [{ id: 1, body: "Сохранено" }] });
  assert.equal((await f.request("GET", "10/messages")).status, 200);
  assert.equal((await f.request("POST", "10/messages", { body: "Новое" })).status, 409);
  assert.equal((await f.request("POST", "10/hand", { raised: true })).status, 409);
  assert.equal(f.calls.some((call) => /INSERT|UPDATE/.test(call.sql)), false);
});

test("retrying a persisted message reuses its identity even if LiveKit fails", async () => {
  let stored;
  let broadcasts = 0;
  const f = await fixture({
    conference: { media_room_ready_at: "2026-09-08 10:00:00" },
    rows: (sql, params) => {
      assert.match(sql, /ON DUPLICATE KEY UPDATE/);
      stored ||= { id: 1, conference_id: params[0], sender_id: params[1], message_type: params[2], body: params[3], question_status: params[4], client_id: params[5], revision: 1 };
      return { insertId: stored.id };
    },
    one: () => stored,
    broadcast: () => { assert.ok(stored); broadcasts++; throw new Error("Media unavailable"); },
  });
  const payload = { body: "  Вопрос на русском 👋  ", message_type: "question", client_id: crypto.randomUUID() };
  const first = await f.request("POST", "10/messages", payload);
  assert.equal(first.status, 201);
  const retry = await f.request("POST", "10/messages", payload);
  assert.equal(retry.status, 201);
  assert.deepEqual(await first.json(), await retry.json());
  assert.equal(stored.body, "Вопрос на русском 👋");
  assert.equal(broadcasts, 2);
  assert.equal((await f.request("POST", "10/messages", { ...payload, body: "Другой текст" })).status, 409);
});

test("message validation rejects empty, oversized and invalid submissions", async () => {
  const f = await fixture();
  for (const payload of [{ body: "  " }, { body: "а".repeat(4001) }, { body: "Текст", message_type: "system" }, { body: "Текст", client_id: "bad" }])
    assert.equal((await f.request("POST", "10/messages", payload)).status, 422);
  assert.equal(f.calls.length, 0);
});

test("only a host or moderator can change a question, within its conference", async () => {
  const memberFixture = await fixture();
  assert.equal((await memberFixture.request("PATCH", "10/questions/1", { status: "answered" })).status, 403);
  assert.equal((await memberFixture.request("PATCH", "10/participants/1", { raised: false })).status, 403);
  const wrongRoom = await fixture({ moderator: true, one: () => null });
  assert.equal((await wrongRoom.request("PATCH", "10/questions/999", { status: "answered" })).status, 404);
  assert.equal(wrongRoom.calls.some((call) => call.kind === "rows"), false);
  let updated = false;
  const host = await fixture({ user: { ...member, id: 1 }, one: (sql) => sql.startsWith("SELECT id") ? { id: 4 } : { id: 4, question_status: "answered", revision: 2 }, rows: (sql, params) => {
    assert.match(sql, /revision=revision\+1/); assert.equal(params[0], "answered"); updated = true;
  } });
  const response = await host.request("PATCH", "10/questions/4", { status: "answered" });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).revision, 2);
  assert.ok(updated);
});

test("transcript streams all pages, preserves Cyrillic and includes question status", async () => {
  const entries = Array.from({ length: 503 }, (_, index) => ({ id: index + 1, body: `Сообщение №${index + 1} 👋`, sender_name: "Анна", message_type: index === 502 ? "question" : "message", question_status: "answered", created_at: "2026-09-08 10:00:00" }));
  const f = await fixture({ conference: { status: "completed" }, one: () => ({ id: 503 }), rows: (_sql, [room, after, boundary]) => { assert.equal(room, 10); assert.equal(boundary, 503); return entries.filter((entry) => entry.id > after).slice(0, 250); } });
  const response = await f.request("GET", "10/transcript");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /^text\/plain/);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const text = await response.text();
  assert.equal((text.match(/Сообщение №/g) || []).length, 503);
  assert.match(text, /Вопрос · Отвечен/);
  assert.match(text, /2026-09-08T10:00:00.000Z/);
  assert.match(text, /Сообщение №503 👋/);
});

test("a paginated search preserves the caller's hand and room totals", async () => {
  const f = await fixture({
    rows: (_sql, params) => {
      assert.deepEqual(Array.from(params), [10, "%Анна%", 100, 200]);
      return [{ user_id: 905, display_name: "Анна", hand_raised_at: null }];
    },
    one: (sql, params) => {
      if (sql.includes("SUM(hand_raised_at")) return { total: 1000, raised_count: 15 };
      if (sql.startsWith("SELECT hand_raised_at")) { assert.equal(params[1], member.id); return { hand_raised_at: "2026-09-08 10:02:00" }; }
      if (sql.includes("COUNT(*) AS value")) return { value: 201 };
      throw new Error(`Unexpected SELECT: ${sql}`);
    },
  });
  const response = await f.request("GET", "10/participants?q=Анна&limit=100&offset=200");
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.total, 1000);
  assert.equal(data.matching_count, 201);
  assert.equal(data.raised_count, 15);
  assert.equal(data.own_hand_raised_at, "2026-09-08 10:02:00");
  assert.equal(data.can_moderate, false);
  assert.equal(data.participants.some((person) => person.user_id === member.id), false);
});

test("old REST responses cannot revert a newer moderated question", () => {
  const result = collaboration.mergeConferenceMessages([{ id: 4, revision: 2, question_status: "answered" }], [{ id: "4", revision: 1, question_status: "open" }, { id: 2, revision: 1 }]);
  assert.deepEqual(result.map((message) => message.id), [2, 4]);
  assert.equal(result[1].question_status, "answered");
  assert.equal(collaboration.conferenceDate("2026-09-08 10:00:00").toISOString(), "2026-09-08T10:00:00.000Z");
});

test('chat history defaults to latest messages, supports both paging directions, and can leave unread untouched', async () => {
  const f = await fixture({one:sql => sql.includes('chat_channels') ? {id:3,workspace_id:1,project_id:null} : {user_id:2}, rows:sql => {
    if(sql.includes('FROM chat_messages message')) return sql.includes('DESC') ? [{id:102},{id:101}] : [{id:1},{id:2}];
    if(sql.includes('chat_attachments')) return []; throw new Error(sql);
  }});
  assert.deepEqual((await (await f.request('GET','/chat/channels/3/messages?mark_read=false')).json()).map(m=>m.id),[101,102]);
  assert.deepEqual((await (await f.request('GET','/chat/channels/3/messages?after=0&mark_read=false')).json()).map(m=>m.id),[1,2]);
  assert.equal((await f.request('GET','/chat/channels/3/messages?before=101&mark_read=false')).status,200);
  assert.equal(f.calls.some(c=>c.sql.startsWith('INSERT')||c.sql.startsWith('UPDATE')),false);
  for(const query of ['after=1&before=9','before=0','after=-1','after=1.2','mark_read=invalid']) assert.equal((await f.request('GET',`/chat/channels/3/messages?${query}`)).status,422,query);
});
test('chat read acknowledgement cannot cross channels and never rewinds the read cursor',async()=>{
  const f=await fixture({one:(sql,params)=>{
    if(sql.includes('FROM chat_channels'))return {id:3,workspace_id:1,project_id:null};
    if(sql.includes('FROM chat_channel_members'))return {user_id:2};
    if(sql.includes('FROM chat_messages'))return params[0]===102&&params[1]===3?{id:102}:null;
    throw new Error(sql);
  },rows:sql=>{assert.match(sql,/GREATEST\(last_read_message_id,VALUES\(last_read_message_id\)\)/);return {affectedRows:1};}});
  assert.equal((await f.request('POST','/chat/channels/3/read',{message_id:102})).status,200);
  assert.equal((await f.request('POST','/chat/channels/3/read',{message_id:999})).status,404);
  const denied=await fixture({one:sql=>sql.includes('chat_channels')?{id:3,workspace_id:1,project_id:null}:null});
  assert.equal((await denied.request('POST','/chat/channels/3/read',{message_id:102})).status,403);
  assert.equal(denied.calls.some(c=>c.sql.startsWith('INSERT')),false);
});
