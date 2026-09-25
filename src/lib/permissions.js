import {identityProjectPermissions,identityWorkspacePermissions} from './agent-identity-policy.js';
import { one, rows } from "./db.js";
import {tribeAccess} from './tribe-policy.js';

export const PERMISSION_CATALOG = [
  { key: "tribe.create", name: "Создание пространства трайба", category: "Компания", scope: "workspace" },
  { key: "planning.create", name: "Создание проектов-черновиков", category: "Планирование", scope: "workspace" },
  { key: "planning.view", name: "Просмотр запланированных эпиков и задач", category: "Планирование", scope: "project" },
  { key: "planning.manage", name: "Изменение планов и начало работы", category: "Планирование", scope: "project" },
  { key: "chat.room.create", name: "Создание постоянных комнат", category: "Коммуникации", scope: "workspace" },
  { key: "chat.room.join", name: "Вход в общие комнаты", category: "Коммуникации", scope: "workspace" },
  { key: "chat.room.manage", name: "Управление всеми комнатами", category: "Коммуникации", scope: "workspace" },
  { key: "agent.identity.manage", name: "Управление учётными записями агентов", category: "ИИ-агенты", scope: "workspace" },
  { key: "agent.view", name: "Просмотр агентов и доступных результатов", category: "ИИ-агенты", scope: "project" },
  { key: "agent.manage", name: "Создание и настройка агентов", category: "ИИ-агенты", scope: "project" },
  { key: "agent.run", name: "Запуск агентов и предпросмотр данных", category: "ИИ-агенты", scope: "project" },
  { key: "agent.approve", name: "Подтверждение действий агента", category: "ИИ-агенты", scope: "project" },
  { key: "agent.automate", name: "Автоматическое выполнение действий агента", category: "ИИ-агенты", scope: "project" },

  { key: "operations.view", name: "Просмотр состояния платформы", category: "Эксплуатация", scope: "workspace" },
  { key: "semantic.index", name: "Индексация доступных материалов для поиска с ИИ", category: "ИИ", scope: "workspace" },
  { key: "qa.view", name: "Просмотр тест-кейсов и прогонов", category: "Тестирование", scope: "project" },
  { key: "qa.manage", name: "Настройка кейсов и планов", category: "Тестирование", scope: "project" },
  { key: "qa.execute", name: "Выполнение тестов и результаты автотестов", category: "Тестирование", scope: "project" },
  { key: "okr.view", name: "Просмотр целей и показателей", category: "Цели и OKR", scope: "project" },
  { key: "okr.manage", name: "Создание и настройка целей", category: "Цели и OKR", scope: "project" },
  { key: "okr.update", name: "Обновление результатов целей", category: "Цели и OKR", scope: "project" },

  { key: "calendar.connect", name: "Синхронизация своего календаря встреч", category: "Интеграции", scope: "workspace" },
  { key: "integration.send", name: "Отправка через интеграции из автоматизаций", category: "Интеграции", scope: "workspace" },
  { key: "capacity.view", name: "Просмотр загрузки команд", category: "Планирование", scope: "workspace" },
  { key: "capacity.manage", name: "Рабочие графики и распределение ресурсов", category: "Планирование", scope: "workspace" },
  { key: "portfolio.manage", name: "Сохранение планов портфеля", category: "Планирование", scope: "workspace" },
  { key: "ai.search", name: "Поиск с ИИ по доступным материалам", category: "ИИ", scope: "workspace" },
  { key: "approval.request", name: "Создание согласований", category: "Согласования", scope: "project" },
  { key: "approval.decide", name: "Принятие решений по согласованиям", category: "Согласования", scope: "project" },
  { key: "approval.manage", name: "Настройка этапов с согласованием", category: "Согласования", scope: "project" },
  { key: "user.manage", name: "Управление пользователями", category: "Администрирование", scope: "workspace" },
  { key: "group.manage", name: "Управление группами доступа", category: "Администрирование", scope: "workspace" },
  { key: "role.manage", name: "Управление ролями и назначениями", category: "Администрирование", scope: "workspace" },
  { key: "workflow.manage", name: "Настройка рабочих процессов", category: "Конфигурация", scope: "workspace" },
  { key: "field.manage", name: "Настройка атрибутов задач", category: "Конфигурация", scope: "workspace" },
  { key: "project.create", name: "Создание проектов", category: "Портфель", scope: "workspace" },
  { key: "project.group.manage", name: "Управление группами проектов", category: "Портфель", scope: "workspace" },
  { key: "project.template.manage", name: "Управление шаблонами проектов", category: "Портфель", scope: "workspace" },
  { key: "automation.manage", name: "Управление автоматизацией", category: "Платформа", scope: "workspace" },
  { key: "integration.view", name: "Просмотр подключений", category: "Интеграции", scope: "workspace" },
  { key: "integration.test", name: "Тестовая и повторная отправка", category: "Интеграции", scope: "workspace" },
  { key: "integration.logs", name: "Журнал доставки интеграций", category: "Интеграции", scope: "workspace" },
  { key: "integration.manage", name: "Интеграции, webhooks и API", category: "Платформа", scope: "workspace" },
  { key: "ai.configure", name: "Настройка подключений, моделей и лимитов ИИ", category: "ИИ", scope: "workspace" },
  { key: "sla.manage", name: "Настройка SLA задач", category: "Аналитика", scope: "workspace" },
  { key: "dashboard.share", name: "Публикация общих дашбордов", category: "Аналитика", scope: "workspace" },
  { key: "api.access.manage", name: "Политики доступа пользователей к API", category: "Безопасность", scope: "workspace" },
  { key: "import.manage", name: "Импорт данных", category: "Платформа", scope: "workspace" },
  { key: "mail.manage", name: "Настройка исходящей почты", category: "Платформа", scope: "workspace" },
  { key: "auth.manage", name: "Настройка доменной авторизации", category: "Безопасность", scope: "workspace" },
  { key: "audit.view", name: "Просмотр журнала аудита", category: "Безопасность", scope: "workspace" },
  { key: "knowledge.view", name: "Просмотр базы знаний", category: "База знаний", scope: "workspace" },
  { key: "knowledge.manage", name: "Управление пространствами и командами базы знаний", category: "База знаний", scope: "workspace" },
  { key: "project.browse", name: "Просмотр проекта", category: "Проект", scope: "project" },
  { key: "project.admin", name: "Администрирование проекта", category: "Проект", scope: "project" },
  { key: "project.edit", name: "Изменение настроек проекта", category: "Проект", scope: "project" },
  { key: "project.archive", name: "Архивирование и возврат проекта", category: "Проект", scope: "project" },
  { key: "project.delete", name: "Удаление в корзину и восстановление проекта", category: "Проект", scope: "project" },
  { key: "project.access.manage", name: "Управление доступом пользователей и групп к проекту", category: "Проект", scope: "project" },
  { key: "ai.result.view", name: "Просмотр результатов ИИ", category: "ИИ", scope: "project" },
  { key: "ai.project.analyze", name: "Оценка проекта с помощью ИИ", category: "ИИ", scope: "project" },
  { key: "ai.conference.summarize", name: "Создание сводки конференции с помощью ИИ", category: "ИИ", scope: "project" },
  { key: "task.create", name: "Создание задач", category: "Задачи", scope: "project" },
  { key: "task.edit", name: "Изменение задач и этапов", category: "Задачи", scope: "project" },
  { key: "task.assign", name: "Назначение исполнителей", category: "Задачи", scope: "project" },
  { key: "task.delete", name: "Удаление задач", category: "Задачи", scope: "project" },
  { key: "comment.create", name: "Комментарии", category: "Совместная работа", scope: "project" },
  { key: "attachment.manage", name: "Добавление и удаление файлов", category: "Совместная работа", scope: "project" },
  { key: "worklog.create", name: "Учёт рабочего времени", category: "Совместная работа", scope: "project" },
  { key: "sprint.manage", name: "Управление спринтами", category: "Планирование", scope: "project" },
  { key: "release.manage", name: "Управление релизами", category: "Планирование", scope: "project" },
  { key: "report.view", name: "Просмотр отчётов", category: "Аналитика", scope: "project" },
  { key: "chat.use", name: "Проектные чаты и файлы", category: "Коммуникации", scope: "project" },
  { key: "conference.join", name: "Участие в конференциях", category: "Коммуникации", scope: "project" },
  { key: "conference.create", name: "Создание и планирование конференций", category: "Коммуникации", scope: "project" },
  { key: "conference.manage", name: "Управление конференциями и участниками", category: "Коммуникации", scope: "project" },
  { key: "conference.caption", name: "Субтитры собственного микрофона", category: "Коммуникации", scope: "project" },
  { key: "conference.record", name: "Запуск и остановка записи конференции", category: "Коммуникации", scope: "project" },
  { key: "conference.recording.view", name: "Просмотр записей и расшифровок конференций", category: "Коммуникации", scope: "project" },
  { key: "telephony.view", name: "Просмотр телефонных звонков проекта", category: "Коммуникации", scope: "project" },
  { key: "telephony.call", name: "Исходящие звонки и управление ими", category: "Коммуникации", scope: "project" },
];

