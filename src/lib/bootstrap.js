import {dashboardGroups,canReadDashboard} from './dashboard-access.js';
import { fieldAccess, redactFields } from "./work-access.js";
import { rows, parseJson } from "./db.js";
import { PERMISSION_CATALOG, permissionMap, projectPermissionSet, workspacePermissionSet } from "./permissions.js";
import { getSettings, publicSettings } from "./settings.js";
import { API_SCOPE_CATALOG, DEFAULT_API_SCOPES, apiScopes } from "./api-access.js";
import { evaluateTaskSlas, normalizeTaskSlaPolicy } from "./task-sla.js";
import { knowledgeAccessAtLeast, knowledgeAccessMap } from "./knowledge-access.js";
import { legacyIntegrationSummaries } from './legacy-integrations.js';
import {listTribes} from './tribe-policy.js';

// Возвращает разрешённые данные компании и пространства трайбов без расширения доступа к проектам.
export async function getBootstrap(user) {
  const workspaceId = user.workspace_id;
  const workspacePermissions = await workspacePermissionSet(user);
  const workspacePermissionMap = permissionMap(workspacePermissions);
  const tribes=await listTribes(user);
  if(tribes.some(tribe=>tribe.can_create_projects))workspacePermissionMap['project.create']=true;
  const adminAccess = ["operations.view", "user.manage", "group.manage", "role.manage", "workflow.manage", "field.manage", "project.template.manage", "automation.manage", "integration.manage", "ai.configure", "sla.manage", "api.access.manage", "import.manage", "mail.manage", "auth.manage", "audit.view"].some((key) => workspacePermissions.has(key));
  const [workspaceRows, groups, projects, stages, fields, users, tasks, dependencies, issueTypes, components, labels, sprints, releases, savedFilters, dashboards, widgets, notifications, knowledgeSpaces, knowledgeArticles, projectTemplates, taskSlaPolicies, dashboardPreferences, myApiAccessRows, myApiTokens] = await Promise.all([
    rows("SELECT id, name, slug FROM workspaces WHERE id = ?", [workspaceId]),
    rows("SELECT * FROM project_groups WHERE workspace_id = ? ORDER BY position, name", [workspaceId]),
    rows(`SELECT p.*, pg.name AS group_name, w.name AS workflow_name
          FROM projects p LEFT JOIN project_groups pg ON pg.id = p.group_id JOIN workflows w ON w.id = p.workflow_id
          WHERE p.workspace_id = ? AND p.status = 'active' AND p.deleted_at IS NULL ORDER BY pg.position, p.name`, [workspaceId]),
    rows(`SELECT ws.*, w.name AS workflow_name FROM workflow_stages ws JOIN workflows w ON w.id = ws.workflow_id
          WHERE w.workspace_id = ? ORDER BY ws.workflow_id, ws.position`, [workspaceId]),
    rows("SELECT * FROM task_field_definitions WHERE workspace_id = ? AND active = TRUE ORDER BY position, label", [workspaceId]),
    rows("SELECT id, email, display_name, global_role, auth_source, status, avatar_color, last_login_at, is_service FROM users WHERE workspace_id = ? ORDER BY display_name", [workspaceId]),
    rows(`SELECT t.*, p.key_code, p.name AS project_name, ws.name AS stage_name, ws.code AS stage_code, ws.color AS stage_color, ws.category AS status_category, ws.is_done,
                 u.display_name AS assignee_name, u.avatar_color AS assignee_color,
                 it.name AS issue_type_name, it.code AS issue_type_code, it.icon AS issue_type_icon, it.color AS issue_type_color,
                 s.name AS sprint_name, s.status AS sprint_status, r.name AS release_name, pc.name AS component_name
          FROM tasks t JOIN projects p ON p.id = t.project_id JOIN workflow_stages ws ON ws.id = t.stage_id
          LEFT JOIN users u ON u.id = t.assignee_id
          LEFT JOIN issue_types it ON it.id = t.issue_type_id
          LEFT JOIN sprints s ON s.id = t.sprint_id
          LEFT JOIN releases r ON r.id = t.release_id
          LEFT JOIN project_components pc ON pc.id = t.component_id
          WHERE p.workspace_id = ? ORDER BY t.project_id, ws.position, t.rank_value`, [workspaceId]),
    rows(`SELECT td.* FROM task_dependencies td JOIN tasks t ON t.id = td.task_id JOIN projects p ON p.id = t.project_id WHERE p.workspace_id = ?`, [workspaceId]),
    rows("SELECT * FROM issue_types WHERE workspace_id = ? AND active = TRUE ORDER BY position, name", [workspaceId]),
    rows("SELECT pc.* FROM project_components pc JOIN projects p ON p.id=pc.project_id WHERE p.workspace_id=? ORDER BY pc.project_id, pc.name", [workspaceId]),
    rows("SELECT * FROM labels WHERE workspace_id=? ORDER BY name", [workspaceId]),
    rows("SELECT s.* FROM sprints s JOIN projects p ON p.id=s.project_id WHERE p.workspace_id=? ORDER BY FIELD(s.status,'active','planned','completed','cancelled'), s.start_date DESC", [workspaceId]),
    rows("SELECT r.* FROM releases r JOIN projects p ON p.id=r.project_id WHERE p.workspace_id=? ORDER BY FIELD(r.status,'unreleased','released','archived'), r.release_date", [workspaceId]),
    rows("SELECT * FROM saved_filters WHERE workspace_id=? AND (owner_id=? OR is_shared=TRUE) ORDER BY is_favorite DESC, name", [workspaceId, user.id]),
    rows("SELECT * FROM dashboards WHERE workspace_id=? AND (owner_id=? OR is_shared=TRUE) ORDER BY updated_at DESC", [workspaceId, user.id]),
    rows("SELECT dw.* FROM dashboard_widgets dw JOIN dashboards d ON d.id=dw.dashboard_id WHERE d.workspace_id=? AND (d.owner_id=? OR d.is_shared=TRUE)", [workspaceId, user.id]),
    rows("SELECT * FROM user_notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 50", [user.id]),
    rows("SELECT space.*, team.name AS owner_team_name, team.color AS owner_team_color FROM knowledge_spaces space LEFT JOIN knowledge_teams team ON team.id=space.owner_team_id WHERE space.workspace_id=? ORDER BY space.name", [workspaceId]),
    rows("SELECT ka.id, ka.space_id, ka.parent_id, ka.title, ka.slug, ka.status, ka.version_number, ka.author_id, ka.published_at, ka.updated_at FROM knowledge_articles ka JOIN knowledge_spaces ks ON ks.id=ka.space_id WHERE ks.workspace_id=? AND ka.status IN ('draft','published') ORDER BY ka.updated_at DESC LIMIT 5000", [workspaceId]),
    rows("SELECT * FROM project_templates WHERE workspace_id=? AND active=TRUE ORDER BY name", [workspaceId]),
    rows("SELECT * FROM task_sla_policies WHERE workspace_id=? ORDER BY enabled DESC, position, id", [workspaceId]),
    rows("SELECT home_dashboard_id FROM user_dashboard_preferences WHERE user_id=?", [user.id]),
    rows("SELECT enabled, allowed_scopes_json, max_token_ttl_days, updated_at FROM user_api_access WHERE user_id=? AND workspace_id=?", [user.id, workspaceId]),
    rows("SELECT id, name, token_prefix, scopes_json, expires_at, last_used_at, revoked_at, created_at FROM api_tokens WHERE user_id=? AND workspace_id=? ORDER BY created_at DESC", [user.id, workspaceId]),
  ]);

  const [slaEvents,slaCalendars]=await Promise.all([
    rows('SELECT e.* FROM task_state_events e JOIN tasks t ON t.id=e.task_id JOIN projects p ON p.id=t.project_id WHERE p.workspace_id=?',[workspaceId]),
    rows('SELECT * FROM business_calendars WHERE workspace_id=?',[workspaceId]),
  ]);
  const dashboardGroupIds=new Set((await dashboardGroups(user)).map(g=>Number(g.id)));
  const readableDashboards=dashboards.filter(d=>canReadDashboard(user,d,dashboardGroupIds));
  const workflows = await rows("SELECT * FROM workflows WHERE workspace_id = ? ORDER BY is_default DESC, name", [workspaceId]);
  const access = await Promise.all(projects.map(async (project) => [project.id, await projectPermissionSet(user, project)]));
  const projectPermissions = Object.fromEntries(access.map(([projectId, permissions]) => [projectId, permissionMap(permissions)]));
  const visibleProjectIds = new Set(access.filter(([, permissions]) => permissions.has("project.browse")).map(([projectId]) => projectId));
  const fieldPolicies = new Map(await Promise.all([...visibleProjectIds].map(async projectId => [Number(projectId), await fieldAccess(user, projectId)])));
  const hiddenFields = new Set([...fieldPolicies.values()].flatMap(policies => policies.filter(p => !p.can_read).map(p => `custom.${p.field_code}`)));
  const visibleTasks = tasks.filter((task) => visibleProjectIds.has(task.project_id)).map((task) => ({ ...task, custom_values: parseJson(task.custom_values_json, {}), dependencies: dependencies.filter((d) => d.task_id === task.id).map(d => ({ task_id: d.depends_on_task_id, depends_on_task_id: d.depends_on_task_id, dependency_type: d.dependency_type })) })).map(task => redactFields(task, fieldPolicies.get(Number(task.project_id)) || []));
  const visibleTaskSlaPolicies = taskSlaPolicies.filter((policy) => !parseJson(policy.conditions_json, []).some(condition => hiddenFields.has(condition.field)) && policy.enabled && (!policy.project_id || visibleProjectIds.has(policy.project_id)));
  const knowledgeAccess = await knowledgeAccessMap(user, knowledgeSpaces);
  const visibleKnowledgeSpaces = knowledgeSpaces
    .filter((space) => knowledgeAccessAtLeast(knowledgeAccess.get(Number(space.id)) || "none", "view"))
    .map((space) => {
      const accessLevel = knowledgeAccess.get(Number(space.id)) || "none";
      return {
        ...space,
        access_level: accessLevel,
        can_edit: knowledgeAccessAtLeast(accessLevel, "edit"),
        can_admin: knowledgeAccessAtLeast(accessLevel, "admin"),
      };
    });
  const visibleKnowledgeSpaceIds = new Set(visibleKnowledgeSpaces.map((space) => Number(space.id)));
  const visibleKnowledgeArticles = knowledgeArticles.filter((article) => {
    if (!visibleKnowledgeSpaceIds.has(Number(article.space_id))) return false;
    const level = knowledgeAccess.get(Number(article.space_id)) || "none";
    return article.status === "published" || knowledgeAccessAtLeast(level, "edit");
  });
  const [knowledgeTeams, allKnowledgeTeamMembers, allKnowledgeSpacePermissions] = await Promise.all([
    rows(`SELECT team.*,
                 (SELECT COUNT(*) FROM knowledge_team_members member WHERE member.team_id=team.id) AS member_count,
                 (SELECT member.team_role FROM knowledge_team_members member WHERE member.team_id=team.id AND member.user_id=? LIMIT 1) AS current_user_role
          FROM knowledge_teams team WHERE team.workspace_id=? AND team.active=TRUE ORDER BY team.name`, [user.id, workspaceId]),
    rows(`SELECT member.team_id, member.user_id, member.team_role, member.created_at, account.display_name, account.avatar_color
          FROM knowledge_team_members member JOIN knowledge_teams team ON team.id=member.team_id JOIN users account ON account.id=member.user_id
          WHERE team.workspace_id=? ORDER BY account.display_name`, [workspaceId]),
    rows(`SELECT permission.*, CASE permission.principal_type WHEN 'user' THEN account.display_name ELSE team.name END AS principal_name
          FROM knowledge_space_permissions permission
          JOIN knowledge_spaces space ON space.id=permission.space_id
          LEFT JOIN users account ON permission.principal_type='user' AND account.id=permission.principal_id
          LEFT JOIN knowledge_teams team ON permission.principal_type='team' AND team.id=permission.principal_id
          WHERE space.workspace_id=? ORDER BY principal_name`, [workspaceId]),
  ]);
  const globalKnowledgeManager = workspacePermissions.has("knowledge.manage");
  const administrableSpaceIds = new Set(visibleKnowledgeSpaces.filter((space) => space.can_admin).map((space) => Number(space.id)));
  const visibleKnowledgeTeams = knowledgeTeams
    .filter((team) =>
      globalKnowledgeManager || administrableSpaceIds.size > 0 || team.current_user_role || visibleKnowledgeSpaces.some((space) => Number(space.owner_team_id) === Number(team.id)),
    )
    .map((team) => ({
      ...team,
      can_manage: globalKnowledgeManager || team.current_user_role === "lead",
    }));
  const manageableTeamIds = new Set(knowledgeTeams.filter((team) => globalKnowledgeManager || team.current_user_role === "lead").map((team) => Number(team.id)));
  const knowledgeTeamMembers = allKnowledgeTeamMembers.filter((member) => manageableTeamIds.has(Number(member.team_id)));
  const knowledgeSpacePermissions = allKnowledgeSpacePermissions.filter((permission) => administrableSpaceIds.has(Number(permission.space_id)));
  const canViewKnowledge = visibleKnowledgeSpaces.length > 0 || knowledgeTeams.some((team) => team.current_user_role) || workspacePermissions.has("knowledge.view") || workspacePermissions.has("knowledge.manage");
  const canSeeUserContacts = ["user.manage", "group.manage", "role.manage"].some((key) => workspacePermissions.has(key));
  const stageByWorkflow = Object.groupBy(stages, (stage) => String(stage.workflow_id));
  const settings = { general: publicSettings("general", await getSettings(workspaceId, "general")) };
  let administration = null;
  if (adminAccess) {
    if (workspacePermissions.has("mail.manage")) settings.mail = publicSettings("mail", await getSettings(workspaceId, "mail"));
    if (workspacePermissions.has("auth.manage")) settings.authentication = publicSettings("authentication", await getSettings(workspaceId, "authentication"));
    settings.notifications = publicSettings("notifications", await getSettings(workspaceId, "notifications"));
    const [automationRules, webhooks, integrations, permissionSchemes, permissionGrants, apiTokens, importJobs, accessGroups, accessGroupMembers, accessRoles, accessRolePermissions, accessAssignments, projectMembers, apiAccessPolicies] = await Promise.all([
      rows("SELECT * FROM automation_rules WHERE workspace_id=? ORDER BY enabled DESC, name", [workspaceId]),
      rows("SELECT id, name, target_url, event_types_json, enabled, last_status, last_delivery_at, created_at FROM webhooks WHERE workspace_id=? ORDER BY name", [workspaceId]),
      legacyIntegrationSummaries(workspaceId,workspacePermissions.has("integration.manage")),
      rows("SELECT * FROM permission_schemes WHERE workspace_id=? ORDER BY is_default DESC, name", [workspaceId]),
      rows("SELECT pg.* FROM permission_grants pg JOIN permission_schemes ps ON ps.id=pg.scheme_id WHERE ps.workspace_id=? ORDER BY pg.permission_key", [workspaceId]),
      rows("SELECT at.id, at.user_id, at.name, at.token_prefix, at.scopes_json, at.expires_at, at.last_used_at, at.revoked_at, at.created_at, u.display_name AS user_name FROM api_tokens at JOIN users u ON u.id=at.user_id WHERE at.workspace_id=? ORDER BY at.created_at DESC", [workspaceId]),
      rows("SELECT * FROM import_jobs WHERE workspace_id=? ORDER BY created_at DESC LIMIT 100", [workspaceId]),
      rows("SELECT access_group.*, parent.name AS parent_name FROM access_groups access_group LEFT JOIN access_groups parent ON parent.id=access_group.parent_group_id WHERE access_group.workspace_id=? ORDER BY access_group.name", [workspaceId]),
      rows("SELECT member.*, user.display_name, user.email, user.avatar_color FROM access_group_members member JOIN users user ON user.id=member.user_id JOIN access_groups access_group ON access_group.id=member.group_id WHERE access_group.workspace_id=? ORDER BY user.display_name", [workspaceId]),
      rows("SELECT * FROM access_roles WHERE workspace_id=? ORDER BY scope, name", [workspaceId]),
      rows("SELECT permission.* FROM access_role_permissions permission JOIN access_roles role ON role.id=permission.role_id WHERE role.workspace_id=? ORDER BY permission.permission_key", [workspaceId]),
      rows(`SELECT assignment.*, role.name AS role_name, role.scope AS role_scope,
                   COALESCE(user.display_name, access_group.name) AS principal_name,
                   COALESCE(project.name, project_group.name, 'Всё рабочее пространство') AS scope_name
            FROM access_assignments assignment JOIN access_roles role ON role.id=assignment.role_id
            LEFT JOIN users user ON assignment.principal_type='user' AND user.id=assignment.principal_id
            LEFT JOIN access_groups access_group ON assignment.principal_type='group' AND access_group.id=assignment.principal_id
            LEFT JOIN projects project ON assignment.scope_type='project' AND project.id=assignment.scope_id
            LEFT JOIN project_groups project_group ON assignment.scope_type='project_group' AND project_group.id=assignment.scope_id
            WHERE role.workspace_id=? ORDER BY role.name, principal_name`, [workspaceId]),
      rows("SELECT member.*, user.display_name, user.email, project.name AS project_name FROM project_members member JOIN users user ON user.id=member.user_id JOIN projects project ON project.id=member.project_id WHERE project.workspace_id=? ORDER BY project.name, user.display_name", [workspaceId]),
      rows(`SELECT user.id AS user_id, user.display_name, user.email, user.status,
                   COALESCE(policy.enabled, TRUE) AS enabled, policy.allowed_scopes_json, COALESCE(policy.max_token_ttl_days, 365) AS max_token_ttl_days,
                   (SELECT COUNT(*) FROM api_tokens token WHERE token.user_id=user.id AND token.revoked_at IS NULL AND (token.expires_at IS NULL OR token.expires_at>CURRENT_TIMESTAMP)) AS active_tokens
            FROM users user LEFT JOIN user_api_access policy ON policy.user_id=user.id WHERE user.workspace_id=? ORDER BY user.display_name`, [workspaceId]),
    ]);
    administration = {
      automationRules: workspacePermissions.has("automation.manage") ? automationRules.map((rule) => ({ ...rule, trigger_config: parseJson(rule.trigger_config_json, {}), conditions: parseJson(rule.conditions_json, []), actions: parseJson(rule.actions_json, []) })) : [],
      webhooks: workspacePermissions.has("integration.manage") ? webhooks.map((hook) => ({ ...hook, event_types: parseJson(hook.event_types_json, []) })) : [],
      integrations,
      permissionSchemes: workspacePermissions.has("role.manage") ? permissionSchemes.map((scheme) => ({ ...scheme, grants: permissionGrants.filter((grant) => grant.scheme_id === scheme.id) })) : [],
      apiTokens: workspacePermissions.has("integration.manage") ? apiTokens.map((token) => ({ ...token, scopes: parseJson(token.scopes_json, []) })) : [],
      taskSlaPolicies: workspacePermissions.has("sla.manage") ? taskSlaPolicies.map(normalizeTaskSlaPolicy) : [],
      apiAccessPolicies: workspacePermissions.has("api.access.manage") ? apiAccessPolicies.map((policy) => ({ ...policy, allowed_scopes: policy.allowed_scopes_json ? apiScopes(policy.allowed_scopes_json) : DEFAULT_API_SCOPES })) : [],
      importJobs: workspacePermissions.has("import.manage") ? importJobs.map((job) => ({ ...job, options: parseJson(job.options_json, {}), result: parseJson(job.result_json, null) })) : [],
      accessGroups: (workspacePermissions.has("group.manage") || workspacePermissions.has("role.manage")) ? accessGroups.map((group) => ({ ...group, members: accessGroupMembers.filter((member) => member.group_id === group.id) })) : [],
      accessRoles: workspacePermissions.has("role.manage") ? accessRoles.map((role) => ({ ...role, permissions: accessRolePermissions.filter((permission) => permission.role_id === role.id), assignments: accessAssignments.filter((assignment) => assignment.role_id === role.id) })) : [],
      accessAssignments: workspacePermissions.has("role.manage") ? accessAssignments : [],
      projectMembers: workspacePermissions.has("role.manage") ? projectMembers : [],
      permissionCatalog: PERMISSION_CATALOG,
    };
  }

  return {
    tribes,
    workspace: workspaceRows[0],
    user,
    permissions: {
      admin: adminAccess,
      manageProjects: Boolean(workspacePermissionMap['project.create']),
      writeTasks: Object.values(projectPermissions).some((permissions) => permissions["task.create"] || permissions["task.edit"]),
      features: workspacePermissionMap,
      projects: projectPermissions,
      fieldAccess: Object.fromEntries([...fieldPolicies].map(([id, policies]) => [id, Object.fromEntries(policies.map(p => [p.field_code, {read:p.can_read,edit:p.can_edit}]))])),
      catalog: PERMISSION_CATALOG,
    },
    groups,
    projects: projects.filter((project) => visibleProjectIds.has(project.id)),
    workflows: workflows.map((workflow) => ({ ...workflow, stages: stageByWorkflow[String(workflow.id)] || [] })),
    fields: fields.map((field) => ({ ...field, options: parseJson(field.options_json, []) })),
    users: users.map((entry) => canSeeUserContacts ? entry : { ...entry, email: undefined }),
    tasks: visibleTasks,
    issueTypes,
    components: components.filter((component) => visibleProjectIds.has(component.project_id)),
    labels,
    sprints: sprints.filter((sprint) => visibleProjectIds.has(sprint.project_id)),
    releases: releases.filter((release) => visibleProjectIds.has(release.project_id)),
    savedFilters,
    dashboards: readableDashboards.map((dashboard) => ({ ...dashboard, layout: parseJson(dashboard.layout_json, {}), widgets: widgets.filter((widget) => widget.dashboard_id === dashboard.id).map((widget) => ({ ...widget, config: parseJson(widget.config_json, {}), position: parseJson(widget.position_json, {}) })) })),
    homeDashboardId: readableDashboards.some(d=>d.id===dashboardPreferences[0]?.home_dashboard_id) ? dashboardPreferences[0].home_dashboard_id : null,
    taskSlaPolicies: visibleTaskSlaPolicies.map(normalizeTaskSlaPolicy),
    taskSla: evaluateTaskSlas(visibleTasks,visibleTaskSlaPolicies,new Date(),{events:slaEvents,calendars:slaCalendars}).map(({segments,...summary})=>summary),
    api: {
      scopeCatalog: API_SCOPE_CATALOG,
      access: myApiAccessRows[0] ? { enabled: Boolean(myApiAccessRows[0].enabled), allowed_scopes: apiScopes(myApiAccessRows[0].allowed_scopes_json), max_token_ttl_days: myApiAccessRows[0].max_token_ttl_days, updated_at: myApiAccessRows[0].updated_at } : { enabled: false, allowed_scopes: [], max_token_ttl_days: 365 },
      tokens: myApiTokens.map((token) => ({ ...token, scopes: apiScopes(token.scopes_json) })),
    },
    notifications,
    knowledgeSpaces: canViewKnowledge ? visibleKnowledgeSpaces : [],
    knowledgeArticles: canViewKnowledge ? visibleKnowledgeArticles : [],
    knowledgeTeams: canViewKnowledge ? visibleKnowledgeTeams : [],
    knowledgeTeamMembers: canViewKnowledge ? knowledgeTeamMembers : [],
    knowledgeSpacePermissions: canViewKnowledge ? knowledgeSpacePermissions : [],
    projectTemplates: (workspacePermissionMap['project.create'] || workspacePermissions.has("project.template.manage")) ? projectTemplates.map((template) => ({ ...template, default_tasks: parseJson(template.default_tasks_json, []) })) : [],
    administration,
    settings,
  };
}
