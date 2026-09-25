import {chatRoomsApi,assertChatRoomMembership} from '../../../src/lib/chat-rooms.js';
import {conferenceAdmission,livekitAttendanceWebhook,ensureLivekitRoom,closeConferenceRooms} from '../../../src/lib/conference-tools.js';
import {dashboardExtension,dashboardFilterSchema,validateDashboard,readableDashboard} from '../../../src/lib/dashboard-access.js';
import { slaExtension,validateSlaConfig } from '../../../src/lib/work-sla.js';
import { startMfaChallenge,consumeRate } from '../../../src/lib/session-store.js';
import { completeMfaChallenge,assertAccountChange } from '../../../src/lib/work-security.js';
import { externalAccount,oidcGroupSync } from '../../../src/lib/work-directory.js';
import { handleWorkApi } from "../../../src/lib/work-api.js";
import { developmentWebhook } from "../../../src/lib/work-development.js";
import { WorkError } from "../../../src/lib/work-common.js";
import { sanitizeWorkResponse, assertFieldEdits } from "../../../src/lib/work-access.js";
import { assertTaskGates, assertDependencyCycle } from "../../../src/lib/work-tasks.js";
import { saveArticleRevision } from "../../../src/lib/work-knowledge.js";
const requestUsers = new WeakMap();
import { handleRecordingApi } from "../../../src/lib/recording-api.js";
import { RecordingError } from "../../../src/lib/recordings.js";
import { handleProjectAccessApi, ProjectAccessError } from "../../../src/lib/project-access.js";
import { handleAiApi } from "../../../src/lib/ai-api.js";
import { AiError } from "../../../src/lib/ai-client.js";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { createRemoteJWKSet, jwtVerify } from "jose";
import {
  AccessToken,
  DataPacket_Kind,
  RoomServiceClient,
} from "livekit-server-sdk";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db, one, rows, transaction, parseJson } from "../../../src/lib/db";
import { audit } from "../../../src/lib/audit";
import { getBootstrap } from "../../../src/lib/bootstrap";
import {
  SESSION_COOKIE,
  authenticateLdap,
  authenticateLocal,
  createSessionToken,
  currentUser,
  hasProjectPermission,
  sessionCookieOptions,
} from "../../../src/lib/auth";
import {
  PERMISSION_CATALOG,
  hasWorkspacePermission,
} from "../../../src/lib/permissions";
import { decryptSecret, encryptSecret } from "../../../src/lib/crypto";
import {
  getSettings,
  oidcDiscovery,
  saveSettings,
  testLdap,
  testMail,
  testOidc,
} from "../../../src/lib/settings";
import { emitEvent, createNotification } from "../../../src/lib/events";
import { compileQuery, taskSearchSql } from "../../../src/lib/search";
import {
  attachmentKey,
  bucket,
  deleteObject,
  objectInfo,
  presignedDownload,
  presignedUpload,
  safeFileName,
  storage,
} from "../../../src/lib/storage";
import { enqueue, getRedis } from "../../../src/lib/queue";
import {
  API_SCOPE_CATALOG,
  DEFAULT_API_SCOPES,
  apiRequestError,
  apiScopes,
} from "../../../src/lib/api-access";
import { buildOpenApiDocument } from "../../../src/lib/api-docs";
import { conferenceTranscriptEntry } from "../../../src/lib/conference-collaboration.js";
import {
  hangupOutboundCall,
  maskPhone,
  normalizeCallStatus,
  startOutboundCall,
  telephonySettings,
  verifyTelephonyWebhook,
} from "../../../src/lib/telephony";
import {
  knowledgeAccessAtLeast,
  knowledgeAccessMap,
  knowledgeSpaceAccess,
} from "../../../src/lib/knowledge-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const id = z.coerce.number().int().positive();
const projectSchema = z.object({
  name: z.string().trim().min(2).max(180),
  key_code: z
    .string()
    .trim()
    .min(2)
    .max(12)
    .regex(/^[A-Za-zА-Яа-я0-9_-]+$/),
  description: z.string().max(10000).optional().default(""),
  group_id: z.coerce.number().int().positive().nullable().optional(),
  workflow_id: id.optional(),
  template_id: id.nullable().optional(),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
  start_date: z.string().nullable().optional(),
  target_date: z.string().nullable().optional(),
});
const permissionKeySchema = z
  .string()
  .refine(
    (value) =>
      PERMISSION_CATALOG.some((permission) => permission.key === value),
    "Неизвестное разрешение",
  );
const rolePermissionSchema = z.object({
  permission_key: permissionKeySchema,
  effect: z.enum(["allow", "deny"]).default("allow"),
});
const assignmentSchema = z.object({
  principal_type: z.enum(["user", "group"]),
  principal_id: id,
  scope_type: z.enum(["workspace", "project_group", "project"]),
  scope_id: z.coerce.number().int().nonnegative().default(0),
  valid_from: z.string().datetime().nullable().optional(),
  expires_at: z.string().datetime().nullable().optional(),
});
const accessRoleSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(80)
    .regex(/^[a-z][a-z0-9_.-]*$/),
  name: z.string().trim().min(2).max(160),
  description: z.string().max(500).optional().default(""),
  scope: z.enum(["workspace", "project"]).default("project"),
  active: z.boolean().default(true),
  permissions: z.array(rolePermissionSchema).default([]),
  assignments: z.array(assignmentSchema).default([]),
});
const projectTemplateSchema = z.object({
  name: z.string().trim().min(2).max(160),
  description: z.string().max(500).optional().default(""),
  workflow_id: id,
  issue_type_scheme_id: id.nullable().optional(),
  permission_scheme_id: id.nullable().optional(),
  default_group_id: id.nullable().optional(),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .default("#675EE7"),
  duration_days: z.coerce.number().int().min(1).max(3650).default(30),
  default_tasks: z
    .array(
      z.object({
        title: z.string().trim().min(2).max(300),
        description: z.string().max(10000).optional().default(""),
        stage_code: z.string().max(80).optional(),
        issue_type_code: z.string().max(60).optional().default("task"),
        priority: z
          .enum(["critical", "high", "medium", "low"])
          .default("medium"),
        start_offset_days: z.coerce.number().int().min(0).max(3650).default(0),
        due_offset_days: z.coerce.number().int().min(0).max(3650).default(7),
      }),
    )
    .max(100)
    .default([]),
  active: z.boolean().default(true),
});
const taskSchema = z.object({
  project_id: id,
  stage_id: id,
  issue_type_id: id.nullable().optional(),
  parent_task_id: id.nullable().optional(),
  epic_task_id: id.nullable().optional(),
  sprint_id: id.nullable().optional(),
  release_id: id.nullable().optional(),
  component_id: id.nullable().optional(),
  title: z.string().trim().min(2).max(300),
  description: z.string().max(100000).optional().default(""),
  priority: z.enum(["critical", "high", "medium", "low"]).default("medium"),
  assignee_id: z.coerce.number().int().positive().nullable().optional(),
  start_date: z.string().nullable().optional(),
  due_date: z.string().nullable().optional(),
  estimate_minutes: z.coerce
    .number()
    .int()
    .min(0)
    .max(1000000)
    .nullable()
    .optional(),
  story_points: z.coerce.number().min(0).max(100000).nullable().optional(),
  progress: z.coerce.number().int().min(0).max(100).default(0),
  milestone: z.coerce.boolean().default(false),
  resolution: z.string().trim().max(100).nullable().optional(),
  environment: z.string().max(20000).optional().default(""),
  custom_values: z.record(z.any()).optional().default({}),
  dependencies: z
    .array(
      z.object({
        task_id: id,
        dependency_type: z
          .enum(["blocks", "relates", "duplicates"])
          .default("blocks"),
      }),
    )
    .optional()
    .default([]),
  position: z.coerce.number().optional(),
});
const apiScopeSchema = z
  .string()
  .refine(
    (value) => API_SCOPE_CATALOG.some((scope) => scope.key === value),
    "Неизвестное разрешение API",
  );
const dashboardWidgetSchema = z.object({
  id: id.optional(),
  widget_type: z.enum([
    "sla_summary",
    "sla_risk",
    "my_tasks",
    "overdue",
    "status_distribution",
    "priority_distribution",
    "project_progress",
    "workload",
    "formula",
    "period_comparison",
  ]),
  title: z.string().trim().min(2).max(180),
  config: z.record(z.any()).default({}),
  position: z.object({
    x: z.coerce.number().int().min(0).max(11).default(0),
    y: z.coerce.number().int().min(0).max(1000).default(0),
    w: z.coerce.number().int().min(3).max(12).default(6),
    h: z.coerce.number().int().min(1).max(12).default(3),
  }),
});
const dashboardSchema = z.object({
  ...dashboardExtension,
  name: z.string().trim().min(2).max(180),
  is_shared: z.boolean().default(false),
  layout: z
    .object({
      columns: z.coerce.number().int().min(6).max(12).default(12),
      rowHeight: z.coerce.number().int().min(40).max(200).default(80),
      filter: dashboardFilterSchema.default({}),
    })
    .default({ columns: 12, rowHeight: 80 }),
  widgets: z.array(dashboardWidgetSchema).max(40).default([]),
});
const taskSlaSchema = z.object({
  ...slaExtension,
  project_id: id.nullable().optional(),
  name: z.string().trim().min(2).max(160),
  description: z.string().max(500).optional().default(""),
  goal_minutes: z.coerce.number().int().min(1).max(5256000),
  warning_percent: z.coerce.number().int().min(1).max(99).default(80),
  conditions: z
    .array(
      z.object({
        field: z.string().trim().min(1).max(120),
        operator: z.enum([
          "equals",
          "not_equals",
          "contains",
          "in",
          "gte",
          "lte",
        ]),
        value: z.any(),
      }),
    )
    .max(20)
    .default([]),
  enabled: z.boolean().default(true),
  position: z.coerce.number().int().min(0).max(100000).default(100),
});
const personalTokenSchema = z.object({
  name: z.string().trim().min(2).max(180),
  scopes: z.array(apiScopeSchema).min(1),
  expires_at: z.string().datetime().nullable().optional(),
});
const conferenceSchema = z.object({
  waiting_room: z.boolean().default(false),
  project_id: id,
  title: z.string().trim().min(2).max(220),
  description: z.string().max(1000).optional().default(""),
  scheduled_start: z.string().datetime(),
  scheduled_end: z.string().datetime(),
  conference_mode: z.enum(["interactive", "webinar"]).default("interactive"),
  max_publishers: z.coerce.number().int().min(1).max(150).default(25),
  invite_project_members: z.boolean().default(false),
  participant_ids: z.array(id).max(3000).default([]),
  presenter_ids: z.array(id).max(150).default([]),
  start_now: z.boolean().default(false),
});
const phoneNumber = z.string().trim().min(2).max(32).regex(/^\+?[0-9*#]{2,31}$/, "Некорректный номер телефона");
const telephonyCallSchema = z.object({
  project_id: id,
  to_number: phoneNumber,
  task_id: id.nullable().optional(),
  conference_id: id.nullable().optional(),
  record: z.boolean().default(false),
  metadata: z.record(z.any()).refine((value) => JSON.stringify(value).length <= 20000, "Метаданные звонка превышают 20 КБ").default({}),
});
const telephonyWebhookSchema = z.object({
  provider_call_id: z.string().trim().min(1).max(191),
  status: z.enum(["queued", "ringing", "active", "completed", "failed", "cancelled", "busy", "no_answer"]),
  started_at: z.string().datetime().nullable().optional(),
  answered_at: z.string().datetime().nullable().optional(),
  ended_at: z.string().datetime().nullable().optional(),
  duration_seconds: z.coerce.number().int().min(0).max(86400).nullable().optional(),
  failure_reason: z.string().max(1000).nullable().optional(),
});
const apiAccessPolicySchema = z.object({
  enabled: z.boolean(),
  allowed_scopes: z.array(apiScopeSchema),
  max_token_ttl_days: z.coerce.number().int().min(1).max(3650),
});

function json(data, status = 200) {
  return NextResponse.json(data, { status });
}

async function input(request) {
  try {
    return await request.json();
  } catch {
    throw new ApiError(400, "Некорректный JSON");
  }
}

function datePlus(value, days) {
  const result = value ? new Date(`${value}T12:00:00Z`) : new Date();
  result.setUTCDate(result.getUTCDate() + Number(days || 0));
  return result.toISOString().slice(0, 10);
}

function routeParts(context) {
  return context.params.then(({ path = [] }) => path);
}

function checkOrigin(request) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  const origin = request.headers.get("origin");
  if (!origin) return;
  const expected = new URL(process.env.APP_URL || request.url).origin;
  if (origin !== expected)
    throw new ApiError(403, "Источник запроса не разрешён");
}

async function requireUser(request) {
  const user = await currentUser(request);
  if (!user) throw new ApiError(401, "Требуется вход в систему");
  const apiError = apiRequestError(user, request);
  if (apiError) throw new ApiError(403, apiError);
  requestUsers.set(request, user);
  return user;
}

async function requireBrowserSession(user) {
  if (user.api_token_id)
    throw new ApiError(
      403,
      "Управление токенами доступно только в интерактивной сессии",
    );
}

async function assertApiPolicy(user, requestedScopes, expiresAt = null) {
  const policy = await one(
    "SELECT * FROM user_api_access WHERE user_id=? AND workspace_id=?",
    [user.id, user.workspace_id],
  );
  if (!policy?.enabled)
    throw new ApiError(403, "Доступ к API отключён администратором");
  const allowed = apiScopes(policy.allowed_scopes_json);
  const forbidden = requestedScopes.filter((scope) => !allowed.includes(scope));
  if (forbidden.length)
    throw new ApiError(
      403,
      `Политика пользователя запрещает: ${forbidden.join(", ")}`,
    );
  if (expiresAt) {
    const maximum = new Date();
    maximum.setUTCDate(
      maximum.getUTCDate() + Number(policy.max_token_ttl_days),
    );
    if (new Date(expiresAt) > maximum)
      throw new ApiError(
        422,
        `Срок токена не может превышать ${policy.max_token_ttl_days} дней`,
      );
  }
  return policy;
}

async function saveDashboard(connection, dashboardId, widgets) {
  await connection.query("DELETE FROM dashboard_widgets WHERE dashboard_id=?", [
    dashboardId,
  ]);
  for (const widget of widgets)
    await connection.query(
      "INSERT INTO dashboard_widgets (dashboard_id, widget_type, title, config_json, position_json) VALUES (?, ?, ?, ?, ?)",
      [
        dashboardId,
        widget.widget_type,
        widget.title,
        JSON.stringify(widget.config),
        JSON.stringify(widget.position),
      ],
    );
}

async function assertChatChannel(user, channelId, write = false) {
  const channel = await one(
    "SELECT * FROM chat_channels WHERE id=? AND workspace_id=?",
    [channelId, user.workspace_id],
  );
  if (!channel) throw new ApiError(404, "Чат не найден");
  await assertChatRoomMembership(user,channel,{write});
  if (channel.project_id) {
    if (!(await hasProjectPermission(user, channel.project_id, "chat.use")))
      throw new ApiError(403, "Нет доступа к чату проекта");
  } else {
    const membership = await one(
      "SELECT member_role FROM chat_channel_members WHERE channel_id=? AND user_id=?",
      [channelId, user.id],
    );
    if (!membership) throw new ApiError(403, "Нет доступа к чату");
    if (write && !membership)
      throw new ApiError(403, "Нет права отправлять сообщения");
  }
  return channel;
}

async function assertConference(user, conferenceId, manage = false, joinCode = null) {
  const conference = await one(
    "SELECT * FROM conferences WHERE id=? AND workspace_id=?",
    [conferenceId, user.workspace_id],
  );
  if (!conference || !(await one("SELECT id FROM projects WHERE id=? AND workspace_id=? AND deleted_at IS NULL", [conference.project_id, user.workspace_id]))) throw new ApiError(404, "Конференция не найдена");
  const isHost = Number(conference.created_by) === Number(user.id);
  if (isHost) return conference;
  if (manage) {
    if (!(await hasProjectPermission(user, conference.project_id, "conference.manage")))
      throw new ApiError(403, "Нет права управлять конференцией");
    return conference;
  }
  const participant = await one(
    "SELECT participant_role FROM conference_participants WHERE conference_id=? AND user_id=?",
    [conference.id, user.id],
  );
  const linkAccess =
    conference.join_policy === "link" &&
    joinCode &&
    crypto.timingSafeEqual(
      Buffer.from(String(conference.join_code)),
      Buffer.from(String(joinCode).padEnd(String(conference.join_code).length).slice(0, String(conference.join_code).length)),
    ) &&
    String(joinCode).length === String(conference.join_code).length;
  const canModerate = await hasProjectPermission(
    user,
    conference.project_id,
    "conference.manage",
  );
  if (!participant && !linkAccess && !canModerate)
    throw new ApiError(403, "Встреча доступна только приглашённым или по действующей ссылке");
  return conference;
}

async function canModerateConference(user, conference) {
  return (
    Number(conference.created_by) === Number(user.id) ||
    (await hasProjectPermission(
      user,
      conference.project_id,
      "conference.manage",
    ))
  );
}

async function ensureConferenceParticipant(user, conference) {
  await rows(
    "INSERT INTO conference_participants (conference_id, user_id, participant_role, response, responded_at) VALUES (?, ?, 'participant', 'accepted', CURRENT_TIMESTAMP) ON DUPLICATE KEY UPDATE response='accepted', responded_at=COALESCE(responded_at, CURRENT_TIMESTAMP)",
    [conference.id, user.id],
  );
}

async function assertKnowledgeAccess(user, spaceOrId, required = "view") {
  const { space, level } = await knowledgeSpaceAccess(user, spaceOrId);
  if (!space) throw new ApiError(404, "Пространство базы знаний не найдено");
  if (!knowledgeAccessAtLeast(level, required))
    throw new ApiError(403, "Нет доступа к этому пространству базы знаний");
  return { space, level };
}

async function canManageKnowledgeTeam(user, teamId) {
  if (await hasWorkspacePermission(user, "knowledge.manage")) return true;
  return Boolean(
    await one(
      `SELECT member.team_id FROM knowledge_team_members member
       JOIN knowledge_teams team ON team.id=member.team_id
       WHERE member.team_id=? AND member.user_id=? AND member.team_role='lead' AND team.workspace_id=?`,
      [teamId, user.id, user.workspace_id],
    ),
  );
}

async function workspaceUserIds(workspaceId, values) {
  const userIds = [...new Set((values || []).map(Number))];
  if (!userIds.length) return [];
  const accounts = await rows(
    `SELECT id FROM users WHERE workspace_id=? AND status='active' AND id IN (${userIds.map(() => "?").join(",")})`,
    [workspaceId, ...userIds],
  );
  if (accounts.length !== userIds.length)
    throw new ApiError(422, "Один или несколько пользователей недоступны");
  return userIds;
}

async function replaceKnowledgeTeamMembers(
  connection,
  teamId,
  workspaceId,
  actorId,
  memberIds,
  leadIds,
) {
  const leads = await workspaceUserIds(workspaceId, leadIds);
  const members = await workspaceUserIds(workspaceId, [
    ...(memberIds || []),
    ...leads,
  ]);
  if (!leads.length)
    throw new ApiError(422, "У команды должен быть хотя бы один руководитель");
  await connection.query("DELETE FROM knowledge_team_members WHERE team_id=?", [
    teamId,
  ]);
  for (const userId of members)
    await connection.query(
      "INSERT INTO knowledge_team_members (team_id, user_id, team_role, added_by) VALUES (?, ?, ?, ?)",
      [teamId, userId, leads.includes(userId) ? "lead" : "member", actorId],
    );
}

async function assertTelephonyProject(user, projectId, permissionKey) {
  const project = await assertProject(user, projectId);
  if (!(await hasProjectPermission(user, project.id, permissionKey)))
    throw new ApiError(403, `Нет разрешения «${permissionKey}»`);
  return project;
}

async function assertTelephonyCall(user, callId, permissionKey) {
  const call = await one(
    `SELECT telephony_call.*, project.name AS project_name, actor.display_name AS initiated_by_name
     FROM telephony_calls telephony_call
     JOIN projects project ON project.id=telephony_call.project_id
     LEFT JOIN users actor ON actor.id=telephony_call.initiated_by
     WHERE telephony_call.id=? AND telephony_call.workspace_id=?`,
    [callId, user.workspace_id],
  );
  if (!call) throw new ApiError(404, "Звонок не найден");
  await assertTelephonyProject(user, call.project_id, permissionKey);
  return call;
}

function publicCall(call) {
  let metadata = {};
  try {
    metadata = typeof call.metadata_json === "string" ? JSON.parse(call.metadata_json) : call.metadata_json || {};
  } catch {}
  const { metadata_json: _metadataJson, ...result } = call;
  return { ...result, metadata };
}

async function handleTelephonyWebhook(request) {
  const rawBody = await request.text();
  if (!verifyTelephonyWebhook(rawBody, request.headers.get("x-kontur-telephony-signature")))
    throw new ApiError(401, "Некорректная подпись телефонного шлюза");
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    throw new ApiError(400, "Некорректный JSON");
  }
  const data = telephonyWebhookSchema.parse(payload);
  const call = await one("SELECT * FROM telephony_calls WHERE provider_call_id=?", [data.provider_call_id]);
  if (!call) return json({ ok: true, ignored: true }, 202);
  const updates = ["status=?"], values = [normalizeCallStatus(data.status)];
  for (const key of ["started_at", "answered_at", "ended_at", "duration_seconds", "failure_reason"])
    if (Object.hasOwn(data, key)) {
      updates.push(`${key}=?`);
      values.push(key.endsWith("_at") && data[key] ? new Date(data[key]) : data[key]);
    }
  if (data.status === "active" && !call.answered_at && !Object.hasOwn(data, "answered_at")) updates.push("answered_at=CURRENT_TIMESTAMP");
  if (["completed", "failed", "cancelled", "busy", "no_answer"].includes(data.status) && !call.ended_at && !Object.hasOwn(data, "ended_at")) updates.push("ended_at=CURRENT_TIMESTAMP");
  await rows(`UPDATE telephony_calls SET ${updates.join(",")} WHERE id=?`, [...values, call.id]);
  await emitEvent({
    workspaceId: call.workspace_id,
    eventType: `telephony.call.${data.status}`,
    aggregateType: "telephony_call",
    aggregateId: call.id,
    payload: { project_id: call.project_id, status: data.status },
  });
  return json({ ok: true });
}

function livekitSettings() {
  const apiUrl = process.env.LIVEKIT_API_URL;
  const wsUrl = process.env.LIVEKIT_WS_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!apiUrl || !wsUrl || !apiKey || !apiSecret)
    throw new ApiError(503, "Видеоконференции не настроены администратором");
  return { apiUrl, wsUrl, apiKey, apiSecret };
}

async function broadcastConferenceEvent(conference, event) {
  if (!conference.media_room_ready_at) return;
  let timer;
  try {
    const { apiUrl, apiKey, apiSecret } = livekitSettings();
    const roomService = new RoomServiceClient(apiUrl, apiKey, apiSecret);
    const payload = new TextEncoder().encode(
      JSON.stringify({ ...event, conference_id: Number(conference.id) }),
    );
    await Promise.race([
      roomService.sendData(
        conference.room_key,
        payload,
        DataPacket_Kind.RELIABLE,
        { topic: "kontur.conference" },
      ),
      new Promise((_, reject) =>
        timer = setTimeout(() => reject(new Error("LiveKit data timeout")), 1500),
      ),
    ]);
  } catch {
    // Событие ускоряет интерфейс, но MySQL остаётся источником истины.
  } finally {
    clearTimeout(timer);
  }
}

async function requireWorkspacePermission(user, permissionKey) {
  if (!(await hasWorkspacePermission(user, permissionKey)))
    throw new ApiError(403, `Нет разрешения «${permissionKey}»`);
}