const WORKSPACE_KEYS = PERMISSION_CATALOG.filter((item) => item.scope === "workspace").map((item) => item.key);
const PROJECT_KEYS = PERMISSION_CATALOG.filter((item) => item.scope === "project").map((item) => item.key);

const WORKSPACE_ROLE_DEFAULTS = {
  admin: WORKSPACE_KEYS,
  tribe_leader: ["tribe.create", "planning.create", "knowledge.view", "chat.room.create", "chat.room.join"],
  project_manager: ["chat.room.create", "chat.room.join", "capacity.view", "capacity.manage", "portfolio.manage", "ai.search", "project.create", "project.group.manage", "project.template.manage", "knowledge.view"],
  member: ["knowledge.view", "chat.room.create", "chat.room.join"],
  viewer: ["knowledge.view", "chat.room.join"],
};

export const PROJECT_MEMBERSHIP_DEFAULTS = {
  manager: PROJECT_KEYS,
  member: ["approval.request", "approval.decide", "project.browse", "task.create", "task.edit", "task.assign", "comment.create", "attachment.manage", "worklog.create", "report.view", "chat.use", "conference.join", "conference.create", "telephony.view", "telephony.call"],
  viewer: ["project.browse", "report.view", "chat.use", "conference.join", "telephony.view"],
};

