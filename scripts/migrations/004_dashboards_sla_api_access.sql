CREATE TABLE IF NOT EXISTS user_dashboard_preferences (
  user_id BIGINT UNSIGNED NOT NULL,
  home_dashboard_id BIGINT UNSIGNED NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_dashboard_preferences_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_dashboard_preferences_dashboard FOREIGN KEY (home_dashboard_id) REFERENCES dashboards(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS task_sla_policies (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  workspace_id BIGINT UNSIGNED NOT NULL,
  project_id BIGINT UNSIGNED NULL,
  name VARCHAR(160) NOT NULL,
  description VARCHAR(500) NULL,
  goal_minutes INT UNSIGNED NOT NULL,
  warning_percent TINYINT UNSIGNED NOT NULL DEFAULT 80,
  conditions_json JSON NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  position INT NOT NULL DEFAULT 100,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_task_sla_match (workspace_id, enabled, project_id, position),
  CONSTRAINT fk_task_sla_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  CONSTRAINT fk_task_sla_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_task_sla_creator FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS user_api_access (
  user_id BIGINT UNSIGNED NOT NULL,
  workspace_id BIGINT UNSIGNED NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  allowed_scopes_json JSON NOT NULL,
  max_token_ttl_days SMALLINT UNSIGNED NOT NULL DEFAULT 365,
  updated_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  KEY ix_user_api_access_workspace (workspace_id, enabled),
  CONSTRAINT fk_user_api_access_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_user_api_access_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  CONSTRAINT fk_user_api_access_updater FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT IGNORE INTO user_api_access (user_id, workspace_id, enabled, allowed_scopes_json, max_token_ttl_days)
SELECT id, workspace_id, TRUE,
       JSON_ARRAY('workspace:read','projects:read','tasks:read','tasks:write','reports:read','knowledge:read','profile:read','profile:write','collaboration:read','collaboration:write'),
       365
FROM users;

UPDATE dashboard_widgets SET widget_type='project_progress', title='Прогресс проектов' WHERE widget_type='burndown';
DELETE FROM dashboard_widgets WHERE widget_type='service_requests';
UPDATE issue_types SET active=FALSE WHERE code='request';