async function validateAssignment(user, assignment, roleScope) {
  if (roleScope === "workspace" && assignment.scope_type !== "workspace")
    throw new ApiError(
      422,
      "Роль рабочего пространства назначается только на всё пространство",
    );
  if (assignment.scope_type === "workspace" && assignment.scope_id !== 0)
    throw new ApiError(422, "Для рабочего пространства scope_id должен быть 0");
  if (assignment.scope_type !== "workspace" && assignment.scope_id === 0)
    throw new ApiError(422, "Для проекта или группы проектов нужен scope_id");
  if (
    assignment.valid_from &&
    assignment.expires_at &&
    new Date(assignment.expires_at) <= new Date(assignment.valid_from)
  )
    throw new ApiError(422, "Окончание доступа должно быть позже начала");
  const principalTable =
    assignment.principal_type === "user" ? "users" : "access_groups";
  if (
    !(await one(
      `SELECT id FROM ${principalTable} WHERE id=? AND workspace_id=?`,
      [assignment.principal_id, user.workspace_id],
    ))
  )
    throw new ApiError(422, "Получатель роли не найден");
  if (
    assignment.scope_type === "project" &&
    !(await one("SELECT id FROM projects WHERE id=? AND workspace_id=?", [
      assignment.scope_id,
      user.workspace_id,
    ]))
  )
    throw new ApiError(422, "Проект назначения не найден");
  if (
    assignment.scope_type === "project_group" &&
    !(await one("SELECT id FROM project_groups WHERE id=? AND workspace_id=?", [
      assignment.scope_id,
      user.workspace_id,
    ]))
  )
    throw new ApiError(422, "Группа проектов назначения не найдена");
}

async function validateProjectTemplateReferences(user, data) {
  const checks = [
    ["workflow_id", "workflows", "Рабочий процесс не найден"],
    [
      "issue_type_scheme_id",
      "issue_type_schemes",
      "Схема типов задач не найдена",
    ],
    [
      "permission_scheme_id",
      "permission_schemes",
      "Схема разрешений не найдена",
    ],
    ["default_group_id", "project_groups", "Группа проектов не найдена"],
  ];
  for (const [field, table, message] of checks) {
    if (!Object.hasOwn(data, field) || data[field] == null) continue;
    if (
      !(await one(`SELECT id FROM ${table} WHERE id=? AND workspace_id=?`, [
        data[field],
        user.workspace_id,
      ]))
    )
      throw new ApiError(422, message);
  }
}

async function replaceRoleDetails(
  connection,
  user,
  roleId,
  roleScope,
  permissions,
  assignments,
) {
  const allowedScope = roleScope === "workspace" ? "workspace" : "project";
  for (const permission of permissions) {
    const definition = PERMISSION_CATALOG.find(
      (item) => item.key === permission.permission_key,
    );
    if (definition.scope !== allowedScope)
      throw new ApiError(
        422,
        `Разрешение «${permission.permission_key}» имеет другую область действия`,
      );
  }
  for (const assignment of assignments)
    await validateAssignment(user, assignment, roleScope);
  await connection.query(
    "DELETE FROM access_role_permissions WHERE role_id=?",
    [roleId],
  );
  for (const permission of permissions)
    await connection.query(
      "INSERT INTO access_role_permissions (role_id, permission_key, effect) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE effect=VALUES(effect)",
      [roleId, permission.permission_key, permission.effect],
    );
  await connection.query("DELETE FROM access_assignments WHERE role_id=?", [
    roleId,
  ]);
  for (const assignment of assignments)
    await connection.query(
      "INSERT INTO access_assignments (role_id, principal_type, principal_id, scope_type, scope_id, valid_from, expires_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE valid_from=VALUES(valid_from), expires_at=VALUES(expires_at), created_by=VALUES(created_by)",
      [
        roleId,
        assignment.principal_type,
        assignment.principal_id,
        assignment.scope_type,
        assignment.scope_id,
        assignment.valid_from || null,
        assignment.expires_at || null,
        user.id,
      ],
    );
}

async function assertProject(
  user,
  projectId,
  write = false,
  permissionKey = "task.edit",
) {
  const project = await one(
    "SELECT * FROM projects WHERE id = ? AND workspace_id = ? AND status = 'active' AND deleted_at IS NULL",
    [projectId, user.workspace_id],
  );
  if (!project) throw new ApiError(404, "Проект не найден");
  if (write && !(await hasProjectPermission(user, project.id, permissionKey)))
    throw new ApiError(403, `Нет разрешения «${permissionKey}»`);
  if (
    !write &&
    !(await hasProjectPermission(user, project.id, "project.browse"))
  )
    throw new ApiError(403, "Нет доступа к проекту");
  return project;
}

async function updateDependencies(connection, taskId, dependencies) {
  for (const dependency of dependencies) if (dependency.dependency_type === "blocks" || !dependency.dependency_type) await assertDependencyCycle(connection, taskId, dependency.task_id);

  await connection.query("DELETE FROM task_dependencies WHERE task_id = ?", [
    taskId,
  ]);
  for (const dependency of dependencies || []) {
    if (Number(dependency.task_id) === Number(taskId)) continue;
    await connection.query(
      "INSERT IGNORE INTO task_dependencies (task_id, depends_on_task_id, dependency_type) VALUES (?, ?, ?)",
      [taskId, dependency.task_id, dependency.dependency_type],
    );
  }
}

async function validateTaskReferences(user, projectId, data, taskId = null) {
  const checks = [
    [
      "issue_type_id",
      "SELECT id FROM issue_types WHERE id=? AND workspace_id=?",
      [data.issue_type_id, user.workspace_id],
      "Тип задачи",
    ],
    [
      "parent_task_id",
      "SELECT id FROM tasks WHERE id=? AND project_id=?",
      [data.parent_task_id, projectId],
      "Родительская задача",
    ],
    [
      "epic_task_id",
      "SELECT id FROM tasks WHERE id=? AND project_id=?",
      [data.epic_task_id, projectId],
      "Эпик",
    ],
    [
      "sprint_id",
      "SELECT id FROM sprints WHERE id=? AND project_id=?",
      [data.sprint_id, projectId],
      "Спринт",
    ],
    [
      "release_id",
      "SELECT id FROM releases WHERE id=? AND project_id=?",
      [data.release_id, projectId],
      "Релиз",
    ],
    [
      "component_id",
      "SELECT id FROM project_components WHERE id=? AND project_id=?",
      [data.component_id, projectId],
      "Компонент",
    ],
  ];
  for (const [field, sql, params, label] of checks) {
    if (
      !Object.hasOwn(data, field) ||
      data[field] == null ||
      data[field] === ""
    )
      continue;
    if (
      ["parent_task_id", "epic_task_id"].includes(field) &&
      Number(data[field]) === Number(taskId)
    )
      throw new ApiError(400, `${label} не может ссылаться на текущую задачу`);
    if (!(await one(sql, params)))
      throw new ApiError(400, `${label} не относится к выбранному проекту`);
  }
  for (const dependency of data.dependencies || []) {
    if (Number(dependency.task_id) === Number(taskId)) throw new ApiError(400, "Задача не может зависеть от самой себя");
    const target = await one("SELECT t.project_id FROM tasks t JOIN projects p ON p.id=t.project_id WHERE t.id=? AND p.workspace_id=? AND p.deleted_at IS NULL", [dependency.task_id,user.workspace_id]);
    if (!target || !(await hasProjectPermission(user,target.project_id,"project.browse"))) throw new ApiError(403,"Задача зависимости недоступна");
  }
}

async function handleLogin(request) {
  const body = z
    .object({
      login: z.string().trim().min(3).max(254),
      password: z.string().min(1).max(500),
    })
    .parse(await input(request));
  await consumeRate(`login:${body.login.toLowerCase()}`,{max:20});
  const auth = await getSettings(1, "authentication");
  let user = null;
  if (auth.localEnabled !== false)
    user = await authenticateLocal(body.login, body.password);
  if (!user && auth.ldap?.enabled)
    user = await authenticateLdap(body.login, body.password, auth.ldap, 1);
  if (!user) throw new ApiError(401, "Неверный логин или пароль");
  const challenge=await startMfaChallenge(user);
  if(challenge){const response=json({mfa_required:true});response.cookies.set('kontur_mfa',challenge,{...sessionCookieOptions(),maxAge:300});return response;}
  const token = await createSessionToken(user,request);
  const response = json({
    ok: true,
    user: {
      id: user.id,
      display_name: user.display_name,
      global_role: user.global_role,
    },
  });
  response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  return response;
}

async function oidcStart(request) {
  const { config, discovery } = await oidcDiscovery(1);
  if (!config.enabled) throw new ApiError(404, "OIDC-вход выключен");
  const state = crypto.randomBytes(24).toString("base64url");
  const nonce = crypto.randomBytes(24).toString("base64url");
  const verifier = crypto.randomBytes(48).toString("base64url");
  const challenge = crypto
    .createHash("sha256")
    .update(verifier)
    .digest("base64url");
  const redirectUri = `${String(process.env.APP_URL || new URL(request.url).origin).replace(/\/$/, "")}/api/auth/oidc/callback`;
  const url = new URL(discovery.authorization_endpoint);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: config.scopes || "openid profile email",
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  const response = NextResponse.redirect(url);
  const options = { ...sessionCookieOptions(), maxAge: 600 };
  response.cookies.set("kontur_oidc_state", state, options);
  response.cookies.set("kontur_oidc_nonce", nonce, options);
  response.cookies.set("kontur_oidc_verifier", verifier, options);
  return response;
}

async function oidcCallback(request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (
    !code ||
    !state ||
    state !== request.cookies.get("kontur_oidc_state")?.value
  )
    throw new ApiError(400, "Проверка OIDC state не пройдена");
  const { config, discovery } = await oidcDiscovery(1);
  const redirectUri = `${String(process.env.APP_URL || url.origin).replace(/\/$/, "")}/api/auth/oidc/callback`;
  const tokenResponse = await fetch(discovery.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: config.clientId,
      client_secret: decryptSecret(config.clientSecretEncrypted),
      code_verifier: request.cookies.get("kontur_oidc_verifier")?.value || "",
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!tokenResponse.ok)
    throw new ApiError(
      401,
      `OIDC token endpoint вернул HTTP ${tokenResponse.status}`,
    );
  const tokens = await tokenResponse.json();
  const jwks = createRemoteJWKSet(new URL(discovery.jwks_uri));
  const { payload } = await jwtVerify(tokens.id_token, jwks, {
    issuer: discovery.issuer,
    audience: config.clientId,
  });
  if (payload.nonce !== request.cookies.get("kontur_oidc_nonce")?.value)
    throw new ApiError(401, "Проверка OIDC nonce не пройдена");
  const email = String(
    payload.email || payload.preferred_username || "",
  ).toLowerCase();
  if (!email) throw new ApiError(401, "OIDC-провайдер не вернул email");
  const name = String(payload.name || payload.given_name || email);
  if(!config.enabled)throw new ApiError(403,'OIDC-вход отключён');
  if(payload.email_verified===false)throw new ApiError(401,'Провайдер не подтвердил email');
  const user = await externalAccount(1,'oidc',String(payload.sub),email,name,discovery.issuer);
  if(user.status!=='active')throw new ApiError(403,'Учётная запись заблокирована');
  await oidcGroupSync(user,payload);
  await rows('UPDATE users SET last_login_at=CURRENT_TIMESTAMP WHERE id=?',[user.id]);
  const challenge=await startMfaChallenge(user);
  const response = NextResponse.redirect(new URL(challenge?'/?mfa=1':'/',process.env.APP_URL || url.origin));
  if(challenge)response.cookies.set('kontur_mfa',challenge,{...sessionCookieOptions(),maxAge:300});
  else response.cookies.set(SESSION_COOKIE,await createSessionToken(user,request),sessionCookieOptions());
  for (const cookie of [
    "kontur_oidc_state",
    "kontur_oidc_nonce",
    "kontur_oidc_verifier",
  ])
    response.cookies.delete(cookie);
  return response;
}