// Собирает действующие назначения и сохраняет область каждого права для закрытых проектов.
async function assignmentDecisions(user, roleScope, project = null) {
  const projectId = project?.id || null;
  const projectGroupId = project?.group_id || null;
  return rows(
    `WITH RECURSIVE user_groups AS (
       SELECT access_group.id, access_group.parent_group_id, CAST(access_group.id AS CHAR(2000)) AS path
       FROM access_group_members member JOIN access_groups access_group ON access_group.id=member.group_id
       WHERE member.user_id=? AND access_group.workspace_id=? AND access_group.active=TRUE
         AND (member.expires_at IS NULL OR member.expires_at>CURRENT_TIMESTAMP)
       UNION ALL
       SELECT parent.id, parent.parent_group_id, CONCAT(user_groups.path, ',', parent.id)
       FROM access_groups parent JOIN user_groups ON parent.id=user_groups.parent_group_id
       WHERE parent.active=TRUE AND FIND_IN_SET(parent.id, user_groups.path)=0
     )
     SELECT DISTINCT permission.permission_key, permission.effect, assignment.scope_type
     FROM access_assignments assignment
     JOIN access_roles role ON role.id=assignment.role_id AND role.active=TRUE
     JOIN access_role_permissions permission ON permission.role_id=role.id
     LEFT JOIN user_groups ON assignment.principal_type='group' AND user_groups.id=assignment.principal_id
     WHERE role.workspace_id=?
       AND role.scope=?
       AND ((assignment.principal_type='user' AND assignment.principal_id=?) OR user_groups.id IS NOT NULL)
       AND (assignment.valid_from IS NULL OR assignment.valid_from<=CURRENT_TIMESTAMP)
       AND (assignment.expires_at IS NULL OR assignment.expires_at>CURRENT_TIMESTAMP)
       AND (assignment.scope_type='workspace'
         OR (? IS NOT NULL AND assignment.scope_type='project' AND assignment.scope_id=?)
         OR (? IS NOT NULL AND assignment.scope_type='project_group' AND assignment.scope_id=?))`,
    [user.id, user.workspace_id, user.workspace_id, roleScope, user.id, projectId, projectId, projectGroupId, projectGroupId],
  );
}

