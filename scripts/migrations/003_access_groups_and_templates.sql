CREATE TABLE IF NOT EXISTS access_groups (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  workspace_id BIGINT UNSIGNED NOT NULL,
  parent_group_id BIGINT UNSIGNED NULL,
  code VARCHAR(80) NOT NULL,
  name VARCHAR(160) NOT NULL,
  description VARCHAR(500) NULL,
  source ENUM('local','ldap','oidc','scim') NOT NULL DEFAULT 'local',
  external_key VARCHAR(255) NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_access_groups_code (workspace_id, code),
  KEY ix_access_groups_parent (parent_group_id),
  CONSTRAINT fk_access_groups_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  CONSTRAINT fk_access_groups_parent FOREIGN KEY (parent_group_id) REFERENCES access_groups(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS access_group_members (
  group_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  membership_source ENUM('direct','ldap','oidc','scim') NOT NULL DEFAULT 'direct',
  expires_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (group_id, user_id),
  KEY ix_access_group_members_user (user_id, expires_at),
  CONSTRAINT fk_access_group_members_group FOREIGN KEY (group_id) REFERENCES access_groups(id) ON DELETE CASCADE,
  CONSTRAINT fk_access_group_members_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS access_roles (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  workspace_id BIGINT UNSIGNED NOT NULL,
  code VARCHAR(80) NOT NULL,
  name VARCHAR(160) NOT NULL,
  description VARCHAR(500) NULL,
  scope ENUM('workspace','project') NOT NULL DEFAULT 'project',
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_access_roles_code (workspace_id, code),
  CONSTRAINT fk_access_roles_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS access_role_permissions (
  role_id BIGINT UNSIGNED NOT NULL,
  permission_key VARCHAR(100) NOT NULL,
  effect ENUM('allow','deny') NOT NULL DEFAULT 'allow',
  PRIMARY KEY (role_id, permission_key),
  CONSTRAINT fk_access_role_permissions_role FOREIGN KEY (role_id) REFERENCES access_roles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS access_assignments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  role_id BIGINT UNSIGNED NOT NULL,
  principal_type ENUM('user','group') NOT NULL,
  principal_id BIGINT UNSIGNED NOT NULL,
  scope_type ENUM('workspace','project_group','project') NOT NULL,
  scope_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
  valid_from TIMESTAMP NULL,
  expires_at TIMESTAMP NULL,
  created_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_access_assignment (role_id, principal_type, principal_id, scope_type, scope_id),
  KEY ix_access_assignment_principal (principal_type, principal_id, expires_at),
  KEY ix_access_assignment_scope (scope_type, scope_id),
  CONSTRAINT fk_access_assignments_role FOREIGN KEY (role_id) REFERENCES access_roles(id) ON DELETE CASCADE,
  CONSTRAINT fk_access_assignments_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS project_templates (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  workspace_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(160) NOT NULL,
  description VARCHAR(500) NULL,
  workflow_id BIGINT UNSIGNED NOT NULL,
  issue_type_scheme_id BIGINT UNSIGNED NULL,
  permission_scheme_id BIGINT UNSIGNED NULL,
  default_group_id BIGINT UNSIGNED NULL,
  color VARCHAR(16) NOT NULL DEFAULT '#675EE7',
  duration_days INT UNSIGNED NOT NULL DEFAULT 30,
  default_tasks_json JSON NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_project_templates_name (workspace_id, name),
  CONSTRAINT fk_project_templates_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  CONSTRAINT fk_project_templates_workflow FOREIGN KEY (workflow_id) REFERENCES workflows(id),
  CONSTRAINT fk_project_templates_issue_scheme FOREIGN KEY (issue_type_scheme_id) REFERENCES issue_type_schemes(id) ON DELETE SET NULL,
  CONSTRAINT fk_project_templates_permission_scheme FOREIGN KEY (permission_scheme_id) REFERENCES permission_schemes(id) ON DELETE SET NULL,
  CONSTRAINT fk_project_templates_group FOREIGN KEY (default_group_id) REFERENCES project_groups(id) ON DELETE SET NULL,
  CONSTRAINT fk_project_templates_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

UPDATE service_requests
SET request_type = 'Запрос на обслуживание'
WHERE LOWER(request_type) = 'инцидент';

UPDATE tasks t
JOIN issue_types old_type ON old_type.id = t.issue_type_id AND old_type.code = 'incident'
LEFT JOIN issue_types request_type ON request_type.workspace_id = old_type.workspace_id AND request_type.code = 'request'
SET t.issue_type_id = request_type.id;

DELETE scheme_item
FROM issue_type_scheme_items scheme_item
JOIN issue_types issue_type ON issue_type.id = scheme_item.issue_type_id
WHERE issue_type.code = 'incident';

DELETE FROM issue_types WHERE code = 'incident';