// Возвращает доступные пользователю данные с одинаковыми правилами чтения для обеих БД.
async function handleGet(request, path) {
  if (path.join("/") === "openapi.json") {
    const origin = new URL(process.env.APP_URL || request.url).origin;
    return json(buildOpenApiDocument(origin));
  }
  if (path[0] === "health") {
    await db.query("SELECT 1");
    const [redis, objectStorage] = await Promise.allSettled([
      getRedis().ping(),
      storage().bucketExists(bucket()),
    ]);
    const dependencies = {
      mysql: "ok",
      redis: redis.status === "fulfilled" ? "ok" : "error",
      objectStorage:
        objectStorage.status === "fulfilled" && objectStorage.value
          ? "ok"
          : "error",
    };
    const healthy = Object.values(dependencies).every(
      (value) => value === "ok",
    );
    return json(
      {
        status: healthy ? "ok" : "degraded",
        dependencies,
        time: new Date().toISOString(),
      },
      healthy ? 200 : 503,
    );
  }
  if (path.join("/") === "auth/oidc/start") return oidcStart(request);
  if (path.join("/") === "auth/oidc/callback") return oidcCallback(request);
  const user = await requireUser(request);
  if (path[0] === "chat" && path[1] === "rooms") return chatRoomsApi(request,path,user);
  if (path[0] === "work") return handleWorkApi(request, path.slice(1), user);
  if (path[0] === "admin" && path[1] === "automation") return handleWorkApi(request, ["automations", ...path.slice(2)], user);
  if (path[0] === "conferences" && path[2] === "recordings") return handleRecordingApi(request, path, user);
  if (path[0] === "projects" && ((path.length === 1 && request.method === "GET") || (path.length === 2 && ["PATCH", "DELETE"].includes(request.method)) || ["access", "archive", "restore", "members"].includes(path[2]))) return handleProjectAccessApi(request, path, user);
  if (path[0] === "ai" || (path[0] === "admin" && path[1] === "ai") || (["projects", "conferences"].includes(path[0]) && path[2] === "ai")) return handleAiApi(request, path, user);
  if (path[0] === "bootstrap") return json(await getBootstrap(user));
  if (path[0] === "tokens") {
    await requireBrowserSession(user);
    const tokens = await rows(
      "SELECT id, name, token_prefix, scopes_json, expires_at, last_used_at, revoked_at, created_at FROM api_tokens WHERE workspace_id=? AND user_id=? ORDER BY created_at DESC",
      [user.workspace_id, user.id],
    );
    return json(
      tokens.map((token) => ({
        ...token,
        scopes: apiScopes(token.scopes_json),
      })),
    );
  }
  if (path.join("/") === "chat/channels") {
    const channels = await rows(
      `SELECT channel.*, project.name AS project_name, room.channel_id AS room_id,room.archived AS room_archived,
      (SELECT MAX(message.created_at) FROM chat_messages message WHERE message.channel_id=channel.id) AS last_message_at,
      (SELECT COUNT(*) FROM chat_messages message LEFT JOIN chat_channel_members member ON member.channel_id=channel.id AND member.user_id=? WHERE message.channel_id=channel.id AND message.id>COALESCE(member.last_read_message_id,0) AND message.sender_id<>? AND message.deleted_at IS NULL) AS unread_count
      FROM chat_channels channel LEFT JOIN projects project ON project.id=channel.project_id
      LEFT JOIN chat_rooms room ON room.channel_id=channel.id
      LEFT JOIN chat_channel_members own_member ON own_member.channel_id=channel.id AND own_member.user_id=?
      WHERE channel.workspace_id=? AND (channel.project_id IS NOT NULL OR own_member.user_id IS NOT NULL) AND (room.channel_id IS NULL OR own_member.user_id IS NOT NULL)
      ORDER BY COALESCE((SELECT MAX(message.created_at) FROM chat_messages message WHERE message.channel_id=channel.id), channel.created_at) DESC`,
      [user.id, user.id, user.id, user.workspace_id],
    );
    const visible = [];
    for (const channel of channels) {
      try { await assertChatRoomMembership(user,channel); if (!channel.project_id || await hasProjectPermission(user,channel.project_id,"chat.use")) visible.push(channel); }
      catch(e) { if (![403,404].includes(e.status)) throw e; }
    }
    return json(visible);
  }
  if (
    path[0] === "chat" &&
    path[1] === "channels" &&
    path[2] &&
    path[3] === "messages"
  ) {
    const channelId = id.parse(path[2]);
    await assertChatChannel(user, channelId);
    const url = new URL(request.url);
    if (url.searchParams.has("after") && url.searchParams.has("before")) throw new ApiError(422,"Используйте только один курсор: after или before");
    const hasAfter = url.searchParams.has("after");
    const after = z.coerce.number().int().nonnegative().parse(url.searchParams.get("after") || 0);
    const before = url.searchParams.has("before") ? id.parse(url.searchParams.get("before")) : 0;
    const markRead = z.enum(["true","false"]).parse(url.searchParams.get("mark_read") || "true") === "true";
    const messages = await rows(
      `SELECT message.*, sender.display_name AS sender_name, sender.avatar_color AS sender_color
                                 FROM chat_messages message JOIN users sender ON sender.id=message.sender_id
                                 WHERE message.channel_id=? AND message.id>? AND (?=0 OR message.id<?) AND message.deleted_at IS NULL ORDER BY message.id ${hasAfter ? "ASC" : "DESC"} LIMIT 100`,
      [channelId, after, before, before],
    );
    if (!hasAfter) messages.reverse();
    const attachments = messages.length
      ? await rows(
          `SELECT attachment.* FROM chat_attachments attachment WHERE attachment.message_id IN (${messages.map(() => "?").join(",")})`,
          messages.map((message) => message.id),
        )
      : [];
    if (messages.length && markRead) await rows(
      "INSERT INTO chat_channel_members (channel_id,user_id,last_read_at,last_read_message_id) VALUES (?,?,CURRENT_TIMESTAMP,?) ON DUPLICATE KEY UPDATE last_read_at=CURRENT_TIMESTAMP,last_read_message_id=GREATEST(last_read_message_id,VALUES(last_read_message_id))",
      [channelId,user.id,messages.at(-1).id],
    );
    return json(
      messages.map((message) => ({
        ...message,
        attachments: attachments.filter(
          (attachment) => attachment.message_id === message.id,
        ),
      })),
    );
  }
  if (path.join("/") === "chat/presence") {
    return json(
      await rows(
        `SELECT user.id, user.display_name, user.avatar_color,
      IF(presence.last_seen_at>=DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 45 SECOND), presence.state, 'offline') AS state, presence.last_seen_at
      FROM users user LEFT JOIN user_presence presence ON presence.user_id=user.id WHERE user.workspace_id=? AND user.status='active' ORDER BY user.display_name`,
        [user.workspace_id],
      ),
    );
  }
  if (
    path[0] === "chat" &&
    path[1] === "attachments" &&
    path[2] &&
    path[3] === "download"
  ) {
    const attachment = await one(
      "SELECT attachment.*, message.channel_id FROM chat_attachments attachment JOIN chat_messages message ON message.id=attachment.message_id WHERE attachment.id=?",
      [id.parse(path[2])],
    );
    if (!attachment) throw new ApiError(404, "Файл не найден");
    await assertChatChannel(user, attachment.channel_id);
    return NextResponse.redirect(
      await presignedDownload(attachment.object_key),
    );
  }
  if (
    path[0] === "comments" &&
    path[1] &&
    path[2] === "voice" &&
    path[3] === "download"
  ) {
    const voice = await one(
      "SELECT voice.*, task.project_id, project.workspace_id FROM comment_voice_attachments voice JOIN comments comment ON comment.id=voice.comment_id JOIN tasks task ON task.id=comment.task_id JOIN projects project ON project.id=task.project_id WHERE voice.comment_id=?",
      [id.parse(path[1])],
    );
    if (!voice || Number(voice.workspace_id) !== Number(user.workspace_id))
      throw new ApiError(404, "Голосовой комментарий не найден");
    await assertProject(user, voice.project_id);
    return NextResponse.redirect(await presignedDownload(voice.object_key));
  }
  if (
    path[0] === "conferences" &&
    path[1] &&
    path[2] === "messages" &&
    path.length === 3
  ) {
    const conferenceId = id.parse(path[1]);
    const url = new URL(request.url);
    const joinCode =
      url.searchParams.get("join_code") ||
      url.searchParams.get("joinCode") ||
      null;
    if (joinCode) z.string().uuid().parse(joinCode);
    await assertConference(user, conferenceId, false, joinCode);
    const after = url.searchParams.has("after")
      ? z.coerce.number().int().nonnegative().safe().parse(url.searchParams.get("after"))
      : null;
    const before = url.searchParams.has("before") ? id.parse(url.searchParams.get("before")) : null;
    if (after !== null && before !== null)
      throw new ApiError(422, "Укажите только один курсор: after или before");
    const limit = z.coerce.number().int().min(1).max(250).parse(url.searchParams.get("limit") || 100);
    const messages = await rows(
        `SELECT message.*, sender.display_name AS sender_name, sender.avatar_color AS sender_color,
                moderator.display_name AS moderator_name
         FROM conference_messages message
         JOIN users sender ON sender.id=message.sender_id
         LEFT JOIN users moderator ON moderator.id=message.moderated_by
         WHERE message.conference_id=? ${after !== null ? "AND message.id>?" : before ? "AND message.id<?" : ""} AND message.deleted_at IS NULL
         ORDER BY message.id ${after !== null ? "ASC" : "DESC"} LIMIT ?`,
        [conferenceId, ...(after !== null ? [after] : before ? [before] : []), limit],
      );
    return json(after !== null ? messages : messages.reverse());
  }
  if (path[0] === "conferences" && path[1] && path[2] === "transcript" && path.length === 3) {
    const joinCode = new URL(request.url).searchParams.get("join_code") || null;
    if (joinCode) z.string().uuid().parse(joinCode);
    const conference = await assertConference(user, id.parse(path[1]), false, joinCode);
    const boundary = await one("SELECT COALESCE(MAX(id),0) AS id FROM conference_messages WHERE conference_id=?", [conference.id]);
    const encoder = new TextEncoder();
    let after = 0;
    let started = false;
    const stream = new ReadableStream({
      async pull(controller) {
        if (request.signal.aborted) { controller.close(); return; }
        try {
          if (!started) {
            controller.enqueue(encoder.encode(`\uFEFF${conference.title}\nИстория чата и вопросов. Время в UTC.\n\n`));
            started = true;
          }
          const batch = await rows(
            `SELECT message.*, sender.display_name AS sender_name FROM conference_messages message
             JOIN users sender ON sender.id=message.sender_id
             WHERE message.conference_id=? AND message.id>? AND message.id<=? AND message.deleted_at IS NULL
             ORDER BY message.id LIMIT 250`,
            [conference.id, after, boundary.id],
          );
          if (batch.length) {
            after = Number(batch[batch.length - 1].id);
            controller.enqueue(encoder.encode(batch.map(conferenceTranscriptEntry).join("")));
          }
          if (batch.length < 250) controller.close();
        } catch (error) { controller.error(error); }
      },
    });
    return new NextResponse(stream, { headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="conference-${conference.id}-chat.txt"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    } });
  }
  if (
    path[0] === "conferences" &&
    path[1] &&
    path[2] === "participants" &&
    path.length === 3
  ) {
    const conferenceId = id.parse(path[1]);
    const url = new URL(request.url);
    const joinCode =
      url.searchParams.get("join_code") ||
      url.searchParams.get("joinCode") ||
      null;
    if (joinCode) z.string().uuid().parse(joinCode);
    const conference = await assertConference(
      user,
      conferenceId,
      false,
      joinCode,
    );
    const search = z
      .string()
      .trim()
      .max(120)
      .parse(url.searchParams.get("q") || "");
    const limit = z.coerce.number().int().min(1).max(500).parse(url.searchParams.get("limit") || 100);
    const offset = z.coerce.number().int().min(0).max(1000000).parse(url.searchParams.get("offset") || 0);
    const filterSql = search ? "AND user.display_name LIKE ?" : "";
    const filterValues = search ? [`%${search}%`] : [];
    const [participants, totals, own, matches] = await Promise.all([
      rows(
        `SELECT participant.user_id, participant.participant_role, participant.response,
                participant.invited_at, participant.responded_at, participant.hand_raised_at,
                participant.last_joined_at, user.display_name, user.avatar_color
         FROM conference_participants participant
         JOIN users user ON user.id=participant.user_id
         WHERE participant.conference_id=? ${filterSql}
         ORDER BY participant.hand_raised_at IS NULL, participant.hand_raised_at,
                  FIELD(participant.participant_role, 'host', 'presenter', 'participant'), user.display_name, participant.user_id
         LIMIT ? OFFSET ?`,
        [conferenceId, ...filterValues, limit, offset],
      ),
      one(
        `SELECT COUNT(*) AS total,
                SUM(hand_raised_at IS NOT NULL) AS raised_count
         FROM conference_participants WHERE conference_id=?`,
        [conferenceId],
      ),
      one("SELECT hand_raised_at FROM conference_participants WHERE conference_id=? AND user_id=?", [conferenceId, user.id]),
      one(`SELECT COUNT(*) AS value FROM conference_participants participant JOIN users user ON user.id=participant.user_id WHERE participant.conference_id=? ${filterSql}`, [conferenceId, ...filterValues]),
    ]);
    return json({
      participants,
      total: Number(totals?.total || 0),
      raised_count: Number(totals?.raised_count || 0),
      current_user_id: user.id,
      own_hand_raised_at: own?.hand_raised_at || null,
      matching_count: Number(matches?.value || 0),
      offset,
      limit,
      status: conference.status,
      can_moderate: await canModerateConference(user, conference),
    });
  }
  if (
    path[0] === "conferences" &&
    path[1] &&
    path[2] === "questions" &&
    path.length === 3
  ) {
    const conferenceId = id.parse(path[1]);
    const url = new URL(request.url);
    const joinCode =
      url.searchParams.get("join_code") ||
      url.searchParams.get("joinCode") ||
      null;
    if (joinCode) z.string().uuid().parse(joinCode);
    await assertConference(user, conferenceId, false, joinCode);
    const limit = z.coerce.number().int().min(1).max(250).parse(url.searchParams.get("limit") || 250);
    const offset = z.coerce.number().int().min(0).max(1000000).parse(url.searchParams.get("offset") || 0);
    const questions = await rows(
      `SELECT message.*, sender.display_name AS sender_name, sender.avatar_color AS sender_color,
              moderator.display_name AS moderator_name
       FROM conference_messages message
       JOIN users sender ON sender.id=message.sender_id
       LEFT JOIN users moderator ON moderator.id=message.moderated_by
       WHERE message.conference_id=? AND message.message_type='question' AND message.deleted_at IS NULL
       ORDER BY message.question_status='open' DESC, message.id ASC LIMIT ? OFFSET ?`,
      [conferenceId, limit, offset],
    );
    return json(questions);
  }
  if (
    path[0] === "conferences" &&
    path[1] === "join" &&
    path[2] &&
    path.length === 3
  ) {
    const joinCode = z.string().uuid().parse(path[2]);
    const conference = await one(
      `SELECT conference.*, project.name AS project_name, creator.display_name AS creator_name,
       (SELECT COUNT(*) FROM conference_participants participant WHERE participant.conference_id=conference.id) AS participant_count,
       (SELECT participant.participant_role FROM conference_participants participant WHERE participant.conference_id=conference.id AND participant.user_id=? LIMIT 1) AS current_user_role
       FROM conferences conference
       JOIN projects project ON project.id=conference.project_id
       JOIN users creator ON creator.id=conference.created_by
       WHERE conference.workspace_id=? AND project.deleted_at IS NULL AND conference.join_code=?`,
      [user.id, user.workspace_id, joinCode],
    );
    if (!conference) throw new ApiError(404, "Ссылка на конференцию недействительна");
    await assertConference(user, conference.id, false, joinCode);
    return json(conference);
  }
  if (path[0] === "conferences" && path.length === 1) {
    const history = new URL(request.url).searchParams.get("history") === "true";
    const conferences = await rows(
      `SELECT conference.*, project.name AS project_name, creator.display_name AS creator_name,
      (SELECT COUNT(*) FROM conference_participants participant WHERE participant.conference_id=conference.id) AS participant_count,
      (SELECT participant.participant_role FROM conference_participants participant WHERE participant.conference_id=conference.id AND participant.user_id=? LIMIT 1) AS current_user_role
      FROM conferences conference JOIN projects project ON project.id=conference.project_id JOIN users creator ON creator.id=conference.created_by
      WHERE conference.workspace_id=? AND project.deleted_at IS NULL ${history ? "" : "AND conference.scheduled_end>=DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 7 DAY)"} ORDER BY conference.scheduled_start ${history ? "DESC" : "ASC"}`,
      [user.id, user.workspace_id],
    );
    const visible = [];
    for (const conference of conferences)
      if (
        conference.current_user_role ||
        Number(conference.created_by) === Number(user.id) ||
        (await hasProjectPermission(
          user,
          conference.project_id,
          "conference.manage",
        ))
      )
        visible.push(conference);
    return json(visible);
  }
  if (path.join("/") === "telephony/status") {
    const config = telephonySettings();
    return json({
      configured: config.configured,
      outbound_enabled: config.configured,
      from_number: maskPhone(config.fromNumber),
      provider_url: config.providerOrigin,
      webhook_url: new URL("/api/telephony/webhook", process.env.APP_URL || request.url).toString(),
      timeout_ms: config.timeoutMs,
    });
  }
  if (path.join("/") === "telephony/calls") {
    const url = new URL(request.url);
    const projectId = id.parse(url.searchParams.get("projectId"));
    await assertTelephonyProject(user, projectId, "telephony.view");
    const status = url.searchParams.get("status");
    if (status && !["queued", "ringing", "active", "completed", "failed", "cancelled", "busy", "no_answer"].includes(status))
      throw new ApiError(422, "Неизвестный статус звонка");
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 50), 1), 250);
    const offset = Math.max(Number(url.searchParams.get("offset") || 0), 0);
    const calls = await rows(
      `SELECT telephony_call.*, actor.display_name AS initiated_by_name
       FROM telephony_calls telephony_call LEFT JOIN users actor ON actor.id=telephony_call.initiated_by
       WHERE telephony_call.workspace_id=? AND telephony_call.project_id=? ${status ? "AND telephony_call.status=?" : ""}
       ORDER BY telephony_call.created_at DESC LIMIT ? OFFSET ?`,
      status ? [user.workspace_id, projectId, status, limit, offset] : [user.workspace_id, projectId, limit, offset],
    );
    return json({ calls: calls.map(publicCall), limit, offset });
  }
  if (path[0] === "telephony" && path[1] === "calls" && path[2] && path.length === 3) {
    return json(publicCall(await assertTelephonyCall(user, id.parse(path[2]), "telephony.view")));
  }
  if (path[0] === "projects" && path[1] && path.length === 2) {
    const project = await assertProject(user, id.parse(path[1]));
    const [members, stages] = await Promise.all([
      rows(
        `SELECT member.user_id, member.project_role, account.display_name, account.email, account.avatar_color
         FROM project_members member JOIN users account ON account.id=member.user_id
         WHERE member.project_id=? ORDER BY account.display_name`,
        [project.id],
      ),
      rows("SELECT id, code, name, color, category, position, wip_limit FROM workflow_stages WHERE workflow_id=? ORDER BY position", [project.workflow_id]),
    ]);
    return json({ project, members, stages });
  }
  if (path[0] === "search") {
    const url = new URL(request.url);
    const queryText = url.searchParams.get("q") || "";
    const limit = Math.min(
      Math.max(Number(url.searchParams.get("limit") || 100), 1),
      500,
    );
    const offset = Math.max(Number(url.searchParams.get("offset") || 0), 0);
    try {
      const compiled = compileQuery(queryText, user);
      const result = await rows(
        taskSearchSql(compiled.where, compiled.orderSql),
        [user.workspace_id, ...compiled.params, limit, offset],
      );
      const projectAccess = new Map();
      for (const projectId of new Set(result.map((task) => task.project_id)))
        projectAccess.set(
          projectId,
          await hasProjectPermission(user, projectId, "project.browse"),
        );
      return json({
        query: queryText,
        tasks: result.filter((task) => projectAccess.get(task.project_id)),
        limit,
        offset,
      });
    } catch (error) {
      throw new ApiError(422, error.message);
    }
  }
  if (path[0] === "tasks" && path[1] && path[2] === "details") {
    const taskId = id.parse(path[1]);
    const task = await one(
      `SELECT t.*, p.workspace_id, p.key_code, p.name AS project_name, ws.name AS stage_name, ws.color AS stage_color,
                                   it.name AS issue_type_name, it.code AS issue_type_code, s.name AS sprint_name, r.name AS release_name,
                                   a.display_name AS assignee_name, rep.display_name AS reporter_name
                            FROM tasks t JOIN projects p ON p.id=t.project_id JOIN workflow_stages ws ON ws.id=t.stage_id
                            LEFT JOIN issue_types it ON it.id=t.issue_type_id LEFT JOIN sprints s ON s.id=t.sprint_id LEFT JOIN releases r ON r.id=t.release_id
                            LEFT JOIN users a ON a.id=t.assignee_id LEFT JOIN users rep ON rep.id=t.reporter_id WHERE t.id=?`,
      [taskId],
    );
    if (!task || task.workspace_id !== user.workspace_id)
      throw new ApiError(404, "Задача не найдена");
    await assertProject(user, task.project_id);
    const canSeeInternal = await hasProjectPermission(
      user,
      task.project_id,
      "project.admin",
    );
    const [
      comments,
      checklist,
      attachments,
      worklogs,
      revisions,
      watchers,
      labels,
    ] = await Promise.all([
      rows(
        `SELECT c.*, u.display_name AS author_name, u.avatar_color AS author_color,
                   voice.id AS voice_id, voice.mime_type AS voice_mime_type, voice.duration_seconds, voice.transcript_status, voice.transcript_text, voice.transcript_error
            FROM comments c JOIN users u ON u.id=c.author_id LEFT JOIN comment_voice_attachments voice ON voice.comment_id=c.id
            WHERE c.task_id=? AND c.deleted_at IS NULL ${canSeeInternal ? "" : "AND c.is_internal=FALSE"} ORDER BY c.created_at`,
        [taskId],
      ),
      rows(
        "SELECT ci.*, u.display_name AS completed_by_name FROM task_checklist_items ci LEFT JOIN users u ON u.id=ci.completed_by WHERE ci.task_id=? ORDER BY ci.position, ci.id",
        [taskId],
      ),
      rows(
        "SELECT ta.id, ta.file_name, ta.mime_type, ta.size_bytes, ta.checksum_sha256, ta.created_at, u.display_name AS uploaded_by_name FROM task_attachments ta JOIN users u ON u.id=ta.uploaded_by WHERE ta.task_id=? ORDER BY ta.created_at DESC",
        [taskId],
      ),
      rows(
        "SELECT wl.*, u.display_name AS user_name FROM worklogs wl JOIN users u ON u.id=wl.user_id WHERE wl.task_id=? ORDER BY wl.work_date DESC, wl.created_at DESC",
        [taskId],
      ),
      rows(
        "SELECT tr.*, u.display_name AS changed_by_name FROM task_revisions tr LEFT JOIN users u ON u.id=tr.changed_by WHERE tr.task_id=? ORDER BY tr.version_number DESC LIMIT 100",
        [taskId],
      ),
      rows(
        "SELECT tw.user_id, u.display_name, u.avatar_color FROM task_watchers tw JOIN users u ON u.id=tw.user_id WHERE tw.task_id=?",
        [taskId],
      ),
      rows(
        "SELECT l.* FROM task_labels tl JOIN labels l ON l.id=tl.label_id WHERE tl.task_id=?",
        [taskId],
      ),
    ]);
    return json({
      task,
      comments,
      checklist,
      attachments,
      worklogs,
      revisions: revisions.map((item) => ({
        ...item,
        changes:
          typeof item.changes_json === "string"
            ? JSON.parse(item.changes_json)
            : item.changes_json,
      })),
      watchers,
      labels,
    });
  }
  if (path[0] === "attachments" && path[1] && path[2] === "download") {
    const attachment = await one(
      "SELECT ta.*, t.project_id, p.workspace_id FROM task_attachments ta JOIN tasks t ON t.id=ta.task_id JOIN projects p ON p.id=t.project_id WHERE ta.id=?",
      [id.parse(path[1])],
    );
    if (!attachment || attachment.workspace_id !== user.workspace_id)
      throw new ApiError(404, "Файл не найден");
    await assertProject(user, attachment.project_id);
    return NextResponse.redirect(
      await presignedDownload(attachment.object_key),
    );
  }
  if (path[0] === "reports") {
    const url = new URL(request.url);
    const projectId = id.parse(url.searchParams.get("projectId"));
    await assertProject(user, projectId);
    if (!(await hasProjectPermission(user, projectId, "report.view")))
      throw new ApiError(403, "Нет доступа к отчётам проекта");
    const [
      statusDistribution,
      priorityDistribution,
      workload,
      sprintProgress,
      releaseProgress,
      throughput,
    ] = await Promise.all([
      rows(
        "SELECT ws.name, ws.color, ws.is_done, COUNT(t.id) AS value FROM workflow_stages ws LEFT JOIN tasks t ON t.stage_id=ws.id AND t.project_id=? WHERE ws.workflow_id=(SELECT workflow_id FROM projects WHERE id=?) GROUP BY ws.id ORDER BY ws.position",
        [projectId, projectId],
      ),
      rows(
        "SELECT priority AS name, COUNT(*) AS value FROM tasks WHERE project_id=? GROUP BY priority ORDER BY FIELD(priority,'critical','high','medium','low')",
        [projectId],
      ),
      rows(
        "SELECT u.id, u.display_name AS name, u.avatar_color, COUNT(t.id) AS task_count, COALESCE(SUM(t.story_points),0) AS story_points, COALESCE(SUM(t.estimate_minutes),0) AS estimate_minutes FROM users u LEFT JOIN tasks t ON t.assignee_id=u.id AND t.project_id=? LEFT JOIN workflow_stages ws ON ws.id=t.stage_id WHERE u.workspace_id=? AND (t.id IS NULL OR ws.is_done=FALSE) GROUP BY u.id ORDER BY story_points DESC, task_count DESC",
        [projectId, user.workspace_id],
      ),
      rows(
        "SELECT s.id, s.name, s.status, s.start_date, s.end_date, COUNT(t.id) AS total, SUM(ws.is_done) AS completed, COALESCE(SUM(t.story_points),0) AS points, COALESCE(SUM(IF(ws.is_done, t.story_points,0)),0) AS completed_points FROM sprints s LEFT JOIN tasks t ON t.sprint_id=s.id LEFT JOIN workflow_stages ws ON ws.id=t.stage_id WHERE s.project_id=? GROUP BY s.id ORDER BY s.start_date DESC",
        [projectId],
      ),
      rows(
        "SELECT r.id, r.name, r.status, r.release_date, COUNT(t.id) AS total, SUM(ws.is_done) AS completed FROM releases r LEFT JOIN tasks t ON t.release_id=r.id LEFT JOIN workflow_stages ws ON ws.id=t.stage_id WHERE r.project_id=? GROUP BY r.id ORDER BY r.release_date",
        [projectId],
      ),
      rows(
        "SELECT DATE(updated_at) AS day, COUNT(*) AS completed FROM tasks t JOIN workflow_stages ws ON ws.id=t.stage_id WHERE t.project_id=? AND ws.is_done=TRUE AND updated_at>=DATE_SUB(CURRENT_DATE, INTERVAL 30 DAY) GROUP BY DATE(updated_at) ORDER BY day",
        [projectId],
      ),
    ]);
    return json({
      statusDistribution,
      priorityDistribution,
      workload,
      sprintProgress,
      releaseProgress,
      throughput,
    });
  }
  if (path[0] === "knowledge" && path[1] === "teams" && path.length === 2) {
    const manageAll = await hasWorkspacePermission(user, "knowledge.manage");
    return json(
      await rows(
        `SELECT team.id, team.name, team.slug, team.description, team.color, team.active,
                (SELECT COUNT(*) FROM knowledge_team_members member WHERE member.team_id=team.id) AS member_count,
                (SELECT member.team_role FROM knowledge_team_members member WHERE member.team_id=team.id AND member.user_id=? LIMIT 1) AS current_user_role
         FROM knowledge_teams team
         WHERE team.workspace_id=? AND team.active=TRUE
           ${manageAll ? "" : "AND EXISTS (SELECT 1 FROM knowledge_team_members mine WHERE mine.team_id=team.id AND mine.user_id=?)"}
         ORDER BY team.name`,
        manageAll
          ? [user.id, user.workspace_id]
          : [user.id, user.workspace_id, user.id],
      ),
    );
  }
  if (path[0] === "knowledge" && path[1] === "spaces" && path.length === 2) {
    const spaces = await rows(
      "SELECT space.*, team.name AS owner_team_name, team.color AS owner_team_color FROM knowledge_spaces space LEFT JOIN knowledge_teams team ON team.id=space.owner_team_id WHERE space.workspace_id=? ORDER BY space.name",
      [user.workspace_id],
    );
    const access = await knowledgeAccessMap(user, spaces);
    return json(
      spaces
        .filter((space) =>
          knowledgeAccessAtLeast(
            access.get(Number(space.id)) || "none",
            "view",
          ),
        )
        .map((space) => {
          const level = access.get(Number(space.id)) || "none";
          return {
            ...space,
            access_level: level,
            can_edit: knowledgeAccessAtLeast(level, "edit"),
            can_admin: knowledgeAccessAtLeast(level, "admin"),
          };
        }),
    );
  }
  if (
    path[0] === "knowledge" &&
    path[1] === "spaces" &&
    path[2] &&
    path[3] === "permissions" &&
    path.length === 4
  ) {
    const spaceId = id.parse(path[2]);
    await assertKnowledgeAccess(user, spaceId, "admin");
    return json(
      await rows(
        `SELECT permission.id, permission.principal_type, permission.principal_id, permission.access_level,
                CASE permission.principal_type WHEN 'user' THEN account.display_name ELSE team.name END AS principal_name
         FROM knowledge_space_permissions permission
         LEFT JOIN users account ON permission.principal_type='user' AND account.id=permission.principal_id
         LEFT JOIN knowledge_teams team ON permission.principal_type='team' AND team.id=permission.principal_id
         WHERE permission.space_id=? ORDER BY principal_name`,
        [spaceId],
      ),
    );
  }
  if (
    path[0] === "knowledge" &&
    path[1] === "articles" &&
    path[2] &&
    path.length === 3
  ) {
    const article = await one(
      "SELECT ka.*, ks.workspace_id, ks.name AS space_name, ks.visibility AS space_visibility, ks.owner_team_id, ks.created_by AS space_created_by, u.display_name AS author_name FROM knowledge_articles ka JOIN knowledge_spaces ks ON ks.id=ka.space_id JOIN users u ON u.id=ka.author_id WHERE ka.id=?",
      [id.parse(path[2])],
    );
    if (!article || article.workspace_id !== user.workspace_id)
      throw new ApiError(404, "Статья не найдена");
    const { level } = await assertKnowledgeAccess(
      user,
      {
        id: article.space_id,
        workspace_id: article.workspace_id,
        visibility: article.space_visibility,
        owner_team_id: article.owner_team_id,
        created_by: article.space_created_by,
      },
      "view",
    );
    if (article.status !== "published" && !knowledgeAccessAtLeast(level, "edit"))
      throw new ApiError(403, "Черновик доступен только редакторам пространства");
    return json({
      ...article,
      access_level: level,
      can_edit: knowledgeAccessAtLeast(level, "edit"),
      can_admin: knowledgeAccessAtLeast(level, "admin"),
    });
  }
  if (path[0] === "notifications") {
    return json(
      await rows(
        "SELECT * FROM user_notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 100",
        [user.id],
      ),
    );
  }
  if (path.join("/") === "admin/audit") {
    await requireWorkspacePermission(user, "audit.view");
    return json(
      await rows(
        "SELECT a.*, u.display_name AS actor_name FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id WHERE a.workspace_id = ? ORDER BY a.created_at DESC LIMIT 250",
        [user.workspace_id],
      ),
    );
  }
  throw new ApiError(404, "Маршрут не найден");
}