function applyDecisions(permissionSet, decisions) {
  const denied = new Set(decisions.filter((item) => item.effect === "deny").map((item) => item.permission_key));
  for (const item of decisions) if (item.effect === "allow") permissionSet.add(item.permission_key);
  for (const key of denied) permissionSet.delete(key);
  return permissionSet;
}

export async function workspacePermissionSet(user) {
  if (!user) return new Set();
  if (user.is_service) return identityWorkspacePermissions(user);
  if (["owner", "admin"].includes(user.global_role)) return new Set(WORKSPACE_KEYS);
  const base = new Set(WORKSPACE_ROLE_DEFAULTS[user.global_role] || []);
  const decisions = await assignmentDecisions(user, "workspace");
  const result = applyDecisions(base, decisions);
  const denied = new Set(decisions.filter((item) => item.effect === "deny").map((item) => item.permission_key));
  if (result.has("knowledge.manage") && !denied.has("knowledge.view")) result.add("knowledge.view");
  return result;
}

// Вычисляет текущие права с учётом владельца, трайба, личных назначений, групп и запретов.
export async function projectPermissionSet(user, projectOrId, taskContext = null, allowDeleted = false) {
  if (!user) return new Set();
  let project = typeof projectOrId === "object"
    ? projectOrId
    : await one("SELECT id, workspace_id, group_id, permission_scheme_id, deleted_at, owner_id, access_mode, tribe_id FROM projects WHERE id=? AND workspace_id=?", [projectOrId, user.workspace_id]);
  if(project&&typeof projectOrId==='object'&&!Object.hasOwn(project,'access_mode'))project=await one('SELECT * FROM projects WHERE id=? AND workspace_id=?',[project.id,user.workspace_id]);
  if (!project || Number(project.workspace_id) !== Number(user.workspace_id)) return new Set();
  if (project.deleted_at && !allowDeleted) return new Set();
  if (user.is_service) return identityProjectPermissions(user,project.id);
  if (["owner", "admin"].includes(user.global_role)) return new Set(PROJECT_KEYS);

  const tribe=project.tribe_id?await tribeAccess(user,project.tribe_id):null;
  if(project.tribe_id&&!tribe)return new Set();
  const closed=project.access_mode==='members';

  const membership = await one("SELECT project_role FROM project_members WHERE project_id=? AND user_id=?", [project.id, user.id]);
  const permissionSet = new Set();
  if ((!closed&&user.global_role === "project_manager")||Number(project.owner_id)===Number(user.id)||tribe?.can_manage_projects) for (const key of PROJECT_KEYS) permissionSet.add(key);
  if (membership) for (const key of PROJECT_MEMBERSHIP_DEFAULTS[membership.project_role] || []) permissionSet.add(key);

  const temporaryAccess = await rows("SELECT project_role FROM project_access_requests WHERE project_id=? AND user_id=? AND status='approved' AND expires_at>CURRENT_TIMESTAMP", [project.id,user.id]);
  for (const grant of temporaryAccess) for (const key of PROJECT_MEMBERSHIP_DEFAULTS[grant.project_role] || []) permissionSet.add(key);

  const grants = closed?[]:await rows(
    `SELECT grant_row.permission_key, grant_row.principal_type, grant_row.principal_value
     FROM permission_schemes scheme
     JOIN permission_grants grant_row ON grant_row.scheme_id=scheme.id
     WHERE scheme.id=COALESCE(?, (SELECT id FROM permission_schemes WHERE workspace_id=? AND is_default=TRUE LIMIT 1))`,
    [project.permission_scheme_id, user.workspace_id],
  );
  const groupRows = await rows(
    `WITH RECURSIVE user_groups AS (
       SELECT access_group.id, access_group.parent_group_id, access_group.code, access_group.name, CAST(access_group.id AS CHAR(2000)) AS path
       FROM access_group_members member JOIN access_groups access_group ON access_group.id=member.group_id
       WHERE member.user_id=? AND access_group.workspace_id=? AND access_group.active=TRUE
         AND (member.expires_at IS NULL OR member.expires_at>CURRENT_TIMESTAMP)
       UNION ALL
       SELECT parent.id, parent.parent_group_id, parent.code, parent.name, CONCAT(user_groups.path, ',', parent.id)
       FROM access_groups parent JOIN user_groups ON parent.id=user_groups.parent_group_id
       WHERE parent.active=TRUE AND FIND_IN_SET(parent.id, user_groups.path)=0
     )
     SELECT DISTINCT id, code, name FROM user_groups`,
    [user.id, user.workspace_id],
  );
  for (const permission of PROJECT_KEYS) {
    const allowed = grants.filter((grant) => grant.permission_key === permission).some((grant) => {
      if (grant.principal_type === "any_authenticated") return true;
      if (grant.principal_type === "user") return [String(user.id), user.email].includes(String(grant.principal_value));
      if (grant.principal_type === "global_role") return grant.principal_value === user.global_role;
      if (grant.principal_type === "group") return groupRows.some((group) => [String(group.id), group.code, group.name].includes(String(grant.principal_value)));
      if (grant.principal_type === "reporter") return Number(taskContext?.reporter_id) === Number(user.id);
      if (grant.principal_type === "assignee") return Number(taskContext?.assignee_id) === Number(user.id);
      if (grant.principal_type === "project_role" && membership) {
        if (grant.principal_value === membership.project_role) return true;
        return membership.project_role === "manager" && ["member", "viewer"].includes(grant.principal_value);
      }
      return false;
    });
    if (allowed) permissionSet.add(permission);
  }

  const decisions = (await assignmentDecisions(user, "project", project)).filter(item=>!closed||item.effect==='deny'||item.scope_type==='project');
  if (groupRows.length) {
    const groupAccess = await rows(`SELECT project_role FROM project_group_access WHERE project_id=? AND group_id IN (${groupRows.map(() => "?").join(",")})`, [project.id, ...groupRows.map((group) => group.id)]);
    for (const access of groupAccess)
      for (const key of PROJECT_MEMBERSHIP_DEFAULTS[access.project_role] || []) permissionSet.add(key);
  }
  if (permissionSet.has("project.admin") || decisions.some((item) => item.permission_key === "project.admin" && item.effect === "allow"))
    for (const key of ["project.edit", "project.archive", "project.delete", "project.access.manage"]) permissionSet.add(key);
  const result = applyDecisions(permissionSet, decisions);
  const browseDenied = decisions.some((item) => item.permission_key === "project.browse" && item.effect === "deny");
  if (result.size && !browseDenied) result.add("project.browse");
  return browseDenied ? new Set() : result;
}

export async function hasWorkspacePermission(user, permissionKey) {
  return (await workspacePermissionSet(user)).has(permissionKey);
}

export async function hasProjectPermission(user, projectId, permissionKey, taskContext = null) {
  return (await projectPermissionSet(user, projectId, taskContext)).has(permissionKey);
}

export function permissionMap(permissionSet) {
  return Object.fromEntries(PERMISSION_CATALOG.map((item) => [item.key, permissionSet.has(item.key)]));
}
