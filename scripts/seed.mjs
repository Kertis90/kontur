import bcrypt from "bcryptjs";
import mysql from "mysql2/promise";
import { mysqlSslConfig } from "../src/lib/mysql-config.js";
import {databaseEngine} from '../src/lib/database-config.js';
import {createPostgresConnection} from '../src/lib/postgres-db.js';

const db = databaseEngine()==='postgres'?await createPostgresConnection():await mysql.createConnection({
  host: process.env.MYSQL_HOST || "127.0.0.1",
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || "kontur",
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE || "kontur_work",
  charset: "utf8mb4",
  connectTimeout: Number(process.env.MYSQL_CONNECT_TIMEOUT || 10000),
  ssl: mysqlSslConfig(),
});

const adminEmail = (process.env.ADMIN_EMAIL || "admin@example.ru").trim().toLowerCase();
const adminPassword = process.env.ADMIN_PASSWORD;
const adminName = process.env.ADMIN_NAME || "Администратор";

if (!adminPassword) {
  console.log("ADMIN_PASSWORD не задан — демонстрационные данные не созданы.");
  await db.end();
  process.exit(0);
}

await db.beginTransaction();
try {
  await db.query("INSERT IGNORE INTO workspaces (id, name, slug) VALUES (1, 'Контур', 'kontur')");
  const passwordHash = await bcrypt.hash(adminPassword, 12);
  await db.query(
    `INSERT INTO users (workspace_id, email, display_name, password_hash, global_role, auth_source, status)
     VALUES (1, ?, ?, ?, 'owner', 'local', 'active')
     ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), global_role = 'owner', status = 'active'`,
    [adminEmail, adminName, passwordHash],
  );
  const [[admin]] = await db.query("SELECT id FROM users WHERE workspace_id = 1 AND email = ?", [adminEmail]);
  const defaultApiScopes = ["workspace:read", "projects:read", "tasks:read", "tasks:write", "reports:read", "knowledge:read", "profile:read", "profile:write", "collaboration:read", "collaboration:write"];
  await db.query("INSERT IGNORE INTO user_api_access (user_id, workspace_id, allowed_scopes_json, updated_by) VALUES (?, 1, ?, ?)", [admin.id, JSON.stringify(defaultApiScopes), admin.id]);

  const [[existingWorkflow]] = await db.query("SELECT id FROM workflows WHERE workspace_id = 1 LIMIT 1");
  let workflowId = existingWorkflow?.id;
  if (!workflowId) {
    const [workflow] = await db.query("INSERT INTO workflows (workspace_id, name, description, is_default) VALUES (1, 'Основной процесс', 'Базовый поток для продуктовых и внутренних проектов', TRUE)");
    workflowId = workflow.insertId;
    const stages = [
      ["backlog", "Бэклог", "#7D8797", 100, "backlog", null, false],
      ["analysis", "Анализ", "#4E8AC7", 200, "active", 5, false],
      ["progress", "В работе", "#675EE7", 300, "active", 6, false],
      ["review", "Проверка", "#E69C3F", 400, "review", 4, false],
      ["done", "Готово", "#2EA879", 500, "done", null, true],
    ];
    for (const stage of stages) {
      await db.query("INSERT INTO workflow_stages (workflow_id, code, name, color, position, category, wip_limit, is_done) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [workflowId, ...stage]);
    }
  }

  await db.query("INSERT IGNORE INTO project_groups (id, workspace_id, name, description, color, position) VALUES (1, 1, 'Продукты', 'Развитие продуктовой линейки', '#675EE7', 100), (2, 1, 'Внутренние инициативы', 'Операционные и инфраструктурные проекты', '#2EA879', 200)");

  const [[existingProject]] = await db.query("SELECT id FROM projects WHERE workspace_id = 1 AND key_code = 'NOVA'");
  let projectId = existingProject?.id;
  if (!projectId) {
    const [project] = await db.query(
      `INSERT INTO projects (workspace_id, group_id, workflow_id, key_code, name, description, color, start_date, target_date, created_by)
       VALUES (1, 1, ?, 'NOVA', 'Запуск Nova', 'Подготовка и запуск новой цифровой услуги', '#675EE7', CURRENT_DATE, DATE_ADD(CURRENT_DATE, INTERVAL 45 DAY), ?)`,
      [workflowId, admin.id],
    );
    projectId = project.insertId;
    await db.query("INSERT INTO project_members (project_id, user_id, project_role) VALUES (?, ?, 'manager')", [projectId, admin.id]);
    const [stageRows] = await db.query("SELECT id, code FROM workflow_stages WHERE workflow_id = ?", [workflowId]);
    const stage = Object.fromEntries(stageRows.map((row) => [row.code, row.id]));
    const tasks = [
      [1, "Согласовать паспорт проекта", "Зафиксировать цели, ограничения и критерии успеха.", "high", stage.done, -12, -8, 100],
      [2, "Исследовать сценарии пользователей", "Провести интервью и собрать карту проблем.", "high", stage.review, -7, 2, 80],
      [3, "Подготовить прототип", "Собрать интерактивный прототип ключевых потоков.", "critical", stage.progress, -1, 8, 45],
      [4, "Проверить интеграции", "Подтвердить доступность API и ограничения безопасности.", "medium", stage.analysis, 1, 6, 25],
      [5, "Провести контрольную точку", "Принять решение о переходе к реализации.", "high", stage.backlog, 10, 10, 0],
      [6, "Спланировать релиз", "Разбить реализацию на управляемые поставки.", "medium", stage.backlog, 11, 18, 0]
    ];
    for (const [number, title, description, priority, stageId, startOffset, dueOffset, progress] of tasks) {
      await db.query(
        `INSERT INTO tasks (project_id, stage_id, task_number, title, description, priority, reporter_id, assignee_id, start_date, due_date, estimate_minutes, progress, position, milestone)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, DATE_ADD(CURRENT_DATE, INTERVAL ? DAY), DATE_ADD(CURRENT_DATE, INTERVAL ? DAY), 480, ?, ?, ?)`,
        [projectId, stageId, number, title, description, priority, admin.id, admin.id, startOffset, dueOffset, progress, number * 1000, number === 5],
      );
    }
  }

  const fields = [
    ["business_value", "Бизнес-ценность", "select", JSON.stringify(["Низкая", "Средняя", "Высокая", "Критическая"]), 100],
    ["risk", "Риск", "select", JSON.stringify(["Низкий", "Средний", "Высокий"]), 200],
    ["acceptance", "Критерии приёмки", "text", null, 300],
  ];
  for (const field of fields) {
    await db.query(
      `INSERT IGNORE INTO task_field_definitions (workspace_id, code, label, field_type, options_json, position)
       VALUES (1, ?, ?, ?, ?, ?)`, field,
    );
  }

  const settings = {
    general: { locale: "ru-RU", timezone: "Europe/Moscow", weekStartsOn: 1 },
    mail: { enabled: false, host: "", port: 587, secure: false, username: "", passwordEncrypted: "", fromName: "Контур", fromEmail: "" },
    authentication: { localEnabled: true, ldap: { enabled: false, url: "", baseDn: "", bindDn: "", bindPasswordEncrypted: "", userFilter: "(mail={{login}})" }, oidc: { enabled: false, issuer: "", clientId: "", clientSecretEncrypted: "", scopes: "openid profile email" } },
    notifications: { taskAssigned: true, dueSoon: true, statusChanged: false },
  };
  for (const [category, value] of Object.entries(settings)) {
    await db.query("INSERT IGNORE INTO system_settings (workspace_id, category, value_json, updated_by) VALUES (1, ?, ?, ?)", [category, JSON.stringify(value), admin.id]);
  }

  const issueTypes = [
    ["epic", "Эпик", "Крупная инициатива, объединяющая истории и задачи", "flag", "#8A63D2", 1, false, 100],
    ["story", "История", "Пользовательская ценность в рамках эпика", "bookmark", "#2EA879", 0, false, 200],
    ["task", "Задача", "Стандартная единица работы", "check-square", "#4E8AC7", 0, false, 300],
    ["bug", "Ошибка", "Дефект продукта или процесса", "bug", "#D76060", 0, false, 400],
    ["subtask", "Подзадача", "Декомпозиция задачи", "corner-down-right", "#7D8797", -1, true, 500],
  ];
  for (const type of issueTypes) {
    await db.query(
      `INSERT IGNORE INTO issue_types (workspace_id, code, name, description, icon, color, hierarchy_level, is_subtask, position)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)`, type,
    );
  }
  const [issueTypeRows] = await db.query("SELECT id, code FROM issue_types WHERE workspace_id = 1");
  const issueType = Object.fromEntries(issueTypeRows.map((row) => [row.code, row.id]));

  let [[issueScheme]] = await db.query("SELECT id FROM issue_type_schemes WHERE workspace_id = 1 AND is_default = TRUE LIMIT 1");
  if (!issueScheme) {
    const [created] = await db.query("INSERT INTO issue_type_schemes (workspace_id, name, description, is_default) VALUES (1, 'Стандартная схема типов', 'Эпики, истории, задачи, ошибки и подзадачи', TRUE)");
    issueScheme = { id: created.insertId };
  }
  for (const [index, type] of issueTypeRows.entries()) await db.query("INSERT IGNORE INTO issue_type_scheme_items (scheme_id, issue_type_id, position) VALUES (?, ?, ?)", [issueScheme.id, type.id, (index + 1) * 100]);

  let [[permissionScheme]] = await db.query("SELECT id FROM permission_schemes WHERE workspace_id = 1 AND is_default = TRUE LIMIT 1");
  if (!permissionScheme) {
    const [created] = await db.query("INSERT INTO permission_schemes (workspace_id, name, description, is_default) VALUES (1, 'Корпоративная схема', 'Роли проекта с наследованием глобальных прав', TRUE)");
    permissionScheme = { id: created.insertId };
    const grants = [
      ["project.browse", "any_authenticated", null],
      ["task.create", "project_role", "member"],
      ["task.edit", "project_role", "member"],
      ["task.assign", "project_role", "manager"],
      ["task.delete", "project_role", "manager"],
      ["sprint.manage", "project_role", "manager"],
      ["release.manage", "project_role", "manager"],
      ["project.admin", "global_role", "admin"],
      ["project.admin", "project_role", "manager"],
    ];
    for (const grant of grants) await db.query("INSERT INTO permission_grants (scheme_id, permission_key, principal_type, principal_value) VALUES (?, ?, ?, ?)", [permissionScheme.id, ...grant]);
  }
  await db.query("UPDATE projects SET issue_type_scheme_id = COALESCE(issue_type_scheme_id, ?), permission_scheme_id = COALESCE(permission_scheme_id, ?)", [issueScheme.id, permissionScheme.id]);
  await db.query("UPDATE tasks SET issue_type_id = COALESCE(issue_type_id, ?)", [issueType.task]);

  await db.query(`INSERT IGNORE INTO access_groups (workspace_id, code, name, description, source)
                  VALUES (1, 'delivery', 'Контур поставки', 'Общая группа проектного офиса и продуктовых команд', 'local'),
                         (1, 'pmo', 'Проектный офис', 'Руководители портфеля и методологи', 'local'),
                         (1, 'product', 'Продуктовая команда', 'Участники продуктовой разработки', 'local'),
                         (1, 'contractors', 'Внешние исполнители', 'Временный доступ внешних специалистов', 'local')`);
  const [accessGroupRows] = await db.query("SELECT id, code FROM access_groups WHERE workspace_id=1");
  const accessGroup = Object.fromEntries(accessGroupRows.map((group) => [group.code, group.id]));
  await db.query("UPDATE access_groups SET parent_group_id=? WHERE id IN (?, ?) AND parent_group_id IS NULL", [accessGroup.delivery, accessGroup.pmo, accessGroup.product]);
  await db.query("INSERT IGNORE INTO access_group_members (group_id, user_id, membership_source) VALUES (?, ?, 'direct'), (?, ?, 'direct')", [accessGroup.pmo, admin.id, accessGroup.product, admin.id]);

  await db.query(`INSERT IGNORE INTO access_roles (workspace_id, code, name, description, scope, is_system)
                  VALUES (1, 'portfolio_lead', 'Руководитель портфеля', 'Создаёт проекты, группы и шаблоны', 'workspace', TRUE),
                         (1, 'project_contributor', 'Участник проекта', 'Работает с задачами, файлами и отчётами', 'project', TRUE),
                         (1, 'project_observer', 'Наблюдатель проекта', 'Просматривает проект и отчёты без изменения данных', 'project', TRUE)`);
  const [accessRoleRows] = await db.query("SELECT id, code FROM access_roles WHERE workspace_id=1");
  const accessRole = Object.fromEntries(accessRoleRows.map((role) => [role.code, role.id]));
  const rolePermissions = {
    portfolio_lead: ["project.create", "project.group.manage", "project.template.manage", "knowledge.view"],
    project_contributor: ["project.browse", "task.create", "task.edit", "task.assign", "comment.create", "attachment.manage", "worklog.create", "report.view", "chat.use", "conference.join", "conference.create", "telephony.view", "telephony.call"],
    project_observer: ["project.browse", "report.view", "chat.use", "conference.join", "telephony.view"],
  };
  for (const [roleCode, permissionKeys] of Object.entries(rolePermissions)) {
    for (const permissionKey of permissionKeys) await db.query("INSERT IGNORE INTO access_role_permissions (role_id, permission_key, effect) VALUES (?, ?, 'allow')", [accessRole[roleCode], permissionKey]);
  }
  await db.query("INSERT IGNORE INTO access_assignments (role_id, principal_type, principal_id, scope_type, scope_id, created_by) VALUES (?, 'group', ?, 'workspace', 0, ?), (?, 'group', ?, 'project', ?, ?)", [accessRole.portfolio_lead, accessGroup.pmo, admin.id, accessRole.project_contributor, accessGroup.product, projectId, admin.id]);

  const templateTasks = [
    { title: "Сформулировать цели и метрики", description: "Зафиксировать ожидаемый эффект и критерии успеха.", stage_code: "backlog", issue_type_code: "task", priority: "high", start_offset_days: 0, due_offset_days: 3 },
    { title: "Исследовать пользователей", description: "Проверить основные сценарии и ограничения.", stage_code: "analysis", issue_type_code: "story", priority: "high", start_offset_days: 1, due_offset_days: 8 },
    { title: "Подготовить первую поставку", description: "Собрать минимальный полезный объём решения.", stage_code: "progress", issue_type_code: "epic", priority: "critical", start_offset_days: 5, due_offset_days: 24 },
    { title: "Провести приёмку и запланировать релиз", description: "Подтвердить качество и готовность к выпуску.", stage_code: "review", issue_type_code: "task", priority: "high", start_offset_days: 22, due_offset_days: 30 },
  ];
  await db.query(
    `INSERT IGNORE INTO project_templates (workspace_id, name, description, workflow_id, issue_type_scheme_id, permission_scheme_id, default_group_id, color, duration_days, default_tasks_json, created_by)
     VALUES (1, 'Продуктовая разработка', 'Проект с исследованием, первой поставкой и приёмкой', ?, ?, ?, 1, '#675EE7', 30, ?, ?)`,
    [workflowId, issueScheme.id, permissionScheme.id, JSON.stringify(templateTasks), admin.id],
  );

  await db.query("INSERT IGNORE INTO project_components (project_id, name, description, lead_user_id) VALUES (?, 'Веб-приложение', 'Клиентский интерфейс и BFF', ?), (?, 'Интеграции', 'Корпоративные подключения', ?)", [projectId, admin.id, projectId, admin.id]);
  let [[projectChat]] = await db.query("SELECT id FROM chat_channels WHERE project_id=? AND channel_type='project' LIMIT 1", [projectId]);
  if (!projectChat) {
    const [created] = await db.query("INSERT INTO chat_channels (workspace_id, project_id, channel_type, name, created_by) VALUES (1, ?, 'project', 'Команда Nova', ?)", [projectId, admin.id]);
    projectChat = { id: created.insertId };
    await db.query("INSERT INTO chat_channel_members (channel_id, user_id, member_role) VALUES (?, ?, 'owner')", [projectChat.id, admin.id]);
    await db.query("INSERT INTO chat_messages (channel_id, sender_id, body, message_type) VALUES (?, ?, 'Проектный чат создан. Здесь можно обсуждать задачи, делиться файлами и планировать встречи.', 'system')", [projectChat.id, admin.id]);
  }
  await db.query("INSERT IGNORE INTO labels (workspace_id, name, color) VALUES (1, 'MVP', '#675EE7'), (1, 'UX', '#A65CB3'), (1, 'Безопасность', '#D76060'), (1, 'Интеграция', '#4E8AC7')");

  let [[activeSprint]] = await db.query("SELECT id FROM sprints WHERE project_id = ? AND status = 'active' LIMIT 1", [projectId]);
  if (!activeSprint) {
    const [created] = await db.query("INSERT INTO sprints (project_id, name, goal, status, start_date, end_date, created_by) VALUES (?, 'Спринт 1', 'Подтвердить ключевые сценарии и техническую реализуемость', 'active', CURRENT_DATE, DATE_ADD(CURRENT_DATE, INTERVAL 14 DAY), ?)", [projectId, admin.id]);
    activeSprint = { id: created.insertId };
    await db.query("UPDATE tasks SET sprint_id = ? WHERE project_id = ? AND task_number IN (2,3,4)", [activeSprint.id, projectId]);
    await db.query("INSERT INTO sprints (project_id, name, goal, status, start_date, end_date, created_by) VALUES (?, 'Спринт 2', 'Подготовить решение к реализации', 'planned', DATE_ADD(CURRENT_DATE, INTERVAL 15 DAY), DATE_ADD(CURRENT_DATE, INTERVAL 28 DAY), ?)", [projectId, admin.id]);
  }

  let [[release]] = await db.query("SELECT id FROM releases WHERE project_id = ? AND name = '1.0' LIMIT 1", [projectId]);
  if (!release) {
    const [created] = await db.query("INSERT INTO releases (project_id, name, description, start_date, release_date) VALUES (?, '1.0', 'Первый производственный запуск Nova', CURRENT_DATE, DATE_ADD(CURRENT_DATE, INTERVAL 45 DAY))", [projectId]);
    release = { id: created.insertId };
    await db.query("UPDATE tasks SET release_id = ? WHERE project_id = ?", [release.id, projectId]);
  }

  const [stageRowsForTransitions] = await db.query("SELECT id, code, name FROM workflow_stages WHERE workflow_id = ? ORDER BY position", [workflowId]);
  for (let index = 0; index < stageRowsForTransitions.length - 1; index += 1) {
    const from = stageRowsForTransitions[index], to = stageRowsForTransitions[index + 1];
    const [[exists]] = await db.query("SELECT id FROM workflow_transitions WHERE workflow_id = ? AND from_stage_id = ? AND to_stage_id = ? LIMIT 1", [workflowId, from.id, to.id]);
    if (!exists) await db.query("INSERT INTO workflow_transitions (workflow_id, from_stage_id, to_stage_id, name, position) VALUES (?, ?, ?, ?, ?)", [workflowId, from.id, to.id, `Перевести в «${to.name}»`, (index + 1) * 100]);
  }

  const [[automation]] = await db.query("SELECT id FROM automation_rules WHERE workspace_id = 1 AND name = 'Уведомление о приближении срока' LIMIT 1");
  if (!automation) await db.query(
    "INSERT INTO automation_rules (workspace_id, name, description, trigger_type, trigger_config_json, conditions_json, actions_json, run_as_user_id) VALUES (1, 'Уведомление о приближении срока', 'Напоминает исполнителю за два дня до срока', 'task.due_soon', ?, ?, ?, ?)",
    [JSON.stringify({ cron: "0 8 * * *" }), JSON.stringify([{ field: "due_date", operator: "within_days", value: 2 }, { field: "is_done", operator: "equals", value: false }]), JSON.stringify([{ type: "notify_assignee", template: "due_soon" }]), admin.id],
  );

  let [[dashboard]] = await db.query("SELECT id FROM dashboards WHERE workspace_id = 1 AND owner_id = ? LIMIT 1", [admin.id]);
  if (!dashboard) {
    const [created] = await db.query("INSERT INTO dashboards (workspace_id, owner_id, name, is_shared, layout_json) VALUES (1, ?, 'Обзор портфеля', TRUE, ?)", [admin.id, JSON.stringify({ columns: 12, rowHeight: 80 })]);
    dashboard = { id: created.insertId };
    const widgets = [
      ["sla_summary", "Контроль SLA", { projectId }, { x: 0, y: 0, w: 4, h: 3 }],
      ["my_tasks", "Мои ближайшие задачи", { projectId: null }, { x: 4, y: 0, w: 8, h: 3 }],
      ["status_distribution", "Задачи по этапам", { projectId }, { x: 0, y: 3, w: 6, h: 3 }],
      ["sla_risk", "Риск нарушения SLA", { projectId: null }, { x: 6, y: 3, w: 6, h: 3 }],
    ];
    for (const widget of widgets) await db.query("INSERT INTO dashboard_widgets (dashboard_id, widget_type, title, config_json, position_json) VALUES (?, ?, ?, ?, ?)", [dashboard.id, widget[0], widget[1], JSON.stringify(widget[2]), JSON.stringify(widget[3])]);
  }
  await db.query("INSERT INTO user_dashboard_preferences (user_id, home_dashboard_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE home_dashboard_id=COALESCE(home_dashboard_id, VALUES(home_dashboard_id))", [admin.id, dashboard.id]);

  const [[space]] = await db.query("SELECT id FROM knowledge_spaces WHERE workspace_id = 1 AND slug = 'team' LIMIT 1");
  let spaceId = space?.id;
  if (!spaceId) {
    const [created] = await db.query("INSERT INTO knowledge_spaces (workspace_id, name, slug, description, created_by) VALUES (1, 'База знаний команды', 'team', 'Регламенты, решения и инструкции', ?)", [admin.id]);
    spaceId = created.insertId;
    await db.query("INSERT INTO knowledge_articles (space_id, title, slug, body, status, author_id, published_at) VALUES (?, 'Как мы работаем с задачами', 'task-workflow', ?, 'published', ?, CURRENT_TIMESTAMP)", [spaceId, '# Как мы работаем с задачами\n\nКаждая задача должна иметь ожидаемый результат, исполнителя и срок. Крупные инициативы оформляются эпиками, а работа планируется спринтами.', admin.id]);
  }
  await db.query("INSERT IGNORE INTO knowledge_teams (workspace_id, name, slug, description, color, created_by) VALUES (1, 'Продуктовая команда', 'product-team', 'Владельцы и редакторы продуктовой документации', '#675EE7', ?)", [admin.id]);
  const [[knowledgeTeam]] = await db.query("SELECT id FROM knowledge_teams WHERE workspace_id=1 AND slug='product-team'");
  await db.query("INSERT INTO knowledge_team_members (team_id, user_id, team_role, added_by) VALUES (?, ?, 'lead', ?) ON DUPLICATE KEY UPDATE team_role='lead'", [knowledgeTeam.id, admin.id, admin.id]);
  await db.query("UPDATE knowledge_spaces SET owner_team_id=COALESCE(owner_team_id, ?) WHERE id=?", [knowledgeTeam.id, spaceId]);
  await db.query("INSERT INTO knowledge_space_permissions (space_id, principal_type, principal_id, access_level, granted_by) VALUES (?, 'user', ?, 'admin', ?), (?, 'team', ?, 'edit', ?) ON DUPLICATE KEY UPDATE access_level=VALUES(access_level), granted_by=VALUES(granted_by)", [spaceId, admin.id, admin.id, spaceId, knowledgeTeam.id, admin.id]);

  const [[taskSla]] = await db.query("SELECT id FROM task_sla_policies WHERE workspace_id=1 AND name='Критические задачи' LIMIT 1");
  if (!taskSla) {
    await db.query(
      `INSERT INTO task_sla_policies (workspace_id, project_id, name, description, goal_minutes, warning_percent, conditions_json, position, created_by)
       VALUES (1, ?, 'Критические задачи', 'Критический приоритет в продуктовых проектах', 1440, 75, ?, 100, ?),
              (1, NULL, 'Стандартные задачи', 'Правило по умолчанию, если более точные условия не совпали', 10080, 80, JSON_ARRAY(), 1000, ?)`,
      [projectId, JSON.stringify([{ field: "priority", operator: "equals", value: "critical" }]), admin.id, admin.id],
    );
  }
  // Явные номера начальных записей не должны пересекаться с будущими номерами PostgreSQL.
  if(databaseEngine()==='postgres')for(const table of ['workspaces','project_groups']) {
    await db.query(`SELECT setval(pg_get_serial_sequence(?, 'id'), GREATEST((SELECT COALESCE(MAX(id),1) FROM ${table}),(SELECT last_value FROM ${table}_id_seq)))`,[table]);
  }
  await db.commit();
  console.log(`Начальные данные готовы. Администратор: ${adminEmail}`);
} catch (error) {
  await db.rollback();
  throw error;
} finally {
  await db.end();
}