// Создаёт и изменяет рабочие объекты с проверкой прав и атомарным переносом задач между спринтами.
async function handlePost(request, path) {
  if (path.join("/") === "auth/login") return handleLogin(request);
  if (path.join("/") === "auth/mfa") {
    const d=z.object({code:z.string().min(6).max(40)}).parse(await input(request));
    const account=await completeMfaChallenge(request.cookies.get('kontur_mfa')?.value,d.code);
    const response=json({ok:true});response.cookies.set(SESSION_COOKIE,await createSessionToken(account,request,true),sessionCookieOptions());response.cookies.delete('kontur_mfa');return response;
  }
  if (path.join("/") === "livekit/webhook") return livekitAttendanceWebhook(request);
  if (path.join("/") === "telephony/webhook") return handleTelephonyWebhook(request);
  const user = await requireUser(request);
  if (path[0] === "chat" && path[1] === "rooms") return chatRoomsApi(request,path,user);
  if (path[0] === "work") return handleWorkApi(request, path.slice(1), user);
  if (path[0] === "admin" && path[1] === "automation") return handleWorkApi(request, ["automations", ...path.slice(2)], user);
  if (path[0] === "conferences" && path[2] === "recordings") return handleRecordingApi(request, path, user);
  if (path[0] === "projects" && ((path.length === 1 && request.method === "GET") || (path.length === 2 && ["PATCH", "DELETE"].includes(request.method)) || ["access", "archive", "restore", "members"].includes(path[2]))) return handleProjectAccessApi(request, path, user);
  if (path[0] === "ai" || (path[0] === "admin" && path[1] === "ai") || (["projects", "conferences"].includes(path[0]) && path[2] === "ai")) return handleAiApi(request, path, user);
  if (path.join("/") === "auth/logout") {
    if(user.session_id){await rows("DELETE FROM browser_push_subscriptions WHERE session_id=? AND user_id=?",[user.session_id,user.id]);await rows("UPDATE user_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?",[user.session_id,user.id]);}
    const response = json({ ok: true });
    response.cookies.delete(SESSION_COOKIE);
    return response;
  }

  if (path[0] === "tokens" && path.length === 1) {
    await requireBrowserSession(user);
    const data = personalTokenSchema.parse(await input(request));
    await assertApiPolicy(user, data.scopes, data.expires_at);
    const rawToken = `kw_${crypto.randomBytes(32).toString("base64url")}`;
    const tokenHash = crypto
      .createHash("sha256")
      .update(rawToken)
      .digest("hex");
    const [created] = await db.query(
      "INSERT INTO api_tokens (workspace_id, user_id, name, token_prefix, token_hash, scopes_json, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        user.workspace_id,
        user.id,
        data.name,
        rawToken.slice(0, 12),
        tokenHash,
        JSON.stringify(data.scopes),
        data.expires_at ? new Date(data.expires_at) : null,
      ],
    );
    await audit(
      user,
      "api_token.created",
      "api_token",
      created.insertId,
      { name: data.name, scopes: data.scopes },
      request,
    );
    return json(
      {
        id: created.insertId,
        token: rawToken,
        warning: "Токен показывается только один раз",
      },
      201,
    );
  }

  if (path[0] === "dashboards" && path.length === 1) {
    const data = await validateDashboard(user,dashboardSchema.parse(await input(request)));
    if (data.is_shared)
      await requireWorkspacePermission(user, "dashboard.share");
    const dashboardId = await transaction(async (connection) => {
      const [created] = await connection.query(
        "INSERT INTO dashboards (workspace_id, owner_id, name, is_shared, layout_json, share_group_id, is_template) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
          user.workspace_id,
          user.id,
          data.name,
          data.is_shared,
          JSON.stringify(data.layout),
          data.share_group_id,
          data.is_template,
        ],
      );
      await saveDashboard(connection, created.insertId, data.widgets);
      return created.insertId;
    });
    await audit(
      user,
      "dashboard.created",
      "dashboard",
      dashboardId,
      { name: data.name, widgets: data.widgets.length },
      request,
    );
    return json({ id: dashboardId }, 201);
  }

  if (path[0] === "dashboards" && path[1] && path[2] === "home") {
    const dashboardId = id.parse(path[1]);
    await readableDashboard(user,dashboardId);
    await rows(
      "INSERT INTO user_dashboard_preferences (user_id, home_dashboard_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE home_dashboard_id=VALUES(home_dashboard_id)",
      [user.id, dashboardId],
    );
    return json({ ok: true });
  }

  if (path.join("/") === "admin/task-sla") {
    await requireWorkspacePermission(user, "sla.manage");
    const data = taskSlaSchema.parse(await input(request));
    await validateSlaConfig(user,data);
    if (
      data.project_id &&
      !(await one("SELECT id FROM projects WHERE id=? AND workspace_id=?", [
        data.project_id,
        user.workspace_id,
      ]))
    )
      throw new ApiError(422, "Проект SLA не найден");
    const [created] = await db.query(
      "INSERT INTO task_sla_policies (workspace_id, project_id, name, description, goal_minutes, warning_percent, conditions_json, enabled, position, created_by, counter_key, calendar_id, config_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        user.workspace_id,
        data.project_id || null,
        data.name,
        data.description,
        data.goal_minutes,
        data.warning_percent,
        JSON.stringify(data.conditions),
        data.enabled,
        data.position,
        user.id, data.counter_key, data.calendar_id, JSON.stringify(data.config),
      ],
    );
    await audit(
      user,
      "task_sla.created",
      "task_sla_policy",
      created.insertId,
      { name: data.name },
      request,
    );
    return json({ id: created.insertId }, 201);
  }

  if (path[0] === "chat" && path[1] === "channels" && path[2] && path[3] === "read") {
    const channelId=id.parse(path[2]);await assertChatChannel(user,channelId);
    const data=z.object({message_id:id}).parse(await input(request));
    const message=await one("SELECT id FROM chat_messages WHERE id=? AND channel_id=?",[data.message_id,channelId]);
    if(!message)throw new ApiError(404,"Сообщение не найдено");
    await rows("INSERT INTO chat_channel_members(channel_id,user_id,last_read_at,last_read_message_id) VALUES(?,?,CURRENT_TIMESTAMP,?) ON DUPLICATE KEY UPDATE last_read_at=CURRENT_TIMESTAMP,last_read_message_id=GREATEST(last_read_message_id,VALUES(last_read_message_id))",[channelId,user.id,message.id]);
    return json({ok:true});
  }
  if (path.join("/") === "chat/presence") {
    const data = z
      .object({ state: z.enum(["online", "away"]).default("online") })
      .parse(await input(request));
    await rows(
      "INSERT INTO user_presence (user_id, workspace_id, state, last_seen_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP) ON DUPLICATE KEY UPDATE state=VALUES(state), last_seen_at=CURRENT_TIMESTAMP",
      [user.id, user.workspace_id, data.state],
    );
    return json({ ok: true });
  }
  if (path.join("/") === "chat/channels") {
    const data = z
      .object({
        project_id: id.nullable().optional(),
        channel_type: z.enum(["project", "group", "direct"]),
        name: z.string().trim().max(180).optional().default(""),
        member_ids: z.array(id).max(500).default([]),
      })
      .parse(await input(request));
    if (data.channel_type !== "project" && data.project_id)
      throw new ApiError(
        422,
        "Проект можно указать только для проектного канала",
      );
    if (data.project_id)
      await assertProject(user, data.project_id, true, "chat.use");
    if (data.channel_type === "project" && !data.project_id)
      throw new ApiError(422, "Для проектного чата нужен проект");
    const memberIds = [...new Set([user.id, ...data.member_ids])];
    const existingMembers = await rows(
      `SELECT id, display_name FROM users WHERE workspace_id=? AND id IN (${memberIds.map(() => "?").join(",")})`,
      [user.workspace_id, ...memberIds],
    );
    if (existingMembers.length !== memberIds.length)
      throw new ApiError(422, "Один из участников не найден");
    const name =
      data.name ||
      (data.channel_type === "direct"
        ? existingMembers
            .filter((entry) => entry.id !== user.id)
            .map((entry) => entry.display_name)
            .join(", ")
        : "Новый чат");
    const channelId = await transaction(async (connection) => {
      const [created] = await connection.query(
        "INSERT INTO chat_channels (workspace_id, project_id, channel_type, name, created_by) VALUES (?, ?, ?, ?, ?)",
        [
          user.workspace_id,
          data.project_id || null,
          data.channel_type,
          name,
          user.id,
        ],
      );
      for (const userId of memberIds)
        await connection.query(
          "INSERT INTO chat_channel_members (channel_id, user_id, member_role) VALUES (?, ?, ?)",
          [created.insertId, userId, userId === user.id ? "owner" : "member"],
        );
      return created.insertId;
    });
    return json({ id: channelId }, 201);
  }
  if (
    path[0] === "chat" &&
    path[1] === "channels" &&
    path[2] &&
    path[3] === "messages"
  ) {
    const channelId = id.parse(path[2]);
    await assertChatChannel(user, channelId, true);
    const data = z
      .object({
        body: z.string().trim().min(1).max(20000),
        reply_to_id: id.nullable().optional(),
      })
      .parse(await input(request));
    const [created] = await db.query(
      "INSERT INTO chat_messages (channel_id, sender_id, reply_to_id, body) VALUES (?, ?, ?, ?)",
      [channelId, user.id, data.reply_to_id || null, data.body],
    );
    await rows(
      "UPDATE chat_channels SET updated_at=CURRENT_TIMESTAMP WHERE id=?",
      [channelId],
    );
    return json({ id: created.insertId }, 201);
  }
  if (
    path[0] === "chat" &&
    path[1] === "channels" &&
    path[2] &&
    path[3] === "attachments" &&
    path[4] === "presign"
  ) {
    const channelId = id.parse(path[2]);
    await assertChatChannel(user, channelId, true);
    const data = z
      .object({
        file_name: z.string().min(1).max(500),
        mime_type: z.string().max(180).default("application/octet-stream"),
        size_bytes: z.coerce
          .number()
          .int()
          .min(1)
          .max(25 * 1024 * 1024),
      })
      .parse(await input(request));
    const objectKey = `workspaces/${user.workspace_id}/chat/${channelId}/${crypto.randomUUID()}-${safeFileName(data.file_name)}`;
    return json({
      upload_url: await presignedUpload(objectKey),
      object_key: objectKey,
      expires_in: 900,
    });
  }
  if (
    path[0] === "chat" &&
    path[1] === "channels" &&
    path[2] &&
    path[3] === "attachments" &&
    path[4] === "complete"
  ) {
    const channelId = id.parse(path[2]);
    await assertChatChannel(user, channelId, true);
    const data = z
      .object({
        object_key: z.string().min(20).max(700),
        file_name: z.string().min(1).max(500),
        mime_type: z.string().max(180).default("application/octet-stream"),
      })
      .parse(await input(request));
    if (
      !data.object_key.startsWith(
        `workspaces/${user.workspace_id}/chat/${channelId}/`,
      )
    )
      throw new ApiError(422, "Некорректный ключ файла");
    const info = await objectInfo(data.object_key);
    if (Number(info.size) > 25 * 1024 * 1024)
      throw new ApiError(413, "Файл превышает 25 МБ");
    const messageId = await transaction(async (connection) => {
      const [message] = await connection.query(
        "INSERT INTO chat_messages (channel_id, sender_id, body, message_type) VALUES (?, ?, ?, 'file')",
        [channelId, user.id, data.file_name],
      );
      await connection.query(
        "INSERT INTO chat_attachments (message_id, object_key, file_name, mime_type, size_bytes) VALUES (?, ?, ?, ?, ?)",
        [
          message.insertId,
          data.object_key,
          data.file_name,
          data.mime_type,
          info.size,
        ],
      );
      return message.insertId;
    });
    return json({ id: messageId }, 201);
  }
  if (
    path[0] === "conferences" &&
    path[1] &&
    path[2] === "messages" &&
    path.length === 3
  ) {
    const data = z
      .object({
        body: z.string().trim().min(1).max(4000),
        message_type: z.enum(["message", "question"]).default("message"),
        client_id: z.string().uuid().optional(),
        join_code: z.string().uuid().optional(),
      })
      .parse(await input(request));
    const conference = await assertConference(
      user,
      id.parse(path[1]),
      false,
      data.join_code || null,
    );
    if (["cancelled", "completed"].includes(conference.status))
      throw new ApiError(409, "Чат завершённой конференции доступен только для чтения");
    await ensureConferenceParticipant(user, conference);
    const clientId = data.client_id || crypto.randomUUID();
    await db.query(
      `INSERT INTO conference_messages (conference_id, sender_id, message_type, body, question_status, client_id)
       VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE id=id`,
      [
        conference.id,
        user.id,
        data.message_type,
        data.body,
        data.message_type === "question" ? "open" : null,
        clientId,
      ],
    );
    const message = await one(
      `SELECT message.*, sender.display_name AS sender_name, sender.avatar_color AS sender_color,
              NULL AS moderator_name
       FROM conference_messages message JOIN users sender ON sender.id=message.sender_id
       WHERE message.conference_id=? AND message.sender_id=? AND message.client_id=?`,
      [conference.id, user.id, clientId],
    );
    if (message.body !== data.body || message.message_type !== data.message_type)
      throw new ApiError(409, "client_id уже использован для другого сообщения");
    await broadcastConferenceEvent(conference, { type: "message", message });
    return json(message, 201);
  }
  if (
    path[0] === "conferences" &&
    path[1] &&
    path[2] === "hand" &&
    path.length === 3
  ) {
    const data = z
      .object({
        raised: z.boolean(),
        join_code: z.string().uuid().optional(),
      })
      .parse(await input(request));
    const conference = await assertConference(
      user,
      id.parse(path[1]),
      false,
      data.join_code || null,
    );
    if (["cancelled", "completed"].includes(conference.status))
      throw new ApiError(409, "Конференция уже завершена");
    await ensureConferenceParticipant(user, conference);
    await rows(
      `UPDATE conference_participants
       SET hand_raised_at=${data.raised ? "COALESCE(hand_raised_at, CURRENT_TIMESTAMP)" : "NULL"}
       WHERE conference_id=? AND user_id=?`,
      [conference.id, user.id],
    );
    const participant = await one(
      `SELECT own.hand_raised_at,
              (SELECT COUNT(*) FROM conference_participants raised WHERE raised.conference_id=own.conference_id AND raised.hand_raised_at IS NOT NULL) AS raised_count
       FROM conference_participants own WHERE own.conference_id=? AND own.user_id=?`,
      [conference.id, user.id],
    );
    const result = {
      raised: Boolean(participant?.hand_raised_at),
      hand_raised_at: participant?.hand_raised_at || null,
      raised_count: Number(participant?.raised_count || 0),
    };
    await broadcastConferenceEvent(conference, {
      type: "hand",
      user_id: Number(user.id),
      ...result,
    });
    return json(result);
  }
  if (path[0] === "conferences" && path.length === 1) {
    const data = conferenceSchema.parse(await input(request));
    await assertProject(user, data.project_id, true, "conference.create");
    const scheduledStart = data.start_now
      ? new Date()
      : new Date(data.scheduled_start);
    const scheduledEnd = new Date(data.scheduled_end);
    if (scheduledEnd <= scheduledStart)
      throw new ApiError(422, "Конференция должна закончиться после начала");
    const presenters = [
      ...new Set(
        data.presenter_ids
          .map(Number)
          .filter((userId) => userId !== Number(user.id)),
      ),
    ];
    const projectParticipantIds = data.invite_project_members
      ? (
          await rows("SELECT user_id FROM project_members WHERE project_id=?", [
            data.project_id,
          ])
        ).map((item) => Number(item.user_id))
      : [];
    const participants = [
      ...new Set([
        Number(user.id),
        ...projectParticipantIds,
        ...data.participant_ids.map(Number),
        ...presenters,
      ]),
    ];
    const maxPublishers =
      data.conference_mode === "interactive"
        ? 150
        : Math.max(data.max_publishers, presenters.length + 1);
    if (maxPublishers > 150)
      throw new ApiError(422, "Число ведущих не может превышать 150");
    const participantRows = await rows(
      `SELECT id FROM users WHERE workspace_id=? AND status='active' AND id IN (${participants.map(() => "?").join(",")})`,
      [user.workspace_id, ...participants],
    );
    if (participantRows.length !== participants.length)
      throw new ApiError(422, "Один или несколько участников недоступны");
    const joinCode = crypto.randomUUID();
    const joinPolicy = participants.length > 1 ? "invited" : "link";
    const conferenceId = await transaction(async (connection) => {
      const [created] = await connection.query(
        "INSERT INTO conferences (workspace_id, project_id, title, description, scheduled_start, scheduled_end, status, conference_mode, capacity, max_publishers, join_policy, join_code, room_key, created_by, waiting_room) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)",
        [
          user.workspace_id,
          data.project_id,
          data.title,
          data.description,
          scheduledStart,
          scheduledEnd,
          data.start_now ? "live" : "scheduled",
          data.conference_mode,
          maxPublishers,
          joinPolicy,
          joinCode,
          crypto.randomUUID(),
          user.id,
          data.waiting_room,
        ],
      );
      for (let offset = 0; offset < participants.length; offset += 500) {
        const participantChunk = participants.slice(offset, offset + 500);
        const participantValues = participantChunk.flatMap((userId) => [
          created.insertId,
          userId,
          userId === Number(user.id)
            ? "host"
            : presenters.includes(userId)
              ? "presenter"
              : "participant",
          userId === Number(user.id) ? "accepted" : "pending",
          userId === Number(user.id) ? new Date() : null,
        ]);
        await connection.query(
          `INSERT INTO conference_participants (conference_id, user_id, participant_role, response, responded_at) VALUES ${participantChunk.map(() => "(?, ?, ?, ?, ?)").join(",")}`,
          participantValues,
        );
        const invitees = participantChunk.filter(
          (userId) => userId !== Number(user.id),
        );
        if (invitees.length) {
          const notificationValues = invitees.flatMap((userId) => [
            userId,
            "conference.invited",
            `Приглашение: ${data.title}`,
            `Начало ${scheduledStart.toLocaleString("ru-RU")}`,
            "conference",
            String(created.insertId),
            `/?conference=${joinCode}`,
          ]);
          await connection.query(
            `INSERT INTO user_notifications (user_id, event_type, title, body, entity_type, entity_id, action_url) VALUES ${invitees.map(() => "(?, ?, ?, ?, ?, ?, ?)").join(",")}`,
            notificationValues,
          );
        }
      }
      await emitEvent(
        {
          workspaceId: user.workspace_id,
          eventType: "conference.created",
          aggregateType: "conference",
          aggregateId: created.insertId,
          payload: {
            project_id: data.project_id,
            title: data.title,
            scheduled_start: scheduledStart.toISOString(),
            conference_mode: data.conference_mode,
            start_now: data.start_now,
            join_policy: joinPolicy,
            participant_ids: participants,
            presenter_ids: presenters,
          },
        },
        connection,
      );
      return created.insertId;
    });
    await audit(
      user,
      "conference.created",
      "conference",
      conferenceId,
      { title: data.title, project_id: data.project_id },
      request,
    );
    return json(
      {
        id: conferenceId,
        workspace_id: user.workspace_id,
        project_id: data.project_id,
        project_name:
          (await one("SELECT name FROM projects WHERE id=?", [data.project_id]))
            ?.name || "Проект",
        title: data.title,
        description: data.description,
        scheduled_start: scheduledStart.toISOString(),
        scheduled_end: scheduledEnd.toISOString(),
        status: data.start_now ? "live" : "scheduled",
        conference_mode: data.conference_mode,
        join_policy: joinPolicy,
        join_code: joinCode,
        participant_count: participants.length,
        current_user_role: "host",
        created_by: user.id,
        creator_name: user.display_name,
      },
      201,
    );
  }
  if (path[0] === "conferences" && path[1] && path[2] === "token") {
    const tokenRequest = z
      .object({ join_code: z.string().uuid().optional() })
      .parse(await input(request));
    const conference = await assertConference(
      user,
      id.parse(path[1]),
      false,
      tokenRequest.join_code || null,
    );
    if (["cancelled", "completed"].includes(conference.status))
      throw new ApiError(409, "Конференция уже завершена или отменена");
    const admission=await conferenceAdmission(user,conference);
    if(!admission.admitted)return json({...admission,can_moderate:false});
    let participant = await one(
      "SELECT participant_role FROM conference_participants WHERE conference_id=? AND user_id=?",
      [conference.id, user.id],
    );
    if (!participant) {
      await rows(
        "INSERT INTO conference_participants (conference_id, user_id, participant_role, response, responded_at) VALUES (?, ?, 'participant', 'accepted', CURRENT_TIMESTAMP) ON DUPLICATE KEY UPDATE response='accepted', responded_at=COALESCE(responded_at,CURRENT_TIMESTAMP)",
        [conference.id, user.id],
      );
      participant = { participant_role: "participant" };
    }
    if (!participant) throw new ApiError(403, "Вы не приглашены в эту конференцию");
    const { apiUrl, wsUrl, apiKey, apiSecret } = livekitSettings();
    const canPublish =
      conference.conference_mode === "interactive" ||
      ["host", "presenter"].includes(participant.participant_role);
    await ensureLivekitRoom(conference.room_key,{conference_id:conference.id,mode:conference.conference_mode,max_publishers:conference.max_publishers});
    const freshConference=await one('SELECT status FROM conferences WHERE id=?',[conference.id]);
    if(!freshConference||['completed','cancelled'].includes(freshConference.status)){await closeConferenceRooms(conference);throw new ApiError(409,'Конференция уже завершена');}
    await rows('UPDATE conferences SET media_room_ready_at=COALESCE(media_room_ready_at,CURRENT_TIMESTAMP) WHERE id=?',[conference.id]);
    const ttlSeconds = Math.min(
      12 * 60 * 60,
      Math.max(
        60 * 60,
        Math.ceil((new Date(conference.scheduled_end).getTime() - Date.now()) / 1000) + 60 * 60,
      ),
    );
    const token = new AccessToken(apiKey, apiSecret, {
      identity: `user-${user.id}`,
      name: user.display_name,
      ttl: ttlSeconds,
      metadata: JSON.stringify({
        user_id: user.id,
        conference_id: conference.id,
        role: participant.participant_role,
      }),
    });
    token.addGrant({
      roomJoin: true,
      room: conference.room_key,
      canPublish,
      canSubscribe: true,
      canPublishData: false,
    });
    await rows(
      "UPDATE conference_participants SET response='accepted', responded_at=COALESCE(responded_at, CURRENT_TIMESTAMP), last_joined_at=CURRENT_TIMESTAMP WHERE conference_id=? AND user_id=?",
      [conference.id, user.id],
    );
    if (conference.status === "scheduled")
      await rows(
        "UPDATE conferences SET status='live' WHERE id=? AND status='scheduled' AND scheduled_start<=DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 30 MINUTE)",
        [conference.id],
      );
    return json({
      token: await token.toJwt(),
      url: wsUrl,
      can_publish: canPublish,
      can_moderate: await canModerateConference(user, conference),
      role: participant.participant_role,
      mode: conference.conference_mode,
      user_id: user.id,
      display_name: user.display_name,
    });
  }
  if (path.join("/") === "telephony/calls") {
    const data = telephonyCallSchema.parse(await input(request));
    await assertTelephonyProject(user, data.project_id, "telephony.call");
    if (data.task_id && !(await one("SELECT id FROM tasks WHERE id=? AND project_id=?", [data.task_id, data.project_id])))
      throw new ApiError(422, "Задача не относится к выбранному проекту");
    if (data.conference_id && !(await one("SELECT id FROM conferences WHERE id=? AND project_id=?", [data.conference_id, data.project_id])))
      throw new ApiError(422, "Конференция не относится к выбранному проекту");
    const config = telephonySettings();
    if (!config.configured)
      throw new ApiError(503, "Телефония не настроена: задайте URL, токен, webhook-secret и исходящий номер шлюза");
    const [created] = await db.query(
      `INSERT INTO telephony_calls
       (workspace_id, project_id, task_id, conference_id, from_number, to_number, status, record_call, initiated_by, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)`,
      [user.workspace_id, data.project_id, data.task_id || null, data.conference_id || null, config.fromNumber, data.to_number, data.record, user.id, JSON.stringify(data.metadata)],
    );
    try {
      const provider = await startOutboundCall({
        client_call_id: String(created.insertId),
        from_number: config.fromNumber,
        to_number: data.to_number,
        record: data.record,
        callback_url: new URL("/api/telephony/webhook", process.env.APP_URL || request.url).toString(),
        metadata: { workspace_id: user.workspace_id, project_id: data.project_id, task_id: data.task_id || null, conference_id: data.conference_id || null },
      });
      await rows("UPDATE telephony_calls SET provider_call_id=?, status=?, started_at=CURRENT_TIMESTAMP WHERE id=?", [provider.providerCallId, provider.status, created.insertId]);
      await audit(user, "telephony.call.started", "telephony_call", created.insertId, { project_id: data.project_id, task_id: data.task_id || null }, request);
      return json(publicCall(await assertTelephonyCall(user, created.insertId, "telephony.call")), 201);
    } catch (error) {
      const reason = String(error?.message || error).slice(0, 1000);
      await rows("UPDATE telephony_calls SET status='failed', failure_reason=?, ended_at=CURRENT_TIMESTAMP WHERE id=?", [reason, created.insertId]);
      throw new ApiError(502, "Телефонный шлюз не принял звонок", { reason });
    }
  }
  if (path[0] === "telephony" && path[1] === "calls" && path[2] && path[3] === "hangup") {
    const call = await assertTelephonyCall(user, id.parse(path[2]), "telephony.call");
    if (["completed", "failed", "cancelled", "busy", "no_answer"].includes(call.status))
      throw new ApiError(409, "Звонок уже завершён");
    if (!call.provider_call_id) throw new ApiError(409, "У звонка ещё нет идентификатора провайдера");
    try {
      await hangupOutboundCall(call.provider_call_id);
    } catch (error) {
      throw new ApiError(502, "Телефонный шлюз не подтвердил завершение звонка", { reason: String(error?.message || error).slice(0, 1000) });
    }
    await rows("UPDATE telephony_calls SET status='cancelled', ended_at=CURRENT_TIMESTAMP WHERE id=?", [call.id]);
    await audit(user, "telephony.call.cancelled", "telephony_call", call.id, { project_id: call.project_id }, request);
    return json({ ok: true });
  }
  if (
    path[0] === "tasks" &&
    path[1] &&
    path[2] === "voice-comments" &&
    path[3] === "presign"
  ) {
    const task = await one(
      "SELECT task.project_id FROM tasks task JOIN projects project ON project.id=task.project_id WHERE task.id=? AND project.workspace_id=?",
      [id.parse(path[1]), user.workspace_id],
    );
    if (
      !task ||
      !(await hasProjectPermission(user, task.project_id, "comment.create"))
    )
      throw new ApiError(403, "Нет права добавлять комментарии");
    const data = z
      .object({
        mime_type: z.string().max(180),
        size_bytes: z.coerce
          .number()
          .int()
          .min(1)
          .max(25 * 1024 * 1024),
      })
      .parse(await input(request));
    const objectKey = `workspaces/${user.workspace_id}/projects/${task.project_id}/voice/${crypto.randomUUID()}.webm`;
    return json({
      upload_url: await presignedUpload(objectKey),
      object_key: objectKey,
    });
  }
  if (
    path[0] === "tasks" &&
    path[1] &&
    path[2] === "voice-comments" &&
    path[3] === "complete"
  ) {
    const taskId = id.parse(path[1]);
    const task = await one(
      "SELECT task.project_id FROM tasks task JOIN projects project ON project.id=task.project_id WHERE task.id=? AND project.workspace_id=?",
      [taskId, user.workspace_id],
    );
    if (
      !task ||
      !(await hasProjectPermission(user, task.project_id, "comment.create"))
    )
      throw new ApiError(403, "Нет права добавлять комментарии");
    const data = z
      .object({
        object_key: z.string().min(20).max(700),
        mime_type: z.string().max(180),
        duration_seconds: z.coerce.number().int().min(0).max(7200).optional(),
      })
      .parse(await input(request));
    if (
      !data.object_key.startsWith(
        `workspaces/${user.workspace_id}/projects/${task.project_id}/voice/`,
      )
    )
      throw new ApiError(422, "Некорректный ключ записи");
    const info = await objectInfo(data.object_key);
    if (Number(info.size) > 25 * 1024 * 1024)
      throw new ApiError(413, "Запись превышает 25 МБ");
    const commentId = await transaction(async (connection) => {
      const [comment] = await connection.query(
        "INSERT INTO comments (task_id, author_id, body) VALUES (?, ?, 'Голосовой комментарий')",
        [taskId, user.id],
      );
      await connection.query(
        "INSERT INTO comment_voice_attachments (comment_id, object_key, mime_type, size_bytes, duration_seconds) VALUES (?, ?, ?, ?, ?)",
        [
          comment.insertId,
          data.object_key,
          data.mime_type,
          info.size,
          data.duration_seconds || null,
        ],
      );
      return comment.insertId;
    });
    return json({ id: commentId }, 201);
  }
  if (path[0] === "comments" && path[1] && path[2] === "transcribe") {
    const commentId = id.parse(path[1]);
    const voice = await one(
      "SELECT voice.*, task.project_id, project.workspace_id FROM comment_voice_attachments voice JOIN comments comment ON comment.id=voice.comment_id JOIN tasks task ON task.id=comment.task_id JOIN projects project ON project.id=task.project_id WHERE voice.comment_id=?",
      [commentId],
    );
    if (!voice || Number(voice.workspace_id) !== Number(user.workspace_id))
      throw new ApiError(404, "Голосовой комментарий не найден");
    await assertProject(user, voice.project_id);
    if (voice.transcript_status === "completed")
      return json({
        status: "completed",
        transcript: voice.transcript_text,
        cached: true,
      });
    if (!process.env.STT_API_URL)
      throw new ApiError(
        503,
        "Администратор ещё не настроил сервис распознавания речи",
      );
    if (!["processing"].includes(voice.transcript_status)) {
      const [claimed] = await db.query(
        "UPDATE comment_voice_attachments SET transcript_status='processing', transcript_error=NULL WHERE id=? AND transcript_status IN ('pending','failed')",
        [voice.id],
      );
      if (claimed.affectedRows)
        await enqueue(
          "transcribe-voice",
          { voiceId: voice.id },
          { jobId: `voice-${voice.id}-${Date.now()}` },
        );
    }
    return json({ status: "processing", cached: false }, 202);
  }

  if (path[0] === "projects" && path.length === 1) {
    await requireWorkspacePermission(user, "project.create");
    const data = projectSchema.parse(await input(request));
    const template = data.template_id
      ? await one(
          "SELECT * FROM project_templates WHERE id=? AND workspace_id=? AND active=TRUE",
          [data.template_id, user.workspace_id],
        )
      : null;
    if (data.template_id && !template)
      throw new ApiError(404, "Шаблон проекта не найден");
    const workflowId = template?.workflow_id || data.workflow_id;
    if (
      !workflowId ||
      !(await one("SELECT id FROM workflows WHERE id=? AND workspace_id=?", [
        workflowId,
        user.workspace_id,
      ]))
    )
      throw new ApiError(422, "Выберите рабочий процесс проекта");
    const groupId = data.group_id ?? template?.default_group_id ?? null;
    if (
      groupId &&
      !(await one(
        "SELECT id FROM project_groups WHERE id=? AND workspace_id=?",
        [groupId, user.workspace_id],
      ))
    )
      throw new ApiError(422, "Группа проектов не найдена");
    const startDate = data.start_date || datePlus(null, 0);
    const targetDate =
      data.target_date || datePlus(startDate, template?.duration_days || 30);
    const templateTasks =
      typeof template?.default_tasks_json === "string"
        ? JSON.parse(template.default_tasks_json || "[]")
        : template?.default_tasks_json || [];
    const result = await transaction(async (connection) => {
      const [insert] = await connection.query(
        `INSERT INTO projects (workspace_id, group_id, workflow_id, issue_type_scheme_id, permission_scheme_id, key_code, name, description, color, start_date, target_date, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          user.workspace_id,
          groupId,
          workflowId,
          template?.issue_type_scheme_id || null,
          template?.permission_scheme_id || null,
          data.key_code.toUpperCase(),
          data.name,
          data.description || template?.description || "",
          data.color || template?.color || "#675EE7",
          startDate,
          targetDate,
          user.id,
        ],
      );
      await connection.query(
        "INSERT INTO project_members (project_id, user_id, project_role) VALUES (?, ?, 'manager')",
        [insert.insertId, user.id],
      );
      if (templateTasks.length) {
        const [stageRows] = await connection.query(
          "SELECT id, code FROM workflow_stages WHERE workflow_id=? ORDER BY position",
          [workflowId],
        );
        const [typeRows] = await connection.query(
          "SELECT id, code FROM issue_types WHERE workspace_id=?",
          [user.workspace_id],
        );
        const stageByCode = Object.fromEntries(
          stageRows.map((stage) => [stage.code, stage.id]),
        );
        const typeByCode = Object.fromEntries(
          typeRows.map((type) => [type.code, type.id]),
        );
        for (let index = 0; index < templateTasks.length; index += 1) {
          const task = templateTasks[index];
          const [created] = await connection.query(
            `INSERT INTO tasks (project_id, stage_id, issue_type_id, task_number, title, description, priority, reporter_id, start_date, due_date, position, rank_value)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              insert.insertId,
              stageByCode[task.stage_code] || stageRows[0]?.id,
              typeByCode[task.issue_type_code || "task"] || null,
              index + 1,
              task.title,
              task.description || "",
              task.priority || "medium",
              user.id,
              datePlus(startDate, task.start_offset_days),
              datePlus(startDate, task.due_offset_days),
              (index + 1) * 1000,
              (index + 1) * 1000,
            ],
          );
          await connection.query(
            "INSERT INTO task_revisions (task_id, changed_by, version_number, change_type, changes_json) VALUES (?, ?, 1, 'created', ?)",
            [
              created.insertId,
              user.id,
              JSON.stringify({
                source: "project_template",
                template_id: template.id,
              }),
            ],
          );
        }
      }
      return insert.insertId;
    });
    await audit(
      user,
      "project.created",
      "project",
      result,
      { name: data.name, template_id: template?.id || null },
      request,
    );
    return json({ id: result }, 201);
  }

  if (path[0] === "groups" && path.length === 1) {
    await requireWorkspacePermission(user, "project.group.manage");
    const data = z
      .object({
        name: z.string().trim().min(2).max(160),
        description: z.string().max(500).optional().default(""),
        color: z
          .string()
          .regex(/^#[0-9A-Fa-f]{6}$/)
          .default("#675EE7"),
      })
      .parse(await input(request));
    const [result] = await db.query(
      "INSERT INTO project_groups (workspace_id, name, description, color, position) SELECT ?, ?, ?, ?, COALESCE(MAX(position),0)+100 FROM project_groups WHERE workspace_id = ?",
      [
        user.workspace_id,
        data.name,
        data.description,
        data.color,
        user.workspace_id,
      ],
    );
    await audit(
      user,
      "group.created",
      "project_group",
      result.insertId,
      { name: data.name },
      request,
    );
    return json({ id: result.insertId }, 201);
  }

  if (path[0] === "tasks" && path.length === 1) {
    const data = taskSchema.parse(await input(request));
    await assertFieldEdits(user, data.project_id, data.custom_values, {});
    if (await one("SELECT project_id FROM approval_gates WHERE project_id=? AND stage_id=?", [data.project_id, data.stage_id])) throw new ApiError(409, "Создайте задачу на этапе до согласования");
    const project = await assertProject(
      user,
      data.project_id,
      true,
      "task.create",
    );
    if (
      Object.hasOwn(data, "assignee_id") &&
      data.assignee_id &&
      !(await hasProjectPermission(user, project.id, "task.assign"))
    )
      throw new ApiError(403, "Нет права назначать исполнителя");
    const stage = await one(
      "SELECT id FROM workflow_stages WHERE id = ? AND workflow_id = ?",
      [data.stage_id, project.workflow_id],
    );
    if (!stage) throw new ApiError(400, "Этап не относится к процессу проекта");
    await validateTaskReferences(user, project.id, data);
    const taskId = await transaction(async (connection) => {
      if (data.dependencies?.length) await connection.query("SELECT id FROM workspaces WHERE id=? FOR UPDATE", [user.workspace_id]);
      await connection.query("SELECT id FROM projects WHERE id=? FOR UPDATE", [project.id]);
      // Строка проекта уже защищает общий счётчик; агрегат не требует отдельной блокировки.
      const [[counter]] = await connection.query(
        "SELECT COALESCE(MAX(task_number), 0) + 1 AS next_number, COALESCE(MAX(position),0)+1000 AS next_position FROM tasks WHERE project_id = ?",
        [project.id],
      );
      const [result] = await connection.query(
        `INSERT INTO tasks (project_id, stage_id, issue_type_id, parent_task_id, epic_task_id, sprint_id, release_id, component_id, task_number, title, description, environment, priority, reporter_id, assignee_id, start_date, due_date, estimate_minutes, story_points, progress, resolution, position, rank_value, milestone, custom_values_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          project.id,
          data.stage_id,
          data.issue_type_id || null,
          data.parent_task_id || null,
          data.epic_task_id || null,
          data.sprint_id || null,
          data.release_id || null,
          data.component_id || null,
          counter.next_number,
          data.title,
          data.description,
          data.environment,
          data.priority,
          user.id,
          data.assignee_id || null,
          data.start_date || null,
          data.due_date || null,
          data.estimate_minutes || null,
          data.story_points || null,
          data.progress,
          data.resolution || null,
          data.position || counter.next_position,
          data.position || counter.next_position,
          data.milestone,
          JSON.stringify(data.custom_values),
        ],
      );
      await updateDependencies(connection, result.insertId, data.dependencies);
      await connection.query(
        "INSERT INTO task_revisions (task_id, changed_by, version_number, change_type, changes_json) VALUES (?, ?, 1, 'created', ?)",
        [
          result.insertId,
          user.id,
          JSON.stringify({ title: data.title, stage_id: data.stage_id }),
        ],
      );
      await emitEvent(
        {
          workspaceId: user.workspace_id,
          eventType: "task.created",
          aggregateType: "task",
          aggregateId: result.insertId,
          payload: {
            task_id: result.insertId,
            project_id: project.id,
            title: data.title,
            assignee_id: data.assignee_id || null,
            priority: data.priority,
          },
        },
        connection,
      );
      return result.insertId;
    });
    await audit(
      user,
      "task.created",
      "task",
      taskId,
      { title: data.title, project: project.key_code },
      request,
    );
    return json({ id: taskId }, 201);
  }

  if (path[0] === "admin" && path[1] === "workflows") {
    await requireWorkspacePermission(user, "workflow.manage");
    const data = z
      .object({
        name: z.string().trim().min(2).max(160),
        description: z.string().max(500).optional().default(""),
      })
      .parse(await input(request));
    const [result] = await db.query(
      "INSERT INTO workflows (workspace_id, name, description) VALUES (?, ?, ?)",
      [user.workspace_id, data.name, data.description],
    );
    await audit(
      user,
      "workflow.created",
      "workflow",
      result.insertId,
      { name: data.name },
      request,
    );
    return json({ id: result.insertId }, 201);
  }

  if (path[0] === "admin" && path[1] === "users" && path.length === 2) {
    await requireWorkspacePermission(user, "user.manage");
    const data = z
      .object({
        email: z.string().trim().email().max(254),
        display_name: z.string().trim().min(2).max(160),
        global_role: z
          .enum(["admin", "project_manager", "member", "viewer"])
          .default("member"),
        password: z.string().min(10).max(500),
      })
      .parse(await input(request));
    assertAccountChange(user,null,data);
    const passwordHash = await bcrypt.hash(data.password, 12);
    const colors = ["#675EE7", "#3F83BD", "#2EA879", "#C76E55", "#A65CB3"];
    const color =
      colors[
        Array.from(data.email).reduce(
          (sum, char) => sum + char.charCodeAt(0),
          0,
        ) % colors.length
      ];
    const [result] = await db.query(
      "INSERT INTO users (workspace_id, email, display_name, password_hash, global_role, auth_source, status, avatar_color) VALUES (?, ?, ?, ?, ?, 'local', 'active', ?)",
      [
        user.workspace_id,
        data.email.toLowerCase(),
        data.display_name,
        passwordHash,
        data.global_role,
        color,
      ],
    );
    await rows(
      "INSERT INTO user_api_access (user_id, workspace_id, allowed_scopes_json, updated_by) VALUES (?, ?, ?, ?)",
      [
        result.insertId,
        user.workspace_id,
        JSON.stringify(DEFAULT_API_SCOPES),
        user.id,
      ],
    );
    await audit(
      user,
      "user.created",
      "user",
      result.insertId,
      { email: data.email, role: data.global_role },
      request,
    );
    return json({ id: result.insertId }, 201);
  }

  if (path.join("/") === "admin/access-groups") {
    await requireWorkspacePermission(user, "group.manage");
    const data = z
      .object({
        code: z
          .string()
          .trim()
          .min(2)
          .max(80)
          .regex(/^[a-z][a-z0-9_.-]*$/),
        name: z.string().trim().min(2).max(160),
        description: z.string().max(500).optional().default(""),
        parent_group_id: id.nullable().optional(),
        source: z.enum(["local", "ldap", "oidc", "scim"]).default("local"),
        external_key: z.string().max(255).nullable().optional(),
        members: z.array(id).max(5000).default([]),
      })
      .parse(await input(request));
    if (
      data.parent_group_id &&
      !(await one(
        "SELECT id FROM access_groups WHERE id=? AND workspace_id=?",
        [data.parent_group_id, user.workspace_id],
      ))
    )
      throw new ApiError(422, "Родительская группа не найдена");
    const uniqueMembers = [...new Set(data.members)];
    if (uniqueMembers.length) {
      const placeholders = uniqueMembers.map(() => "?").join(",");
      const existing = await rows(
        `SELECT id FROM users WHERE workspace_id=? AND id IN (${placeholders})`,
        [user.workspace_id, ...uniqueMembers],
      );
      if (existing.length !== uniqueMembers.length)
        throw new ApiError(422, "Один или несколько пользователей не найдены");
    }
    const groupId = await transaction(async (connection) => {
      const [created] = await connection.query(
        "INSERT INTO access_groups (workspace_id, parent_group_id, code, name, description, source, external_key) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
          user.workspace_id,
          data.parent_group_id || null,
          data.code,
          data.name,
          data.description,
          data.source,
          data.external_key || null,
        ],
      );
      for (const userId of uniqueMembers)
        await connection.query(
          "INSERT INTO access_group_members (group_id, user_id, membership_source) VALUES (?, ?, 'direct')",
          [created.insertId, userId],
        );
      return created.insertId;
    });
    await audit(
      user,
      "access_group.created",
      "access_group",
      groupId,
      { code: data.code, members: uniqueMembers.length },
      request,
    );
    return json({ id: groupId }, 201);
  }

  if (path.join("/") === "admin/access-roles") {
    await requireWorkspacePermission(user, "role.manage");
    const data = accessRoleSchema.parse(await input(request));
    const roleId = await transaction(async (connection) => {
      const [created] = await connection.query(
        "INSERT INTO access_roles (workspace_id, code, name, description, scope, active) VALUES (?, ?, ?, ?, ?, ?)",
        [
          user.workspace_id,
          data.code,
          data.name,
          data.description,
          data.scope,
          data.active,
        ],
      );
      await replaceRoleDetails(
        connection,
        user,
        created.insertId,
        data.scope,
        data.permissions,
        data.assignments,
      );
      return created.insertId;
    });
    await audit(
      user,
      "access_role.created",
      "access_role",
      roleId,
      {
        code: data.code,
        permissions: data.permissions.length,
        assignments: data.assignments.length,
      },
      request,
    );
    return json({ id: roleId }, 201);
  }

  if (path.join("/") === "admin/project-templates") {
    await requireWorkspacePermission(user, "project.template.manage");
    const data = projectTemplateSchema.parse(await input(request));
    await validateProjectTemplateReferences(user, data);
    const [created] = await db.query(
      "INSERT INTO project_templates (workspace_id, name, description, workflow_id, issue_type_scheme_id, permission_scheme_id, default_group_id, color, duration_days, default_tasks_json, active, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        user.workspace_id,
        data.name,
        data.description,
        data.workflow_id,
        data.issue_type_scheme_id || null,
        data.permission_scheme_id || null,
        data.default_group_id || null,
        data.color,
        data.duration_days,
        JSON.stringify(data.default_tasks),
        data.active,
        user.id,
      ],
    );
    await audit(
      user,
      "project_template.created",
      "project_template",
      created.insertId,
      { name: data.name },
      request,
    );
    return json({ id: created.insertId }, 201);
  }

  if (path[0] === "admin" && path[1] === "fields") {
    await requireWorkspacePermission(user, "field.manage");
    const data = z
      .object({
        code: z
          .string()
          .trim()
          .min(2)
          .max(80)
          .regex(/^[a-z][a-z0-9_]*$/),
        label: z.string().trim().min(2).max(120),
        field_type: z.enum([
          "text",
          "number",
          "date",
          "select",
          "multiselect",
          "boolean",
          "user",
          "url",
        ]),
        required: z.boolean().default(false),
        options: z.array(z.string().max(120)).default([]),
      })
      .parse(await input(request));
    const [[position]] = await db.query(
      "SELECT COALESCE(MAX(position),0)+100 AS value FROM task_field_definitions WHERE workspace_id = ?",
      [user.workspace_id],
    );
    const [result] = await db.query(
      "INSERT INTO task_field_definitions (workspace_id, code, label, field_type, required, options_json, position) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        user.workspace_id,
        data.code,
        data.label,
        data.field_type,
        data.required,
        JSON.stringify(data.options),
        position.value,
      ],
    );
    await audit(
      user,
      "field.created",
      "task_field",
      result.insertId,
      { label: data.label },
      request,
    );
    return json({ id: result.insertId }, 201);
  }

  if (path.join("/") === "admin/test/mail") {
    await requireWorkspacePermission(user, "mail.manage");
    const result = await testMail(user.workspace_id, user.email);
    return json(result);
  }
  if (path.join("/") === "admin/test/ldap") {
    await requireWorkspacePermission(user, "auth.manage");
    return json(await testLdap(user.workspace_id));
  }
  if (path.join("/") === "admin/test/oidc") {
    await requireWorkspacePermission(user, "auth.manage");
    return json(await testOidc(user.workspace_id));
  }

  if (path[0] === "tasks" && path[1] && path[2] === "comments") {
    const taskId = id.parse(path[1]);
    const task = await one(
      "SELECT t.project_id, p.workspace_id, p.key_code, t.task_number, t.title FROM tasks t JOIN projects p ON p.id=t.project_id WHERE t.id=?",
      [taskId],
    );
    if (!task || task.workspace_id !== user.workspace_id)
      throw new ApiError(404, "Задача не найдена");
    if (
      !(await hasProjectPermission(
        user,
        task.project_id,
        "comment.create",
        task,
      ))
    )
      throw new ApiError(403, "Нет прав на комментарий");
    const data = z
      .object({
        body: z.string().trim().min(1).max(100000),
        is_internal: z.boolean().default(false),
      })
      .parse(await input(request));
    const [result] = await db.query(
      "INSERT INTO comments (task_id, author_id, body, is_internal) VALUES (?, ?, ?, ?)",
      [taskId, user.id, data.body, data.is_internal],
    );
    const watcherIds = await rows(
      "SELECT user_id FROM task_watchers WHERE task_id=? AND user_id<>?",
      [taskId, user.id],
    );
    for (const watcher of watcherIds)
      await createNotification(
        watcher.user_id,
        "comment.created",
        `Новый комментарий в ${task.key_code}-${task.task_number}`,
        data.body.slice(0, 300),
        "task",
        taskId,
        `/tasks/${taskId}`,
      );
    await emitEvent({
      workspaceId: user.workspace_id,
      eventType: "comment.created",
      aggregateType: "task",
      aggregateId: taskId,
      payload: {
        task_id: taskId,
        project_id: task.project_id,
        comment_id: result.insertId,
        author_id: user.id,
        title: task.title,
      },
    });
    return json({ id: result.insertId }, 201);
  }

  if (path[0] === "tasks" && path[1] && path[2] === "checklist") {
    const taskId = id.parse(path[1]);
    const task = await one(
      "SELECT t.project_id, p.workspace_id FROM tasks t JOIN projects p ON p.id=t.project_id WHERE t.id=?",
      [taskId],
    );
    if (
      !task ||
      task.workspace_id !== user.workspace_id ||
      !(await hasProjectPermission(user, task.project_id, "task.edit", task))
    )
      throw new ApiError(403, "Нет прав на изменение задачи");
    const data = z
      .object({ title: z.string().trim().min(1).max(500) })
      .parse(await input(request));
    const [[position]] = await db.query(
      "SELECT COALESCE(MAX(position),0)+100 AS value FROM task_checklist_items WHERE task_id=?",
      [taskId],
    );
    const [result] = await db.query(
      "INSERT INTO task_checklist_items (task_id, title, position) VALUES (?, ?, ?)",
      [taskId, data.title, position.value],
    );
    return json({ id: result.insertId }, 201);
  }

  if (path[0] === "tasks" && path[1] && path[2] === "worklogs") {
    const taskId = id.parse(path[1]);
    const task = await one(
      "SELECT t.project_id, p.workspace_id FROM tasks t JOIN projects p ON p.id=t.project_id WHERE t.id=?",
      [taskId],
    );
    if (
      !task ||
      task.workspace_id !== user.workspace_id ||
      !(await hasProjectPermission(
        user,
        task.project_id,
        "worklog.create",
        task,
      ))
    )
      throw new ApiError(403, "Нет прав на списание времени");
    const data = z
      .object({
        minutes_spent: z.coerce.number().int().min(1).max(100000),
        work_date: z.string(),
        description: z.string().max(1000).optional().default(""),
      })
      .parse(await input(request));
    const resultId = await transaction(async (connection) => {
      const [result] = await connection.query(
        "INSERT INTO worklogs (task_id, user_id, minutes_spent, work_date, description) VALUES (?, ?, ?, ?, ?)",
        [taskId, user.id, data.minutes_spent, data.work_date, data.description],
      );
      await connection.query(
        "UPDATE tasks SET spent_minutes=spent_minutes+?, version_number=version_number+1 WHERE id=?",
        [data.minutes_spent, taskId],
      );
      return result.insertId;
    });
    return json({ id: resultId }, 201);
  }

  if (path[0] === "tasks" && path[1] && path[2] === "watch") {
    const taskId = id.parse(path[1]);
    const task = await one(
      "SELECT p.workspace_id FROM tasks t JOIN projects p ON p.id=t.project_id WHERE t.id=?",
      [taskId],
    );
    if (!task || task.workspace_id !== user.workspace_id)
      throw new ApiError(404, "Задача не найдена");
    const existing = await one(
      "SELECT task_id FROM task_watchers WHERE task_id=? AND user_id=?",
      [taskId, user.id],
    );
    if (existing)
      await rows("DELETE FROM task_watchers WHERE task_id=? AND user_id=?", [
        taskId,
        user.id,
      ]);
    else
      await rows("INSERT INTO task_watchers (task_id, user_id) VALUES (?, ?)", [
        taskId,
        user.id,
      ]);
    return json({ watching: !existing });
  }

  if (
    path[0] === "tasks" &&
    path[1] &&
    path[2] === "attachments" &&
    path[3] === "presign"
  ) {
    const taskId = id.parse(path[1]);
    const task = await one(
      "SELECT t.project_id, p.workspace_id FROM tasks t JOIN projects p ON p.id=t.project_id WHERE t.id=?",
      [taskId],
    );
    if (
      !task ||
      task.workspace_id !== user.workspace_id ||
      !(await hasProjectPermission(
        user,
        task.project_id,
        "attachment.manage",
        task,
      ))
    )
      throw new ApiError(403, "Нет прав на добавление файла");
    const data = z
      .object({
        file_name: z.string().trim().min(1).max(500),
        size_bytes: z.coerce.number().int().min(1),
        mime_type: z
          .string()
          .max(200)
          .optional()
          .default("application/octet-stream"),
        checksum_sha256: z
          .string()
          .regex(/^[a-f0-9]{64}$/i)
          .optional(),
      })
      .parse(await input(request));
    if (data.size_bytes > Number(process.env.MAX_ATTACHMENT_BYTES || 26214400))
      throw new ApiError(413, "Файл превышает допустимый размер");
    const objectKey = attachmentKey(
      user.workspace_id,
      task.project_id,
      taskId,
      data.file_name,
    );
    return json({
      upload_url: await presignedUpload(objectKey),
      object_key: objectKey,
      file_name: safeFileName(data.file_name),
      expires_in: 900,
    });
  }

  if (
    path[0] === "tasks" &&
    path[1] &&
    path[2] === "attachments" &&
    path[3] === "complete"
  ) {
    const taskId = id.parse(path[1]);
    const task = await one(
      "SELECT t.project_id, p.workspace_id FROM tasks t JOIN projects p ON p.id=t.project_id WHERE t.id=?",
      [taskId],
    );
    if (
      !task ||
      task.workspace_id !== user.workspace_id ||
      !(await hasProjectPermission(
        user,
        task.project_id,
        "attachment.manage",
        task,
      ))
    )
      throw new ApiError(403, "Нет прав на добавление файла");
    const data = z
      .object({
        object_key: z.string().min(20).max(700),
        file_name: z.string().min(1).max(500),
        mime_type: z.string().max(200).optional(),
        checksum_sha256: z
          .string()
          .regex(/^[a-f0-9]{64}$/i)
          .optional(),
      })
      .parse(await input(request));
    if (
      !data.object_key.startsWith(
        `workspaces/${user.workspace_id}/projects/${task.project_id}/tasks/${taskId}/`,
      )
    )
      throw new ApiError(400, "Некорректный ключ объекта");
    const info = await objectInfo(data.object_key);
    if (info.size > Number(process.env.MAX_ATTACHMENT_BYTES || 26214400)) {
      await deleteObject(data.object_key);
      throw new ApiError(413, "Файл превышает допустимый размер");
    }
    const [result] = await db.query(
      "INSERT INTO task_attachments (task_id, uploaded_by, file_name, object_key, mime_type, size_bytes, checksum_sha256) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        taskId,
        user.id,
        safeFileName(data.file_name),
        data.object_key,
        data.mime_type || info.metaData?.["content-type"] || null,
        info.size,
        data.checksum_sha256 || null,
      ],
    );
    await emitEvent({
      workspaceId: user.workspace_id,
      eventType: "attachment.created",
      aggregateType: "task",
      aggregateId: taskId,
      payload: {
        task_id: taskId,
        project_id: task.project_id,
        attachment_id: result.insertId,
        file_name: data.file_name,
      },
    });
    return json({ id: result.insertId }, 201);
  }

  if (path[0] === "sprints" && path.length === 1) {
    const data = z
      .object({
        project_id: id,
        name: z.string().trim().min(2).max(160),
        goal: z.string().max(10000).optional().default(""),
        start_date: z.string().nullable().optional(),
        end_date: z.string().nullable().optional(),
      })
      .parse(await input(request));
    await assertProject(user, data.project_id, true, "sprint.manage");
    const [result] = await db.query(
      "INSERT INTO sprints (project_id, name, goal, start_date, end_date, created_by) VALUES (?, ?, ?, ?, ?, ?)",
      [
        data.project_id,
        data.name,
        data.goal,
        data.start_date || null,
        data.end_date || null,
        user.id,
      ],
    );
    await emitEvent({
      workspaceId: user.workspace_id,
      eventType: "sprint.created",
      aggregateType: "sprint",
      aggregateId: result.insertId,
      payload: { project_id: data.project_id, name: data.name },
    });
    return json({ id: result.insertId }, 201);
  }

  if (
    path[0] === "sprints" &&
    path[1] &&
    ["start", "complete"].includes(path[2])
  ) {
    const sprintId = id.parse(path[1]);
    const sprint = await one(
      "SELECT s.*, p.workspace_id FROM sprints s JOIN projects p ON p.id=s.project_id WHERE s.id=?",
      [sprintId],
    );
    if (!sprint || sprint.workspace_id !== user.workspace_id)
      throw new ApiError(404, "Спринт не найден");
    await assertProject(user, sprint.project_id, true, "sprint.manage");
    if (path[2] === "start") {
      const active = await one(
        "SELECT id FROM sprints WHERE project_id=? AND status='active' AND id<>?",
        [sprint.project_id, sprintId],
      );
      if (active) throw new ApiError(409, "В проекте уже есть активный спринт");
      await rows(
        "UPDATE sprints SET status='active', start_date=COALESCE(start_date,CURRENT_DATE), end_date=COALESCE(end_date,DATE_ADD(CURRENT_DATE,INTERVAL 14 DAY)) WHERE id=?",
        [sprintId],
      );
      await emitEvent({
        workspaceId: user.workspace_id,
        eventType: "sprint.started",
        aggregateType: "sprint",
        aggregateId: sprintId,
        payload: { project_id: sprint.project_id },
      });
    } else {
      const body = z
        .object({ move_open_to_sprint_id: id.nullable().optional() })
        .parse(await input(request));
      await transaction(async (connection) => {
        await connection.query(
          "UPDATE sprints SET status='completed', completed_at=CURRENT_TIMESTAMP WHERE id=?",
          [sprintId],
        );
        await connection.query(
          "UPDATE tasks SET sprint_id=? WHERE sprint_id=? AND stage_id IN (SELECT id FROM workflow_stages WHERE is_done=FALSE)",
          [body.move_open_to_sprint_id || null, sprintId],
        );
        await emitEvent(
          {
            workspaceId: user.workspace_id,
            eventType: "sprint.completed",
            aggregateType: "sprint",
            aggregateId: sprintId,
            payload: { project_id: sprint.project_id },
          },
          connection,
        );
      });
    }
    return json({ ok: true });
  }

  if (path[0] === "releases" && path.length === 1) {
    const data = z
      .object({
        project_id: id,
        name: z.string().trim().min(1).max(120),
        description: z.string().max(10000).optional().default(""),
        start_date: z.string().nullable().optional(),
        release_date: z.string().nullable().optional(),
      })
      .parse(await input(request));
    await assertProject(user, data.project_id, true, "release.manage");
    const [result] = await db.query(
      "INSERT INTO releases (project_id, name, description, start_date, release_date) VALUES (?, ?, ?, ?, ?)",
      [
        data.project_id,
        data.name,
        data.description,
        data.start_date || null,
        data.release_date || null,
      ],
    );
    return json({ id: result.insertId }, 201);
  }

  if (path[0] === "releases" && path[1] && path[2] === "release") {
    const release = await one(
      "SELECT r.*, p.workspace_id FROM releases r JOIN projects p ON p.id=r.project_id WHERE r.id=?",
      [id.parse(path[1])],
    );
    if (!release || release.workspace_id !== user.workspace_id)
      throw new ApiError(404, "Релиз не найден");
    await assertProject(user, release.project_id, true, "release.manage");
    await rows(
      "UPDATE releases SET status='released', released_at=CURRENT_TIMESTAMP, release_date=COALESCE(release_date,CURRENT_DATE) WHERE id=?",
      [release.id],
    );
    await emitEvent({
      workspaceId: user.workspace_id,
      eventType: "release.published",
      aggregateType: "release",
      aggregateId: release.id,
      payload: { project_id: release.project_id, name: release.name },
    });
    return json({ ok: true });
  }

  if (path[0] === "filters") {
    const data = z
      .object({
        name: z.string().trim().min(2).max(180),
        query_text: z.string().trim().min(1).max(3000),
        is_shared: z.boolean().default(false),
        is_favorite: z.boolean().default(false),
      })
      .parse(await input(request));
    try {
      compileQuery(data.query_text, user);
    } catch (error) {
      throw new ApiError(422, error.message);
    }
    const [result] = await db.query(
      "INSERT INTO saved_filters (workspace_id, owner_id, name, query_text, is_shared, is_favorite) VALUES (?, ?, ?, ?, ?, ?)",
      [
        user.workspace_id,
        user.id,
        data.name,
        data.query_text,
        data.is_shared,
        data.is_favorite,
      ],
    );
    return json({ id: result.insertId }, 201);
  }

  if (path[0] === "admin" && path[1] === "automation") {
    await requireWorkspacePermission(user, "automation.manage");
    const data = z
      .object({
        project_id: id.nullable().optional(),
        name: z.string().trim().min(2).max(180),
        description: z.string().max(500).optional().default(""),
        enabled: z.boolean().default(true),
        trigger_type: z.string().trim().min(2).max(100),
        trigger_config: z.record(z.any()).default({}),
        conditions: z.array(z.record(z.any())).default([]),
        actions: z.array(z.record(z.any())).min(1),
      })
      .parse(await input(request));
    const [result] = await db.query(
      "INSERT INTO automation_rules (workspace_id, project_id, name, description, enabled, trigger_type, trigger_config_json, conditions_json, actions_json, run_as_user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        user.workspace_id,
        data.project_id || null,
        data.name,
        data.description,
        data.enabled,
        data.trigger_type,
        JSON.stringify(data.trigger_config),
        JSON.stringify(data.conditions),
        JSON.stringify(data.actions),
        user.id,
      ],
    );
    await audit(
      user,
      "automation.created",
      "automation_rule",
      result.insertId,
      { name: data.name },
      request,
    );
    return json({ id: result.insertId }, 201);
  }

  if (path[0] === "admin" && path[1] === "webhooks") {
    await requireWorkspacePermission(user, "integration.manage");
    const data = z
      .object({
        name: z.string().trim().min(2).max(180),
        target_url: z.string().url().max(1000),
        secret: z.string().max(500).optional(),
        event_types: z.array(z.string().max(120)).min(1),
        enabled: z.boolean().default(true),
      })
      .parse(await input(request));
    const [result] = await db.query(
      "INSERT INTO webhooks (workspace_id, name, target_url, secret_encrypted, event_types_json, enabled, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        user.workspace_id,
        data.name,
        data.target_url,
        data.secret ? encryptSecret(data.secret) : null,
        JSON.stringify(data.event_types),
        data.enabled,
        user.id,
      ],
    );
    await audit(
      user,
      "webhook.created",
      "webhook",
      result.insertId,
      { name: data.name, target_url: data.target_url },
      request,
    );
    return json({ id: result.insertId }, 201);
  }

  if (path[0] === "admin" && path[1] === "api-tokens") {
    await requireWorkspacePermission(user, "integration.manage");
    await requireBrowserSession(user);
    const data = personalTokenSchema.parse(await input(request));
    await assertApiPolicy(user, data.scopes, data.expires_at);
    const rawToken = `kw_${crypto.randomBytes(32).toString("base64url")}`;
    const hash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const [result] = await db.query(
      "INSERT INTO api_tokens (workspace_id, user_id, name, token_prefix, token_hash, scopes_json, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        user.workspace_id,
        user.id,
        data.name,
        rawToken.slice(0, 12),
        hash,
        JSON.stringify(data.scopes),
        data.expires_at ? new Date(data.expires_at) : null,
      ],
    );
    await audit(
      user,
      "api_token.created",
      "api_token",
      result.insertId,
      { name: data.name },
      request,
    );
    return json(
      {
        id: result.insertId,
        token: rawToken,
        warning: "Токен показывается только один раз",
      },
      201,
    );
  }

  if (path[0] === "knowledge" && path[1] === "teams" && path.length === 2) {
    const data = z
      .object({
        name: z.string().trim().min(2).max(180),
        slug: z
          .string()
          .regex(/^[a-z0-9][a-z0-9-]*$/)
          .max(100),
        description: z.string().max(500).optional().default(""),
        color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default("#675EE7"),
        member_ids: z.array(id).max(10000).default([]),
        lead_ids: z.array(id).max(500).default([]),
      })
      .parse(await input(request));
    await requireWorkspacePermission(user, "knowledge.manage");
    const leadIds = data.lead_ids.length ? data.lead_ids : [Number(user.id)];
    const teamId = await transaction(async (connection) => {
      const [result] = await connection.query(
        "INSERT INTO knowledge_teams (workspace_id, name, slug, description, color, created_by) VALUES (?, ?, ?, ?, ?, ?)",
        [
          user.workspace_id,
          data.name,
          data.slug,
          data.description,
          data.color,
          user.id,
        ],
      );
      await replaceKnowledgeTeamMembers(
        connection,
        result.insertId,
        user.workspace_id,
        user.id,
        data.member_ids,
        leadIds,
      );
      return result.insertId;
    });
    await audit(
      user,
      "knowledge.team.created",
      "knowledge_team",
      teamId,
      { name: data.name },
      request,
    );
    return json({ id: teamId }, 201);
  }

  if (path[0] === "knowledge" && path[1] === "spaces" && path.length === 2) {
    const data = z
      .object({
        name: z.string().trim().min(2).max(180),
        slug: z
          .string()
          .regex(/^[a-z0-9][a-z0-9-]*$/)
          .max(100),
        description: z.string().max(500).optional().default(""),
        visibility: z
          .enum(["private", "restricted", "workspace", "public"])
          .default("restricted"),
        owner_team_id: id.nullable().optional(),
      })
      .parse(await input(request));
    const globalManager = await hasWorkspacePermission(user, "knowledge.manage");
    if (
      !globalManager &&
      (!data.owner_team_id ||
        !(await canManageKnowledgeTeam(user, data.owner_team_id)))
    )
      throw new ApiError(403, "Создавать пространство может администратор базы знаний или руководитель команды");
    let ownerTeam = null;
    if (data.owner_team_id) {
      ownerTeam = await one(
        "SELECT id FROM knowledge_teams WHERE id=? AND workspace_id=? AND active=TRUE",
        [data.owner_team_id, user.workspace_id],
      );
      if (!ownerTeam) throw new ApiError(422, "Команда пространства не найдена");
    }
    const spaceId = await transaction(async (connection) => {
      const [result] = await connection.query(
        "INSERT INTO knowledge_spaces (workspace_id, name, slug, description, visibility, owner_team_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
          user.workspace_id,
          data.name,
          data.slug,
          data.description,
          data.visibility,
          data.owner_team_id || null,
          user.id,
        ],
      );
      await connection.query(
        "INSERT INTO knowledge_space_permissions (space_id, principal_type, principal_id, access_level, granted_by) VALUES (?, 'user', ?, 'admin', ?)",
        [result.insertId, user.id, user.id],
      );
      if (data.owner_team_id)
        await connection.query(
          "INSERT INTO knowledge_space_permissions (space_id, principal_type, principal_id, access_level, granted_by) VALUES (?, 'team', ?, 'edit', ?)",
          [result.insertId, data.owner_team_id, user.id],
        );
      return result.insertId;
    });
    await audit(
      user,
      "knowledge.space.created",
      "knowledge_space",
      spaceId,
      { name: data.name, visibility: data.visibility },
      request,
    );
    return json({ id: spaceId }, 201);
  }

  if (path[0] === "knowledge" && path[1] === "articles" && path.length === 2) {
    const data = z
      .object({
        space_id: id,
        parent_id: id.nullable().optional(),
        title: z.string().trim().min(2).max(300),
        slug: z
          .string()
          .regex(/^[a-z0-9][a-z0-9-]*$/)
          .max(180),
        body: z.string().min(1).max(1000000),
        status: z.enum(["draft", "published"]).default("draft"),
      })
      .parse(await input(request));
    const space = await one(
      "SELECT * FROM knowledge_spaces WHERE id=? AND workspace_id=?",
      [data.space_id, user.workspace_id],
    );
    if (!space) throw new ApiError(404, "Раздел базы знаний не найден");
    await assertKnowledgeAccess(user, space, "edit");
    const [result] = await db.query(
      "INSERT INTO knowledge_articles (space_id, parent_id, title, slug, body, status, author_id, published_at) VALUES (?, ?, ?, ?, ?, ?, ?, IF(?='published',CURRENT_TIMESTAMP,NULL))",
      [
        data.space_id,
        data.parent_id || null,
        data.title,
        data.slug,
        data.body,
        data.status,
        user.id,
        data.status,
      ],
    );
    return json({ id: result.insertId }, 201);
  }

  if (path[0] === "imports" && path[1] === "presign") {
    await requireWorkspacePermission(user, "import.manage");
    const data = z
      .object({
        file_name: z.string().min(1).max(500),
        source_type: z.enum(["jira_json", "jira_csv", "csv"]),
      })
      .parse(await input(request));
    const objectKey = `imports/${user.workspace_id}/${crypto.randomUUID()}-${safeFileName(data.file_name)}`;
    return json({
      upload_url: await presignedUpload(objectKey),
      object_key: objectKey,
      expires_in: 900,
    });
  }

  if (path[0] === "imports" && path[1] === "complete") {
    await requireWorkspacePermission(user, "import.manage");
    const data = z
      .object({
        object_key: z.string().min(20).max(700),
        source_type: z.enum(["jira_json", "jira_csv", "csv"]),
        options: z.record(z.any()).default({}),
      })
      .parse(await input(request));
    if (!data.object_key.startsWith(`imports/${user.workspace_id}/`))
      throw new ApiError(400, "Некорректный ключ импорта");
    await objectInfo(data.object_key);
    const [result] = await db.query(
      "INSERT INTO import_jobs (workspace_id, requested_by, source_type, object_key, options_json) VALUES (?, ?, ?, ?, ?)",
      [
        user.workspace_id,
        user.id,
        data.source_type,
        data.object_key,
        JSON.stringify(data.options),
      ],
    );
    await enqueue(
      "import",
      { importJobId: result.insertId },
      { jobId: `import-${result.insertId}` },
    );
    return json({ id: result.insertId, status: "queued" }, 202);
  }

  throw new ApiError(404, "Маршрут не найден");
}

async function handlePatch(request, path) {
  const user = await requireUser(request);
  if (path[0] === "chat" && path[1] === "rooms") return chatRoomsApi(request,path,user);
  if (path[0] === "work") return handleWorkApi(request, path.slice(1), user);
  if (path[0] === "admin" && path[1] === "automation") return handleWorkApi(request, ["automations", ...path.slice(2)], user);
  if (path[0] === "conferences" && path[2] === "recordings") return handleRecordingApi(request, path, user);
  if (path[0] === "projects" && ((path.length === 1 && request.method === "GET") || (path.length === 2 && ["PATCH", "DELETE"].includes(request.method)) || ["access", "archive", "restore", "members"].includes(path[2]))) return handleProjectAccessApi(request, path, user);
  if (path[0] === "ai" || (path[0] === "admin" && path[1] === "ai") || (["projects", "conferences"].includes(path[0]) && path[2] === "ai")) return handleAiApi(request, path, user);
  if (
    path[0] === "knowledge" &&
    path[1] === "teams" &&
    path[2] &&
    path.length === 3
  ) {
    const teamId = id.parse(path[2]);
    const team = await one(
      "SELECT * FROM knowledge_teams WHERE id=? AND workspace_id=?",
      [teamId, user.workspace_id],
    );
    if (!team) throw new ApiError(404, "Команда не найдена");
    if (!(await canManageKnowledgeTeam(user, teamId)))
      throw new ApiError(403, "Нет права управлять этой командой");
    const data = z
      .object({
        name: z.string().trim().min(2).max(180).optional(),
        slug: z
          .string()
          .regex(/^[a-z0-9][a-z0-9-]*$/)
          .max(100)
          .optional(),
        description: z.string().max(500).optional(),
        color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
        active: z.boolean().optional(),
        member_ids: z.array(id).max(10000).optional(),
        lead_ids: z.array(id).max(500).optional(),
      })
      .parse(await input(request));
    const updates = [],
      values = [];
    for (const key of ["name", "slug", "description", "color", "active"])
      if (Object.hasOwn(data, key)) {
        updates.push(`${key}=?`);
        values.push(data[key]);
      }
    await transaction(async (connection) => {
      if (updates.length)
        await connection.query(
          `UPDATE knowledge_teams SET ${updates.join(",")} WHERE id=?`,
          [...values, teamId],
        );
      if (data.member_ids || data.lead_ids) {
        const currentMembers = data.member_ids ||
          (
            await connection.query(
              "SELECT user_id FROM knowledge_team_members WHERE team_id=?",
              [teamId],
            )
          )[0].map((item) => item.user_id);
        const currentLeads = data.lead_ids ||
          (
            await connection.query(
              "SELECT user_id FROM knowledge_team_members WHERE team_id=? AND team_role='lead'",
              [teamId],
            )
          )[0].map((item) => item.user_id);
        await replaceKnowledgeTeamMembers(
          connection,
          teamId,
          user.workspace_id,
          user.id,
          currentMembers,
          currentLeads,
        );
      }
    });
    await audit(
      user,
      "knowledge.team.updated",
      "knowledge_team",
      teamId,
      { fields: Object.keys(data) },
      request,
    );
    return json({ ok: true });
  }
  if (
    path[0] === "knowledge" &&
    path[1] === "spaces" &&
    path[2] &&
    path.length === 3
  ) {
    const spaceId = id.parse(path[2]);
    const { space } = await assertKnowledgeAccess(user, spaceId, "admin");
    const data = z
      .object({
        name: z.string().trim().min(2).max(180).optional(),
        description: z.string().max(500).optional(),
        visibility: z
          .enum(["private", "restricted", "workspace", "public"])
          .optional(),
        owner_team_id: id.nullable().optional(),
      })
      .parse(await input(request));
    if (data.owner_team_id) {
      const team = await one(
        "SELECT id FROM knowledge_teams WHERE id=? AND workspace_id=? AND active=TRUE",
        [data.owner_team_id, user.workspace_id],
      );
      if (!team) throw new ApiError(422, "Команда пространства не найдена");
      if (
        !(await hasWorkspacePermission(user, "knowledge.manage")) &&
        !(await canManageKnowledgeTeam(user, data.owner_team_id))
      )
        throw new ApiError(403, "Пространство можно передать только управляемой вами команде");
    }
    const updates = [],
      values = [];
    for (const key of ["name", "description", "visibility", "owner_team_id"])
      if (Object.hasOwn(data, key)) {
        updates.push(`${key}=?`);
        values.push(data[key] || null);
      }
    if (updates.length)
      await rows(
        `UPDATE knowledge_spaces SET ${updates.join(",")} WHERE id=?`,
        [...values, space.id],
      );
    await audit(
      user,
      "knowledge.space.updated",
      "knowledge_space",
      space.id,
      { fields: Object.keys(data) },
      request,
    );
    return json({ ok: true });
  }
  if (
    path[0] === "conferences" &&
    path[1] &&
    path[2] === "questions" &&
    path[3] &&
    path.length === 4
  ) {
    const conference = await assertConference(user, id.parse(path[1]), true);
    const messageId = id.parse(path[3]);
    const data = z
      .object({ status: z.enum(["open", "answered", "dismissed"]) })
      .parse(await input(request));
    const question = await one(
      "SELECT id FROM conference_messages WHERE id=? AND conference_id=? AND message_type='question' AND deleted_at IS NULL",
      [messageId, conference.id],
    );
    if (!question) throw new ApiError(404, "Вопрос не найден");
    await rows(
      `UPDATE conference_messages
       SET question_status=?, moderated_by=?, moderated_at=?, revision=revision+1
       WHERE id=?`,
      [
        data.status,
        data.status === "open" ? null : user.id,
        data.status === "open" ? null : new Date(),
        messageId,
      ],
    );
    await audit(
      user,
      "conference.question.moderated",
      "conference",
      conference.id,
      { message_id: messageId, status: data.status },
      request,
    );
    const message = await one(
      `SELECT message.*, sender.display_name AS sender_name, sender.avatar_color AS sender_color,
              moderator.display_name AS moderator_name
       FROM conference_messages message
       JOIN users sender ON sender.id=message.sender_id
       LEFT JOIN users moderator ON moderator.id=message.moderated_by
       WHERE message.id=?`,
      [messageId],
    );
    await broadcastConferenceEvent(conference, { type: "question", message });
    return json(message);
  }
  if (
    path[0] === "conferences" &&
    path[1] &&
    path[2] === "participants" &&
    path[3] &&
    path.length === 4
  ) {
    const conference = await assertConference(user, id.parse(path[1]), true);
    const participantId = id.parse(path[3]);
    z.object({ raised: z.literal(false) }).parse(await input(request));
    const participant = await one(
      "SELECT user_id FROM conference_participants WHERE conference_id=? AND user_id=?",
      [conference.id, participantId],
    );
    if (!participant) throw new ApiError(404, "Участник конференции не найден");
    await rows(
      "UPDATE conference_participants SET hand_raised_at=NULL WHERE conference_id=? AND user_id=?",
      [conference.id, participantId],
    );
    await audit(
      user,
      "conference.hand.lowered",
      "conference",
      conference.id,
      { user_id: participantId },
      request,
    );
    const raised = await one(
      "SELECT COUNT(*) AS value FROM conference_participants WHERE conference_id=? AND hand_raised_at IS NOT NULL",
      [conference.id],
    );
    const result = {
      user_id: participantId,
      raised: false,
      hand_raised_at: null,
      raised_count: Number(raised?.value || 0),
    };
    await broadcastConferenceEvent(conference, { type: "hand", ...result });
    return json(result);
  }
  if (path[0] === "conferences" && path[1] && path.length === 2) {
    const conference = await assertConference(user, id.parse(path[1]), true);
    const data = z
      .object({
        title: z.string().trim().min(2).max(220).optional(),
        description: z.string().max(1000).optional(),
        scheduled_start: z.string().datetime().optional(),
        scheduled_end: z.string().datetime().optional(),
        status: z
          .enum(["scheduled", "live", "completed", "cancelled"])
          .optional(),
        conference_mode: z.enum(["interactive", "webinar"]).optional(),
        max_publishers: z.coerce.number().int().min(1).max(150).optional(),
        participant_ids: z.array(id).max(3000).optional(),
        presenter_ids: z.array(id).max(150).optional(),
      })
      .parse(await input(request));
    if(['completed','cancelled'].includes(conference.status)&&data.status&&!['completed','cancelled'].includes(data.status))throw new ApiError(409,'Завершённую встречу нельзя открыть повторно. Создайте новую встречу');
    const start = data.scheduled_start || conference.scheduled_start;
    const end = data.scheduled_end || conference.scheduled_end;
    if (new Date(end) <= new Date(start))
      throw new ApiError(422, "Конференция должна закончиться после начала");
    const mode = data.conference_mode || conference.conference_mode;
    const updates = [],
      values = [];
    for (const key of [
      "title",
      "description",
      "scheduled_start",
      "scheduled_end",
      "status",
      "conference_mode",
      "max_publishers",
    ])
      if (Object.hasOwn(data, key)) {
        updates.push(`${key}=?`);
        values.push(
          ["scheduled_start", "scheduled_end"].includes(key)
            ? new Date(data[key])
            : data[key],
        );
      }
    if (
      mode === "interactive" &&
      Object.hasOwn(data, "conference_mode") &&
      !Object.hasOwn(data, "max_publishers")
    ) {
      updates.push("max_publishers=?");
      values.push(150);
    }
    await transaction(async (connection) => {
      if (updates.length)
        await connection.query(
          `UPDATE conferences SET ${updates.join(",")} WHERE id=?`,
          [...values, conference.id],
        );
      if (data.participant_ids || data.presenter_ids) {
        const currentParticipants =
          data.participant_ids ||
          (
            await connection.query(
              "SELECT user_id FROM conference_participants WHERE conference_id=?",
              [conference.id],
            )
          )[0].map((item) => item.user_id);
        const selectedPresenters = data.presenter_ids ||
          (
            await connection.query(
              "SELECT user_id FROM conference_participants WHERE conference_id=? AND participant_role='presenter'",
              [conference.id],
            )
          )[0].map((item) => item.user_id);
        const presenters = [
          ...new Set(
            selectedPresenters
              .map(Number)
              .filter((userId) => userId !== Number(conference.created_by)),
          ),
        ];
        const participants = [
          ...new Set([
            Number(conference.created_by),
            ...currentParticipants.map(Number),
            ...presenters,
          ]),
        ];
        const [participantRows] = await connection.query(
          `SELECT id FROM users WHERE workspace_id=? AND status='active' AND id IN (${participants.map(() => "?").join(",")})`,
          [user.workspace_id, ...participants],
        );
        if (participantRows.length !== participants.length)
          throw new ApiError(422, "Один или несколько участников недоступны");
        await connection.query(
          `DELETE FROM conference_participants WHERE conference_id=? AND user_id NOT IN (${participants.map(() => "?").join(",")})`,
          [conference.id, ...participants],
        );
        await connection.query(
          "UPDATE conferences SET join_policy=? WHERE id=?",
          [participants.length > 1 ? "invited" : "link", conference.id],
        );
        for (const userId of participants) {
          const role =
            userId === Number(conference.created_by)
              ? "host"
              : presenters.includes(userId)
                ? "presenter"
                : "participant";
          await connection.query(
            "INSERT INTO conference_participants (conference_id, user_id, participant_role, response, responded_at) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE participant_role=VALUES(participant_role)",
            [
              conference.id,
              userId,
              role,
              userId === Number(conference.created_by) ? "accepted" : "pending",
              userId === Number(conference.created_by) ? new Date() : null,
            ],
          );
        }
      }
    });
    const mediaDisconnected=['completed','cancelled'].includes(data.status)?await closeConferenceRooms(conference):null;
    await audit(
      user,
      "conference.updated",
      "conference",
      conference.id,
      { fields: Object.keys(data) },
      request,
    );
    if(mediaDisconnected===false)throw new ApiError(503,'Встреча закрыта для новых подключений, но медиасервер не подтвердил отключение комнат. Повторите завершение встречи');
    return json({ ok: true, ...(mediaDisconnected!==null?{media_disconnected:mediaDisconnected}:{}) });
  }
  if (path[0] === "admin" && path[1] === "task-sla" && path[2]) {
    await requireWorkspacePermission(user, "sla.manage");
    const policyId = id.parse(path[2]);
    const existing = await one(
      "SELECT id,revision FROM task_sla_policies WHERE id=? AND workspace_id=?",
      [policyId, user.workspace_id],
    );
    if (!existing) throw new ApiError(404, "Правило SLA не найдено");
    const data = taskSlaSchema.parse(await input(request));
    await validateSlaConfig(user,data);
    if (
      data.project_id &&
      !(await one("SELECT id FROM projects WHERE id=? AND workspace_id=?", [
        data.project_id,
        user.workspace_id,
      ]))
    )
      throw new ApiError(422, "Проект SLA не найден");
    const changed = await rows(
      "UPDATE task_sla_policies SET project_id=?, name=?, description=?, goal_minutes=?, warning_percent=?, conditions_json=?, enabled=?, position=?, counter_key=?, calendar_id=?, config_json=?, revision=revision+1 WHERE id=? AND workspace_id=? AND revision=?",
      [
        data.project_id || null,
        data.name,
        data.description,
        data.goal_minutes,
        data.warning_percent,
        JSON.stringify(data.conditions),
        data.enabled,
        data.position,
        data.counter_key, data.calendar_id, JSON.stringify(data.config),
        policyId,
        user.workspace_id,
        data.revision||existing.revision,
      ],
    );
    if(!changed.affectedRows)throw new ApiError(409,"Правило изменено другим пользователем. Обновите страницу");
    await audit(
      user,
      "task_sla.updated",
      "task_sla_policy",
      policyId,
      { name: data.name },
      request,
    );
    return json({ ok: true });
  }
  if (path[0] === "admin" && path[1] === "api-access" && path[2]) {
    await requireWorkspacePermission(user, "api.access.manage");
    const targetUserId = id.parse(path[2]);
    if (
      !(await one("SELECT id FROM users WHERE id=? AND workspace_id=?", [
        targetUserId,
        user.workspace_id,
      ]))
    )
      throw new ApiError(404, "Пользователь не найден");
    const data = apiAccessPolicySchema.parse(await input(request));
    await rows(
      `INSERT INTO user_api_access (user_id, workspace_id, enabled, allowed_scopes_json, max_token_ttl_days, updated_by)
                VALUES (?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE enabled=VALUES(enabled), allowed_scopes_json=VALUES(allowed_scopes_json), max_token_ttl_days=VALUES(max_token_ttl_days), updated_by=VALUES(updated_by)`,
      [
        targetUserId,
        user.workspace_id,
        data.enabled,
        JSON.stringify(data.allowed_scopes),
        data.max_token_ttl_days,
        user.id,
      ],
    );
    await audit(
      user,
      "api_access.updated",
      "user",
      targetUserId,
      { enabled: data.enabled, scopes: data.allowed_scopes },
      request,
    );
    return json({ ok: true });
  }
  if (path[0] === "tasks" && path[1]) {
    const taskId = id.parse(path[1]);
    const existing = await one(
      "SELECT t.*, p.workspace_id, p.workflow_id FROM tasks t JOIN projects p ON p.id = t.project_id WHERE t.id = ?",
      [taskId],
    );
    if (!existing || existing.workspace_id !== user.workspace_id)
      throw new ApiError(404, "Задача не найдена");
    await assertProject(user, existing.project_id, true);
    const raw = await input(request);
    const data = taskSchema.partial().parse(raw);
    const expectedVersion = raw.version_number == null ? null : id.parse(raw.version_number);
    await assertFieldEdits(user, existing.project_id, data.custom_values, parseJson(existing.custom_values_json, {}));
    if (
      Object.hasOwn(data, "assignee_id") &&
      Number(data.assignee_id) !== Number(existing.assignee_id) &&
      !(await hasProjectPermission(
        user,
        existing.project_id,
        "task.assign",
        existing,
      ))
    )
      throw new ApiError(403, "Нет права назначать исполнителя");
    if (data.stage_id) {
      const validStage = await one(
        "SELECT id FROM workflow_stages WHERE id = ? AND workflow_id = ?",
        [data.stage_id, existing.workflow_id],
      );
      if (!validStage)
        throw new ApiError(400, "Этап не относится к процессу проекта");
    }
    await validateTaskReferences(user, existing.project_id, data, taskId);
    const allowed = [
      "stage_id",
      "issue_type_id",
      "parent_task_id",
      "epic_task_id",
      "sprint_id",
      "release_id",
      "component_id",
      "title",
      "description",
      "environment",
      "priority",
      "assignee_id",
      "start_date",
      "due_date",
      "estimate_minutes",
      "story_points",
      "progress",
      "resolution",
      "position",
      "rank_value",
      "milestone",
    ];
    const updates = [];
    const values = [];
    for (const key of allowed)
      if (Object.hasOwn(data, key)) {
        updates.push(`${key} = ?`);
        values.push(data[key] === "" ? null : data[key]);
      }
    if (Object.hasOwn(data, "custom_values")) {
      updates.push("custom_values_json = ?");
      values.push(JSON.stringify({ ...parseJson(existing.custom_values_json, {}), ...data.custom_values }));
    }
    await transaction(async (connection) => {
      if (Object.hasOwn(data,"dependencies")) await connection.query("SELECT id FROM workspaces WHERE id=? FOR UPDATE", [user.workspace_id]);
      const [[lockedTask]] = await connection.query("SELECT * FROM tasks WHERE id=? FOR UPDATE", [taskId]);
      if (expectedVersion !== null && Number(lockedTask.version_number) !== expectedVersion) throw new ApiError(409, "Задача уже изменена. Обновите карточку перед сохранением", { current_version: lockedTask.version_number });
      if (Object.hasOwn(data, "assignee_id") && Number(data.assignee_id) !== Number(lockedTask.assignee_id) && !(await hasProjectPermission(user, lockedTask.project_id, "task.assign", lockedTask))) throw new ApiError(403, "Нет права назначать исполнителя");
      await assertTaskGates(user, lockedTask, data, connection);
      if (Object.hasOwn(data, "custom_values")) values[values.length - 1] = JSON.stringify({ ...parseJson(lockedTask.custom_values_json, {}), ...data.custom_values });
      if (!updates.length && Object.hasOwn(data, "dependencies")) await connection.query("UPDATE tasks SET version_number=version_number+1 WHERE id=?", [taskId]);
      if (updates.length)
        await connection.query(
          `UPDATE tasks SET ${updates.join(", ")}, version_number=version_number+1 WHERE id = ?`,
          [...values, taskId],
        );
      if (Object.hasOwn(data, "dependencies"))
        await updateDependencies(connection, taskId, data.dependencies);
      if (updates.length || Object.hasOwn(data, "dependencies")) {
        const [[version]] = await connection.query(
          "SELECT version_number FROM tasks WHERE id=?",
          [taskId],
        );
        await connection.query(
          "INSERT INTO task_revisions (task_id, changed_by, version_number, change_type, changes_json) VALUES (?, ?, ?, 'updated', ?)",
          [taskId, user.id, version.version_number, JSON.stringify(data)],
        );
        await emitEvent(
          {
            workspaceId: user.workspace_id,
            eventType: "task.updated",
            aggregateType: "task",
            aggregateId: taskId,
            payload: {
              task_id: taskId,
              project_id: existing.project_id,
              assignee_id: data.assignee_id ?? existing.assignee_id,
              title: data.title || existing.title,
              changed_fields: Object.keys(data),
            },
          },
          connection,
        );
      }
    });
    if (data.assignee_id && data.assignee_id !== existing.assignee_id)
      await createNotification(
        data.assignee_id,
        "task.assigned",
        "Вам назначена задача",
        data.title || existing.title,
        "task",
        taskId,
        `/tasks/${taskId}`,
      );
    await audit(
      user,
      "task.updated",
      "task",
      taskId,
      { fields: Object.keys(data) },
      request,
    );
    return json({ ok: true });
  }

  if (path[0] === "groups" && path[1]) {
    await requireWorkspacePermission(user, "project.group.manage");
    const groupId = id.parse(path[1]);
    const data = z
      .object({
        name: z.string().trim().min(2).max(160).optional(),
        description: z.string().max(500).optional(),
        color: z
          .string()
          .regex(/^#[0-9A-Fa-f]{6}$/)
          .optional(),
        position: z.number().int().optional(),
      })
      .parse(await input(request));
    const updates = [],
      values = [];
    for (const key of ["name", "description", "color", "position"])
      if (Object.hasOwn(data, key)) {
        updates.push(`${key} = ?`);
        values.push(data[key]);
      }
    if (updates.length)
      await rows(
        `UPDATE project_groups SET ${updates.join(", ")} WHERE id = ? AND workspace_id = ?`,
        [...values, groupId, user.workspace_id],
      );
    await audit(user, "group.updated", "project_group", groupId, data, request);
    return json({ ok: true });
  }

  if (path[0] === "admin" && path[1] === "users" && path[2]) {
    await requireWorkspacePermission(user, "user.manage");
    const userId = id.parse(path[2]);
    const data = z
      .object({
        global_role: z
          .enum(["owner", "admin", "project_manager", "member", "viewer"])
          .optional(),
        status: z.enum(["active", "invited", "blocked"]).optional(),
        display_name: z.string().trim().min(2).max(160).optional(),
        password: z.string().min(10).max(500).optional(),
      })
      .parse(await input(request));
    if (userId === user.id && data.status === "blocked")
      throw new ApiError(
        400,
        "Нельзя заблокировать собственную учётную запись",
      );
    const updates = [],
      values = [];
    for (const key of ["global_role", "status", "display_name"])
      if (Object.hasOwn(data, key)) {
        updates.push(`${key} = ?`);
        values.push(data[key]);
      }
    if (data.status) updates.push("directory_disabled=FALSE");
    if (data.password) {
      updates.push("password_hash = ?, auth_source = 'local'");
      values.push(await bcrypt.hash(data.password, 12));
    }
    if (updates.length) await transaction(async connection=>{
      await connection.query('SELECT id FROM workspaces WHERE id=? FOR UPDATE',[user.workspace_id]);
      const [[target]]=await connection.query('SELECT * FROM users WHERE id=? AND workspace_id=? FOR UPDATE',[userId,user.workspace_id]);
      if(!target)throw new ApiError(404,'Пользователь не найден');
      const [[admins]]=await connection.query("SELECT COUNT(*) AS count FROM users WHERE workspace_id=? AND status='active' AND global_role IN ('owner','admin')",[user.workspace_id]);
      assertAccountChange(user,target,data,Number(admins.count));
      await connection.query(`UPDATE users SET ${updates.join(", ")} WHERE id=? AND workspace_id=?`,[...values,userId,user.workspace_id]);
    });
    await audit(
      user,
      "user.updated",
      "user",
      userId,
      { fields: Object.keys(data).filter((key) => key !== "password") },
      request,
    );
    return json({ ok: true });
  }

  if (path[0] === "admin" && path[1] === "access-groups" && path[2]) {
    await requireWorkspacePermission(user, "group.manage");
    const groupId = id.parse(path[2]);
    const group = await one(
      "SELECT * FROM access_groups WHERE id=? AND workspace_id=?",
      [groupId, user.workspace_id],
    );
    if (!group) throw new ApiError(404, "Группа доступа не найдена");
    const data = z
      .object({
        code: z
          .string()
          .trim()
          .min(2)
          .max(80)
          .regex(/^[a-z][a-z0-9_.-]*$/)
          .optional(),
        name: z.string().trim().min(2).max(160).optional(),
        description: z.string().max(500).optional(),
        parent_group_id: id.nullable().optional(),
        source: z.enum(["local", "ldap", "oidc", "scim"]).optional(),
        external_key: z.string().max(255).nullable().optional(),
        active: z.boolean().optional(),
        members: z.array(id).max(5000).optional(),
      })
      .parse(await input(request));
    if (data.parent_group_id === groupId)
      throw new ApiError(422, "Группа не может быть родителем самой себе");
    if (
      data.parent_group_id &&
      !(await one(
        "SELECT id FROM access_groups WHERE id=? AND workspace_id=?",
        [data.parent_group_id, user.workspace_id],
      ))
    )
      throw new ApiError(422, "Родительская группа не найдена");
    if (data.parent_group_id) {
      const cycle = await one(
        `WITH RECURSIVE descendants AS (
           SELECT id FROM access_groups WHERE id=? AND workspace_id=?
           UNION ALL
           SELECT child.id FROM access_groups child JOIN descendants parent ON child.parent_group_id=parent.id
           WHERE child.workspace_id=?
         ) SELECT id FROM descendants WHERE id=? LIMIT 1`,
        [groupId, user.workspace_id, user.workspace_id, data.parent_group_id],
      );
      if (cycle)
        throw new ApiError(422, "Нельзя создать циклическую вложенность групп");
    }
    const uniqueMembers = data.members ? [...new Set(data.members)] : null;
    if (uniqueMembers?.length) {
      const placeholders = uniqueMembers.map(() => "?").join(",");
      const existing = await rows(
        `SELECT id FROM users WHERE workspace_id=? AND id IN (${placeholders})`,
        [user.workspace_id, ...uniqueMembers],
      );
      if (existing.length !== uniqueMembers.length)
        throw new ApiError(422, "Один или несколько пользователей не найдены");
    }
    await transaction(async (connection) => {
      const updates = [],
        values = [];
      for (const key of [
        "code",
        "name",
        "description",
        "parent_group_id",
        "source",
        "external_key",
        "active",
      ])
        if (Object.hasOwn(data, key)) {
          updates.push(`${key}=?`);
          values.push(data[key] ?? null);
        }
      if (updates.length)
        await connection.query(
          `UPDATE access_groups SET ${updates.join(",")} WHERE id=?`,
          [...values, groupId],
        );
      if (uniqueMembers) {
        await connection.query(
          "DELETE FROM access_group_members WHERE group_id=? AND membership_source='direct'",
          [groupId],
        );
        for (const userId of uniqueMembers)
          await connection.query(
            "INSERT INTO access_group_members (group_id, user_id, membership_source) VALUES (?, ?, 'direct') ON DUPLICATE KEY UPDATE membership_source=VALUES(membership_source)",
            [groupId, userId],
          );
      }
    });
    await audit(
      user,
      "access_group.updated",
      "access_group",
      groupId,
      { fields: Object.keys(data) },
      request,
    );
    return json({ ok: true });
  }

  if (path[0] === "admin" && path[1] === "access-roles" && path[2]) {
    await requireWorkspacePermission(user, "role.manage");
    const roleId = id.parse(path[2]);
    const role = await one(
      "SELECT * FROM access_roles WHERE id=? AND workspace_id=?",
      [roleId, user.workspace_id],
    );
    if (!role) throw new ApiError(404, "Роль доступа не найдена");
    const data = accessRoleSchema.partial().parse(await input(request));
    const scope = data.scope || role.scope;
    const permissions =
      data.permissions ||
      (await rows(
        "SELECT permission_key, effect FROM access_role_permissions WHERE role_id=?",
        [roleId],
      ));
    const assignments =
      data.assignments ||
      (await rows(
        "SELECT principal_type, principal_id, scope_type, scope_id, valid_from, expires_at FROM access_assignments WHERE role_id=?",
        [roleId],
      ));
    await transaction(async (connection) => {
      const updates = [],
        values = [];
      for (const key of ["code", "name", "description", "scope", "active"])
        if (Object.hasOwn(data, key)) {
          updates.push(`${key}=?`);
          values.push(data[key]);
        }
      if (updates.length)
        await connection.query(
          `UPDATE access_roles SET ${updates.join(",")} WHERE id=?`,
          [...values, roleId],
        );
      await replaceRoleDetails(
        connection,
        user,
        roleId,
        scope,
        permissions,
        assignments,
      );
    });
    await audit(
      user,
      "access_role.updated",
      "access_role",
      roleId,
      { fields: Object.keys(data) },
      request,
    );
    return json({ ok: true });
  }

  if (path[0] === "admin" && path[1] === "project-templates" && path[2]) {
    await requireWorkspacePermission(user, "project.template.manage");
    const templateId = id.parse(path[2]);
    const template = await one(
      "SELECT * FROM project_templates WHERE id=? AND workspace_id=?",
      [templateId, user.workspace_id],
    );
    if (!template) throw new ApiError(404, "Шаблон проекта не найден");
    const data = projectTemplateSchema.partial().parse(await input(request));
    await validateProjectTemplateReferences(user, data);
    const updates = [],
      values = [];
    for (const key of [
      "name",
      "description",
      "workflow_id",
      "issue_type_scheme_id",
      "permission_scheme_id",
      "default_group_id",
      "color",
      "duration_days",
      "active",
    ])
      if (Object.hasOwn(data, key)) {
        updates.push(`${key}=?`);
        values.push(data[key] ?? null);
      }
    if (Object.hasOwn(data, "default_tasks")) {
      updates.push("default_tasks_json=?");
      values.push(JSON.stringify(data.default_tasks));
    }
    if (updates.length)
      await rows(
        `UPDATE project_templates SET ${updates.join(",")} WHERE id=?`,
        [...values, templateId],
      );
    await audit(
      user,
      "project_template.updated",
      "project_template",
      templateId,
      { fields: Object.keys(data) },
      request,
    );
    return json({ ok: true });
  }

  if (path[0] === "admin" && path[1] === "fields" && path[2]) {
    await requireWorkspacePermission(user, "field.manage");
    const fieldId = id.parse(path[2]);
    const data = z
      .object({
        label: z.string().trim().min(2).max(120).optional(),
        required: z.boolean().optional(),
        active: z.boolean().optional(),
        options: z.array(z.string().max(120)).optional(),
        position: z.number().int().optional(),
      })
      .parse(await input(request));
    const updates = [],
      values = [];
    for (const key of ["label", "required", "active", "position"])
      if (Object.hasOwn(data, key)) {
        updates.push(`${key} = ?`);
        values.push(data[key]);
      }
    if (data.options) {
      updates.push("options_json = ?");
      values.push(JSON.stringify(data.options));
    }
    if (updates.length)
      await rows(
        `UPDATE task_field_definitions SET ${updates.join(", ")} WHERE id = ? AND workspace_id = ?`,
        [...values, fieldId, user.workspace_id],
      );
    await audit(user, "field.updated", "task_field", fieldId, data, request);
    return json({ ok: true });
  }

  if (path[0] === "checklist" && path[1]) {
    const itemId = id.parse(path[1]);
    const item = await one(
      "SELECT ci.*, t.project_id, p.workspace_id FROM task_checklist_items ci JOIN tasks t ON t.id=ci.task_id JOIN projects p ON p.id=t.project_id WHERE ci.id=?",
      [itemId],
    );
    if (
      !item ||
      item.workspace_id !== user.workspace_id ||
      !(await hasProjectPermission(user, item.project_id, "task.edit", item))
    )
      throw new ApiError(403, "Нет прав на изменение чек-листа");
    const data = z
      .object({
        title: z.string().trim().min(1).max(500).optional(),
        completed: z.boolean().optional(),
        position: z.number().int().optional(),
      })
      .parse(await input(request));
    const updates = [],
      values = [];
    if (Object.hasOwn(data, "title")) {
      updates.push("title=?");
      values.push(data.title);
    }
    if (Object.hasOwn(data, "position")) {
      updates.push("position=?");
      values.push(data.position);
    }
    if (Object.hasOwn(data, "completed")) {
      updates.push("completed=?, completed_by=?, completed_at=?");
      values.push(
        data.completed,
        data.completed ? user.id : null,
        data.completed ? new Date() : null,
      );
    }
    if (updates.length)
      await rows(
        `UPDATE task_checklist_items SET ${updates.join(",")} WHERE id=?`,
        [...values, itemId],
      );
    return json({ ok: true });
  }

  if (path[0] === "notifications" && path[1]) {
    const notificationId = id.parse(path[1]);
    const data = z.object({ read: z.boolean() }).parse(await input(request));
    await rows(
      "UPDATE user_notifications SET read_at=? WHERE id=? AND user_id=?",
      [data.read ? new Date() : null, notificationId, user.id],
    );
    return json({ ok: true });
  }

  if (path[0] === "sprints" && path[1] && path.length === 2) {
    const sprintId = id.parse(path[1]);
    const sprint = await one(
      "SELECT s.*, p.workspace_id FROM sprints s JOIN projects p ON p.id=s.project_id WHERE s.id=?",
      [sprintId],
    );
    if (!sprint || sprint.workspace_id !== user.workspace_id)
      throw new ApiError(404, "Спринт не найден");
    await assertProject(user, sprint.project_id, true, "sprint.manage");
    const data = z
      .object({
        name: z.string().trim().min(2).max(160).optional(),
        goal: z.string().max(10000).optional(),
        start_date: z.string().nullable().optional(),
        end_date: z.string().nullable().optional(),
        status: z
          .enum(["planned", "active", "completed", "cancelled"])
          .optional(),
      })
      .parse(await input(request));
    const updates = [],
      values = [];
    for (const key of ["name", "goal", "start_date", "end_date", "status"])
      if (Object.hasOwn(data, key)) {
        updates.push(`${key}=?`);
        values.push(data[key] || null);
      }
    if (updates.length)
      await rows(`UPDATE sprints SET ${updates.join(",")} WHERE id=?`, [
        ...values,
        sprintId,
      ]);
    return json({ ok: true });
  }

  if (path[0] === "releases" && path[1] && path.length === 2) {
    const releaseId = id.parse(path[1]);
    const release = await one(
      "SELECT r.*, p.workspace_id FROM releases r JOIN projects p ON p.id=r.project_id WHERE r.id=?",
      [releaseId],
    );
    if (!release || release.workspace_id !== user.workspace_id)
      throw new ApiError(404, "Релиз не найден");
    await assertProject(user, release.project_id, true, "release.manage");
    const data = z
      .object({
        name: z.string().trim().min(1).max(120).optional(),
        description: z.string().max(10000).optional(),
        start_date: z.string().nullable().optional(),
        release_date: z.string().nullable().optional(),
        status: z.enum(["unreleased", "released", "archived"]).optional(),
      })
      .parse(await input(request));
    const updates = [],
      values = [];
    for (const key of [
      "name",
      "description",
      "start_date",
      "release_date",
      "status",
    ])
      if (Object.hasOwn(data, key)) {
        updates.push(`${key}=?`);
        values.push(data[key] || null);
      }
    if (updates.length)
      await rows(`UPDATE releases SET ${updates.join(",")} WHERE id=?`, [
        ...values,
        releaseId,
      ]);
    return json({ ok: true });
  }

  if (path[0] === "admin" && path[1] === "automation" && path[2]) {
    await requireWorkspacePermission(user, "automation.manage");
    const ruleId = id.parse(path[2]);
    const data = z
      .object({
        name: z.string().trim().min(2).max(180).optional(),
        description: z.string().max(500).optional(),
        enabled: z.boolean().optional(),
        trigger_type: z.string().min(2).max(100).optional(),
        trigger_config: z.record(z.any()).optional(),
        conditions: z.array(z.record(z.any())).optional(),
        actions: z.array(z.record(z.any())).min(1).optional(),
      })
      .parse(await input(request));
    const updates = [],
      values = [];
    for (const key of ["name", "description", "enabled", "trigger_type"])
      if (Object.hasOwn(data, key)) {
        updates.push(`${key}=?`);
        values.push(data[key]);
      }
    for (const [key, column] of [
      ["trigger_config", "trigger_config_json"],
      ["conditions", "conditions_json"],
      ["actions", "actions_json"],
    ])
      if (Object.hasOwn(data, key)) {
        updates.push(`${column}=?`);
        values.push(JSON.stringify(data[key]));
      }
    if (updates.length)
      await rows(
        `UPDATE automation_rules SET ${updates.join(",")} WHERE id=? AND workspace_id=?`,
        [...values, ruleId, user.workspace_id],
      );
    await audit(
      user,
      "automation.updated",
      "automation_rule",
      ruleId,
      { fields: Object.keys(data) },
      request,
    );
    return json({ ok: true });
  }

  if (path[0] === "admin" && path[1] === "webhooks" && path[2]) {
    await requireWorkspacePermission(user, "integration.manage");
    const hookId = id.parse(path[2]);
    const data = z
      .object({
        name: z.string().trim().min(2).max(180).optional(),
        target_url: z.string().url().max(1000).optional(),
        secret: z.string().max(500).optional(),
        event_types: z.array(z.string().max(120)).min(1).optional(),
        enabled: z.boolean().optional(),
      })
      .parse(await input(request));
    const updates = [],
      values = [];
    for (const key of ["name", "target_url", "enabled"])
      if (Object.hasOwn(data, key)) {
        updates.push(`${key}=?`);
        values.push(data[key]);
      }
    if (data.secret) {
      updates.push("secret_encrypted=?");
      values.push(encryptSecret(data.secret));
    }
    if (data.event_types) {
      updates.push("event_types_json=?");
      values.push(JSON.stringify(data.event_types));
    }
    if (updates.length)
      await rows(
        `UPDATE webhooks SET ${updates.join(",")} WHERE id=? AND workspace_id=?`,
        [...values, hookId, user.workspace_id],
      );
    return json({ ok: true });
  }

  if (
    path[0] === "knowledge" &&
    path[1] === "articles" &&
    path[2] &&
    path.length === 3
  ) {
    const articleId = id.parse(path[2]);
    const article = await one(
      "SELECT ka.*, ks.workspace_id, ks.visibility AS space_visibility, ks.owner_team_id, ks.created_by AS space_created_by FROM knowledge_articles ka JOIN knowledge_spaces ks ON ks.id=ka.space_id WHERE ka.id=?",
      [articleId],
    );
    if (!article || article.workspace_id !== user.workspace_id)
      throw new ApiError(404, "Статья не найдена");
    await assertKnowledgeAccess(
      user,
      {
        id: article.space_id,
        workspace_id: article.workspace_id,
        visibility: article.space_visibility,
        owner_team_id: article.owner_team_id,
        created_by: article.space_created_by,
      },
      "edit",
    );
    const data = z
      .object({
        version_number: id,
        title: z.string().trim().min(2).max(300).optional(),
        body: z.string().min(1).max(1000000).optional(),
        status: z.enum(["draft", "published", "archived"]).optional(),
        parent_id: id.nullable().optional(),
      })
      .parse(await input(request));
    const updates = ["version_number=version_number+1"],
      values = [];
    for (const key of ["title", "body", "status", "parent_id"])
      if (Object.hasOwn(data, key)) {
        updates.push(`${key}=?`);
        values.push(data[key] || null);
      }
    if (data.status === "published")
      updates.push("published_at=COALESCE(published_at,CURRENT_TIMESTAMP)");
    await transaction(async connection => {
      const [[current]] = await connection.query("SELECT * FROM knowledge_articles WHERE id=? FOR UPDATE", [articleId]);
      if (current.version_number !== data.version_number) throw new ApiError(409, "Статья изменена другим пользователем. Откройте текущую версию перед сохранением");
      if (data.status === "published" && current.steward_id) throw new ApiError(409, "Эта статья публикуется после проверки через совместный редактор");
      await saveArticleRevision(connection, current, user.id);
      await connection.query(`UPDATE knowledge_articles SET ${updates.join(",")}, review_status='none', reviewed_version=NULL WHERE id=?`, [...values, articleId]);
      if (current.steward_id && (data.body || data.title)) await connection.query("UPDATE knowledge_articles SET status='draft' WHERE id=?", [articleId]);
      if (data.body) { await connection.query("DELETE FROM knowledge_blocks WHERE article_id=?", [articleId]); await connection.query("DELETE FROM knowledge_crdt WHERE article_id=?",[articleId]); await connection.query("DELETE FROM knowledge_cursors WHERE article_id=?",[articleId]); }
    });
    return json({ ok: true });
  }

  throw new ApiError(404, "Маршрут не найден");
}

async function handlePut(request, path) {
  const user = await requireUser(request);
  if (path[0] === "chat" && path[1] === "rooms") return chatRoomsApi(request,path,user);
  if (path[0] === "work") return handleWorkApi(request, path.slice(1), user);
  if (path[0] === "admin" && path[1] === "automation") return handleWorkApi(request, ["automations", ...path.slice(2)], user);
  if (path[0] === "conferences" && path[2] === "recordings") return handleRecordingApi(request, path, user);
  if (path[0] === "projects" && ((path.length === 1 && request.method === "GET") || (path.length === 2 && ["PATCH", "DELETE"].includes(request.method)) || ["access", "archive", "restore", "members"].includes(path[2]))) return handleProjectAccessApi(request, path, user);
  if (path[0] === "ai" || (path[0] === "admin" && path[1] === "ai") || (["projects", "conferences"].includes(path[0]) && path[2] === "ai")) return handleAiApi(request, path, user);
  if (
    path[0] === "knowledge" &&
    path[1] === "spaces" &&
    path[2] &&
    path[3] === "permissions" &&
    path.length === 4
  ) {
    const spaceId = id.parse(path[2]);
    await assertKnowledgeAccess(user, spaceId, "admin");
    const data = z
      .object({
        permissions: z
          .array(
            z.object({
              principal_type: z.enum(["user", "team"]),
              principal_id: id,
              access_level: z.enum(["view", "edit", "admin"]),
            }),
          )
          .max(1000),
      })
      .parse(await input(request));
    const unique = new Map();
    for (const permission of data.permissions)
      unique.set(
        `${permission.principal_type}:${permission.principal_id}`,
        permission,
      );
    const permissions = [...unique.values()];
    const userIds = permissions
      .filter((item) => item.principal_type === "user")
      .map((item) => item.principal_id);
    await workspaceUserIds(user.workspace_id, userIds);
    const teamIds = [
      ...new Set(
        permissions
          .filter((item) => item.principal_type === "team")
          .map((item) => Number(item.principal_id)),
      ),
    ];
    if (teamIds.length) {
      const teams = await rows(
        `SELECT id FROM knowledge_teams WHERE workspace_id=? AND active=TRUE AND id IN (${teamIds.map(() => "?").join(",")})`,
        [user.workspace_id, ...teamIds],
      );
      if (teams.length !== teamIds.length)
        throw new ApiError(422, "Одна или несколько команд недоступны");
    }
    await transaction(async (connection) => {
      await connection.query(
        "DELETE FROM knowledge_space_permissions WHERE space_id=?",
        [spaceId],
      );
      for (const permission of permissions)
        await connection.query(
          "INSERT INTO knowledge_space_permissions (space_id, principal_type, principal_id, access_level, granted_by) VALUES (?, ?, ?, ?, ?)",
          [
            spaceId,
            permission.principal_type,
            permission.principal_id,
            permission.access_level,
            user.id,
          ],
        );
    });
    await audit(
      user,
      "knowledge.permissions.updated",
      "knowledge_space",
      spaceId,
      { permissions: permissions.length },
      request,
    );
    return json({ ok: true });
  }
  if (path[0] === "dashboards" && path[1]) {
    const dashboardId = id.parse(path[1]);
    const dashboard = await one(
      "SELECT id FROM dashboards WHERE id=? AND workspace_id=? AND owner_id=?",
      [dashboardId, user.workspace_id, user.id],
    );
    if (!dashboard) throw new ApiError(404, "Собственный дашборд не найден");
    const data = await validateDashboard(user,dashboardSchema.parse(await input(request)));
    if (data.is_shared)
      await requireWorkspacePermission(user, "dashboard.share");
    await transaction(async (connection) => {
      if(!data.revision)throw new ApiError(409,"Обновите дашборд перед сохранением");
      const [changed]=await connection.query(
        "UPDATE dashboards SET name=?, is_shared=?, layout_json=?, share_group_id=?, is_template=?, revision=revision+1 WHERE id=? AND revision=?",
        [data.name, data.is_shared, JSON.stringify(data.layout), data.share_group_id, data.is_template, dashboardId, data.revision],
      );
      if(!changed.affectedRows)throw new ApiError(409,"Дашборд изменён на другом устройстве; загрузите актуальную версию");
      await saveDashboard(connection, dashboardId, data.widgets);
    });
    await audit(
      user,
      "dashboard.updated",
      "dashboard",
      dashboardId,
      { name: data.name, widgets: data.widgets.length },
      request,
    );
    return json({ ok: true });
  }
  if (path[0] === "admin" && path[1] === "settings" && path[2]) {
    const category = z
      .enum(["general", "mail", "authentication", "notifications"])
      .parse(path[2]);
    const permission = {
      general: "role.manage",
      mail: "mail.manage",
      authentication: "auth.manage",
      notifications: "role.manage",
    }[category];
    await requireWorkspacePermission(user, permission);
    const result = await saveSettings(
      user.workspace_id,
      category,
      await input(request),
      user.id,
    );
    await audit(user, "settings.updated", "settings", category, null, request);
    return json(result);
  }
  if (path[0] === "admin" && path[1] === "workflows" && path[2]) {
    await requireWorkspacePermission(user, "workflow.manage");
    const workflowId = id.parse(path[2]);
    const data = z
      .object({
        name: z.string().trim().min(2).max(160),
        description: z.string().max(500).optional().default(""),
        stages: z
          .array(
            z.object({
              id: z.coerce.number().int().positive().optional(),
              code: z.string().regex(/^[a-z][a-z0-9_]*$/),
              name: z.string().trim().min(1).max(120),
              color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
              category: z.enum(["backlog", "active", "review", "done"]),
              wip_limit: z.coerce
                .number()
                .int()
                .positive()
                .nullable()
                .optional(),
              is_done: z.boolean().default(false),
            }),
          )
          .min(2),
      })
      .parse(await input(request));
    const workflow = await one(
      "SELECT id FROM workflows WHERE id = ? AND workspace_id = ?",
      [workflowId, user.workspace_id],
    );
    if (!workflow) throw new ApiError(404, "Процесс не найден");
    await transaction(async (connection) => {
      await connection.query(
        "UPDATE workflows SET name = ?, description = ? WHERE id = ?",
        [data.name, data.description, workflowId],
      );
      for (let index = 0; index < data.stages.length; index += 1) {
        const stage = data.stages[index];
        if (stage.id) {
          await connection.query(
            "UPDATE workflow_stages SET code = ?, name = ?, color = ?, category = ?, wip_limit = ?, is_done = ?, position = ? WHERE id = ? AND workflow_id = ?",
            [
              stage.code,
              stage.name,
              stage.color,
              stage.category,
              stage.wip_limit || null,
              stage.is_done,
              (index + 1) * 100,
              stage.id,
              workflowId,
            ],
          );
        } else {
          await connection.query(
            "INSERT INTO workflow_stages (workflow_id, code, name, color, category, wip_limit, is_done, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            [
              workflowId,
              stage.code,
              stage.name,
              stage.color,
              stage.category,
              stage.wip_limit || null,
              stage.is_done,
              (index + 1) * 100,
            ],
          );
        }
      }
    });
    await audit(
      user,
      "workflow.updated",
      "workflow",
      workflowId,
      { stages: data.stages.length },
      request,
    );
    return json({ ok: true });
  }
  throw new ApiError(404, "Маршрут не найден");
}

async function handleDelete(request, path) {
  const user = await requireUser(request);
  if (path[0] === "chat" && path[1] === "rooms") return chatRoomsApi(request,path,user);
  if (path[0] === "work") return handleWorkApi(request, path.slice(1), user);
  if (path[0] === "admin" && path[1] === "automation") return handleWorkApi(request, ["automations", ...path.slice(2)], user);
  if (path[0] === "conferences" && path[2] === "recordings") return handleRecordingApi(request, path, user);
  if (path[0] === "projects" && ((path.length === 1 && request.method === "GET") || (path.length === 2 && ["PATCH", "DELETE"].includes(request.method)) || ["access", "archive", "restore", "members"].includes(path[2]))) return handleProjectAccessApi(request, path, user);
  if (path[0] === "ai" || (path[0] === "admin" && path[1] === "ai") || (["projects", "conferences"].includes(path[0]) && path[2] === "ai")) return handleAiApi(request, path, user);
  if (path[0] === "tokens" && path[1]) {
    await requireBrowserSession(user);
    await rows(
      "UPDATE api_tokens SET revoked_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=? AND user_id=? AND revoked_at IS NULL",
      [id.parse(path[1]), user.workspace_id, user.id],
    );
    await audit(user, "api_token.revoked", "api_token", path[1], null, request);
    return json({ ok: true });
  }
  if (path[0] === "dashboards" && path[1]) {
    const dashboardId = id.parse(path[1]);
    const dashboard = await one(
      "SELECT id FROM dashboards WHERE id=? AND workspace_id=? AND owner_id=?",
      [dashboardId, user.workspace_id, user.id],
    );
    if (!dashboard) throw new ApiError(404, "Собственный дашборд не найден");
    await rows("DELETE FROM dashboards WHERE id=?", [dashboardId]);
    await audit(
      user,
      "dashboard.deleted",
      "dashboard",
      dashboardId,
      null,
      request,
    );
    if(mediaDisconnected===false)throw new ApiError(503,'Встреча закрыта для новых подключений, но медиасервер не подтвердил отключение комнат. Повторите завершение встречи');
    return json({ ok: true, ...(mediaDisconnected!==null?{media_disconnected:mediaDisconnected}:{}) });
  }
  if (path[0] === "admin" && path[1] === "task-sla" && path[2]) {
    await requireWorkspacePermission(user, "sla.manage");
    const policyId = id.parse(path[2]);
    await rows("DELETE FROM task_sla_policies WHERE id=? AND workspace_id=?", [
      policyId,
      user.workspace_id,
    ]);
    await audit(
      user,
      "task_sla.deleted",
      "task_sla_policy",
      policyId,
      null,
      request,
    );
    return json({ ok: true });
  }
  if (path[0] === "tasks" && path[1]) {
    const taskId = id.parse(path[1]);
    const task = await one(
      "SELECT t.project_id, p.workspace_id FROM tasks t JOIN projects p ON p.id = t.project_id WHERE t.id = ?",
      [taskId],
    );
    if (!task || task.workspace_id !== user.workspace_id)
      throw new ApiError(404, "Задача не найдена");
    await assertProject(user, task.project_id, true, "task.delete");
    await transaction(async (connection) => {
      await emitEvent(
        {
          workspaceId: user.workspace_id,
          eventType: "task.deleted",
          aggregateType: "task",
          aggregateId: taskId,
          payload: { task_id: taskId, project_id: task.project_id },
        },
        connection,
      );
      await connection.query("DELETE FROM tasks WHERE id = ?", [taskId]);
    });
    await audit(user, "task.deleted", "task", taskId, null, request);
    return json({ ok: true });
  }
  if (path[0] === "attachments" && path[1]) {
    const attachmentId = id.parse(path[1]);
    const attachment = await one(
      "SELECT ta.*, t.project_id, p.workspace_id FROM task_attachments ta JOIN tasks t ON t.id=ta.task_id JOIN projects p ON p.id=t.project_id WHERE ta.id=?",
      [attachmentId],
    );
    if (
      !attachment ||
      attachment.workspace_id !== user.workspace_id ||
      !(await hasProjectPermission(
        user,
        attachment.project_id,
        "attachment.manage",
        attachment,
      ))
    )
      throw new ApiError(403, "Нет прав на удаление файла");
    await deleteObject(attachment.object_key).catch(() => {});
    await rows("DELETE FROM task_attachments WHERE id=?", [attachmentId]);
    return json({ ok: true });
  }
  if (path[0] === "checklist" && path[1]) {
    const itemId = id.parse(path[1]);
    const item = await one(
      "SELECT ci.id, t.project_id, p.workspace_id FROM task_checklist_items ci JOIN tasks t ON t.id=ci.task_id JOIN projects p ON p.id=t.project_id WHERE ci.id=?",
      [itemId],
    );
    if (
      !item ||
      item.workspace_id !== user.workspace_id ||
      !(await hasProjectPermission(user, item.project_id, "task.edit", item))
    )
      throw new ApiError(403, "Нет прав на изменение чек-листа");
    await rows("DELETE FROM task_checklist_items WHERE id=?", [itemId]);
    return json({ ok: true });
  }
  if (path[0] === "filters" && path[1]) {
    await rows(
      "DELETE FROM saved_filters WHERE id=? AND workspace_id=? AND owner_id=?",
      [id.parse(path[1]), user.workspace_id, user.id],
    );
    return json({ ok: true });
  }
  if (path[0] === "admin" && path[1] === "api-tokens" && path[2]) {
    await requireWorkspacePermission(user, "integration.manage");
    await rows(
      "UPDATE api_tokens SET revoked_at=CURRENT_TIMESTAMP WHERE id=? AND workspace_id=?",
      [id.parse(path[2]), user.workspace_id],
    );
    return json({ ok: true });
  }
  if (path[0] === "admin" && path[1] === "access-groups" && path[2]) {
    await requireWorkspacePermission(user, "group.manage");
    const groupId = id.parse(path[2]);
    const group = await one(
      "SELECT id FROM access_groups WHERE id=? AND workspace_id=?",
      [groupId, user.workspace_id],
    );
    if (!group) throw new ApiError(404, "Группа доступа не найдена");
    await transaction(async (connection) => {
      await connection.query(
        "DELETE FROM access_assignments WHERE principal_type='group' AND principal_id=?",
        [groupId],
      );
      await connection.query("DELETE FROM access_groups WHERE id=?", [groupId]);
    });
    await audit(
      user,
      "access_group.deleted",
      "access_group",
      groupId,
      null,
      request,
    );
    return json({ ok: true });
  }
  if (path[0] === "admin" && path[1] === "access-roles" && path[2]) {
    await requireWorkspacePermission(user, "role.manage");
    const roleId = id.parse(path[2]);
    const role = await one(
      "SELECT id, is_system FROM access_roles WHERE id=? AND workspace_id=?",
      [roleId, user.workspace_id],
    );
    if (!role) throw new ApiError(404, "Роль доступа не найдена");
    if (role.is_system)
      throw new ApiError(409, "Системную роль нельзя удалить");
    await rows("DELETE FROM access_roles WHERE id=?", [roleId]);
    await audit(
      user,
      "access_role.deleted",
      "access_role",
      roleId,
      null,
      request,
    );
    return json({ ok: true });
  }
  if (path[0] === "admin" && path[1] === "project-templates" && path[2]) {
    await requireWorkspacePermission(user, "project.template.manage");
    const templateId = id.parse(path[2]);
    await rows(
      "UPDATE project_templates SET active=FALSE WHERE id=? AND workspace_id=?",
      [templateId, user.workspace_id],
    );
    await audit(
      user,
      "project_template.archived",
      "project_template",
      templateId,
      null,
      request,
    );
    return json({ ok: true });
  }
  throw new ApiError(404, "Маршрут не найден");
}

async function dispatch(request, context) {
  checkOrigin(request);
  const path = await routeParts(context);
  if (request.method === "POST" && path[0] === "work" && path[1] === "development" && path[2] === "webhook" && path.length === 4) return developmentWebhook(request, path[3]);
  if (request.method === "GET") return handleGet(request, path);
  if (request.method === "POST") return handlePost(request, path);
  if (request.method === "PATCH") return handlePatch(request, path);
  if (request.method === "PUT") return handlePut(request, path);
  if (request.method === "DELETE") return handleDelete(request, path);
  throw new ApiError(405, "Метод не поддерживается");
}

async function safeDispatch(request, context) {
  try {
    const response = await dispatch(request, context);
    const user = requestUsers.get(request);
    if (user && response.headers.get("Content-Type")?.includes("application/json") && response.status !== 204) {
      const value = await response.json();
      const safe = await sanitizeWorkResponse(user, value);
      const headers = new Headers(response.headers); headers.set("Cache-Control", "private, no-store");
      return new Response(JSON.stringify(safe), { status: response.status, headers });
    }
    return response;
  } catch (error) {
    if (error instanceof z.ZodError)
      return json(
        { error: "Проверьте заполнение полей", details: error.flatten() },
        422,
      );
    if (error instanceof WorkError || error instanceof ApiError || error instanceof AiError || error instanceof ProjectAccessError || error instanceof RecordingError)
      return json(
        { error: error.message, details: error.details },
        error.status,
      );
    if (error?.code === "ER_DUP_ENTRY")
      return json({ error: "Запись с такими данными уже существует" }, 409);
    console.error(error);
    return json({ error: "Внутренняя ошибка сервера" }, 500);
  }
}

export const GET = safeDispatch;
export const POST = safeDispatch;
export const PATCH = safeDispatch;
export const PUT = safeDispatch;
export const DELETE = safeDispatch;
