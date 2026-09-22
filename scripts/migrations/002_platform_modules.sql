CREATE TABLE IF NOT EXISTS issue_types (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  workspace_id BIGINT UNSIGNED NOT NULL,
  code VARCHAR(60) NOT NULL,
  name VARCHAR(100) NOT NULL,
  description VARCHAR(500) NULL,
  icon VARCHAR(60) NOT NULL DEFAULT 'task',
  color VARCHAR(16) NOT NULL DEFAULT '#675EE7',
  hierarchy_level SMALLINT NOT NULL DEFAULT 0,
  is_subtask BOOLEAN NOT NULL DEFAULT FALSE,
  position INT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id),
  UNIQUE KEY uq_issue_types_workspace_code (workspace_id, code),
  CONSTRAINT fk_issue_types_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS issue_type_schemes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  workspace_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(140) NOT NULL,
  description VARCHAR(500) NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (id),
  CONSTRAINT fk_issue_type_schemes_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS issue_type_scheme_items (
  scheme_id BIGINT UNSIGNED NOT NULL,
  issue_type_id BIGINT UNSIGNED NOT NULL,
  position INT NOT NULL DEFAULT 0,
  PRIMARY KEY (scheme_id, issue_type_id),
  CONSTRAINT fk_issue_scheme_items_scheme FOREIGN KEY (scheme_id) REFERENCES issue_type_schemes(id) ON DELETE CASCADE,
  CONSTRAINT fk_issue_scheme_items_type FOREIGN KEY (issue_type_id) REFERENCES issue_types(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS permission_schemes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  workspace_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(140) NOT NULL,
  description VARCHAR(500) NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_permission_schemes_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS permission_grants (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  scheme_id BIGINT UNSIGNED NOT NULL,
  permission_key VARCHAR(100) NOT NULL,
  principal_type ENUM('global_role','project_role','user','group','reporter','assignee','any_authenticated') NOT NULL,
  principal_value VARCHAR(160) NULL,
  PRIMARY KEY (id),
  KEY ix_permission_grants_lookup (scheme_id, permission_key),
  CONSTRAINT fk_permission_grants_scheme FOREIGN KEY (scheme_id) REFERENCES permission_schemes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS workflow_transitions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  workflow_id BIGINT UNSIGNED NOT NULL,
  from_stage_id BIGINT UNSIGNED NULL,
  to_stage_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(120) NOT NULL,
  conditions_json JSON NULL,
  validators_json JSON NULL,
  actions_json JSON NULL,
  position INT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY ix_workflow_transitions_from (workflow_id, from_stage_id),
  CONSTRAINT fk_transitions_workflow FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE,
  CONSTRAINT fk_transitions_from FOREIGN KEY (from_stage_id) REFERENCES workflow_stages(id) ON DELETE CASCADE,
  CONSTRAINT fk_transitions_to FOREIGN KEY (to_stage_id) REFERENCES workflow_stages(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS task_field_contexts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  field_id BIGINT UNSIGNED NOT NULL,
  project_id BIGINT UNSIGNED NULL,
  issue_type_id BIGINT UNSIGNED NULL,
  default_value_json JSON NULL,
  required_override BOOLEAN NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_field_context (field_id, project_id, issue_type_id),
  CONSTRAINT fk_field_context_field FOREIGN KEY (field_id) REFERENCES task_field_definitions(id) ON DELETE CASCADE,
  CONSTRAINT fk_field_context_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_field_context_issue_type FOREIGN KEY (issue_type_id) REFERENCES issue_types(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS project_components (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  project_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(140) NOT NULL,
  description VARCHAR(500) NULL,
  lead_user_id BIGINT UNSIGNED NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_project_components (project_id, name),
  CONSTRAINT fk_components_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_components_lead FOREIGN KEY (lead_user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS labels (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  workspace_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(100) NOT NULL,
  color VARCHAR(16) NOT NULL DEFAULT '#7D8797',
  PRIMARY KEY (id),
  UNIQUE KEY uq_labels_workspace_name (workspace_id, name),
  CONSTRAINT fk_labels_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS sprints (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  project_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(160) NOT NULL,
  goal TEXT NULL,
  status ENUM('planned','active','completed','cancelled') NOT NULL DEFAULT 'planned',
  start_date DATE NULL,
  end_date DATE NULL,
  completed_at TIMESTAMP NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_sprints_project_status (project_id, status, start_date),
  CONSTRAINT fk_sprints_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_sprints_creator FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS releases (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  project_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(120) NOT NULL,
  description TEXT NULL,
  status ENUM('unreleased','released','archived') NOT NULL DEFAULT 'unreleased',
  start_date DATE NULL,
  release_date DATE NULL,
  released_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_releases_project_name (project_id, name),
  CONSTRAINT fk_releases_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS task_labels (
  task_id BIGINT UNSIGNED NOT NULL,
  label_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (task_id, label_id),
  CONSTRAINT fk_task_labels_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  CONSTRAINT fk_task_labels_label FOREIGN KEY (label_id) REFERENCES labels(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS task_watchers (
  task_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (task_id, user_id),
  CONSTRAINT fk_task_watchers_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  CONSTRAINT fk_task_watchers_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS task_checklist_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  task_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(500) NOT NULL,
  completed BOOLEAN NOT NULL DEFAULT FALSE,
  completed_by BIGINT UNSIGNED NULL,
  completed_at TIMESTAMP NULL,
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_checklist_task_position (task_id, position),
  CONSTRAINT fk_checklist_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  CONSTRAINT fk_checklist_completed_by FOREIGN KEY (completed_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS task_attachments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  task_id BIGINT UNSIGNED NOT NULL,
  uploaded_by BIGINT UNSIGNED NOT NULL,
  file_name VARCHAR(500) NOT NULL,
  object_key VARCHAR(700) NOT NULL,
  mime_type VARCHAR(200) NULL,
  size_bytes BIGINT UNSIGNED NOT NULL,
  checksum_sha256 CHAR(64) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_attachments_object (object_key),
  KEY ix_attachments_task (task_id, created_at),
  CONSTRAINT fk_attachments_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  CONSTRAINT fk_attachments_user FOREIGN KEY (uploaded_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS worklogs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  task_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  minutes_spent INT UNSIGNED NOT NULL,
  work_date DATE NOT NULL,
  description VARCHAR(1000) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_worklogs_task_date (task_id, work_date),
  CONSTRAINT fk_worklogs_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  CONSTRAINT fk_worklogs_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS task_revisions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  task_id BIGINT UNSIGNED NOT NULL,
  changed_by BIGINT UNSIGNED NULL,
  version_number INT UNSIGNED NOT NULL,
  change_type VARCHAR(80) NOT NULL,
  changes_json JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_task_revision (task_id, version_number),
  KEY ix_task_revisions_time (task_id, created_at),
  CONSTRAINT fk_task_revisions_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  CONSTRAINT fk_task_revisions_user FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS saved_filters (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  workspace_id BIGINT UNSIGNED NOT NULL,
  owner_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(180) NOT NULL,
  query_text VARCHAR(3000) NOT NULL,
  is_shared BOOLEAN NOT NULL DEFAULT FALSE,
  is_favorite BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_saved_filters_owner (owner_id, is_favorite),
  CONSTRAINT fk_saved_filters_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  CONSTRAINT fk_saved_filters_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS dashboards (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  workspace_id BIGINT UNSIGNED NOT NULL,
  owner_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(180) NOT NULL,
  is_shared BOOLEAN NOT NULL DEFAULT FALSE,
  layout_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_dashboards_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  CONSTRAINT fk_dashboards_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS dashboard_widgets (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  dashboard_id BIGINT UNSIGNED NOT NULL,
  widget_type VARCHAR(80) NOT NULL,
  title VARCHAR(180) NOT NULL,
  config_json JSON NOT NULL,
  position_json JSON NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT fk_dashboard_widgets_dashboard FOREIGN KEY (dashboard_id) REFERENCES dashboards(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS automation_rules (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  workspace_id BIGINT UNSIGNED NOT NULL,
  project_id BIGINT UNSIGNED NULL,
  name VARCHAR(180) NOT NULL,
  description VARCHAR(500) NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  trigger_type VARCHAR(100) NOT NULL,
  trigger_config_json JSON NULL,
  conditions_json JSON NULL,
  actions_json JSON NOT NULL,
  run_as_user_id BIGINT UNSIGNED NOT NULL,
  last_run_at TIMESTAMP NULL,
  run_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  error_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_automation_trigger (workspace_id, trigger_type, enabled),
  CONSTRAINT fk_automation_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  CONSTRAINT fk_automation_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_automation_run_as FOREIGN KEY (run_as_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS automation_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  rule_id BIGINT UNSIGNED NOT NULL,
  event_id VARCHAR(120) NULL,
  status ENUM('queued','running','succeeded','failed','skipped') NOT NULL,
  input_json JSON NULL,
  result_json JSON NULL,
  error_text TEXT NULL,
  started_at TIMESTAMP NULL,
  finished_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_automation_runs_rule_time (rule_id, created_at),
  CONSTRAINT fk_automation_runs_rule FOREIGN KEY (rule_id) REFERENCES automation_rules(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS webhooks (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  workspace_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(180) NOT NULL,
  target_url VARCHAR(1000) NOT NULL,
  secret_encrypted TEXT NULL,
  event_types_json JSON NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_status INT NULL,
  last_delivery_at TIMESTAMP NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_webhooks_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  CONSTRAINT fk_webhooks_creator FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS api_tokens (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  workspace_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(180) NOT NULL,
  token_prefix VARCHAR(20) NOT NULL,
  token_hash CHAR(64) NOT NULL,
  scopes_json JSON NOT NULL,
  expires_at TIMESTAMP NULL,
  last_used_at TIMESTAMP NULL,
  revoked_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_api_token_hash (token_hash),
  KEY ix_api_tokens_user (user_id, revoked_at),
  CONSTRAINT fk_api_tokens_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  CONSTRAINT fk_api_tokens_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS user_notifications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  title VARCHAR(300) NOT NULL,
  body VARCHAR(2000) NULL,
  entity_type VARCHAR(80) NULL,
  entity_id VARCHAR(120) NULL,
  action_url VARCHAR(1000) NULL,
  read_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_notifications_user_unread (user_id, read_at, created_at),
  CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS outbox_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_uuid CHAR(36) NOT NULL,
  workspace_id BIGINT UNSIGNED NOT NULL,
  event_type VARCHAR(120) NOT NULL,
  aggregate_type VARCHAR(80) NOT NULL,
  aggregate_id VARCHAR(120) NOT NULL,
  payload_json JSON NOT NULL,
  available_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at TIMESTAMP NULL,
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_outbox_uuid (event_uuid),
  KEY ix_outbox_pending (processed_at, available_at, id),
  CONSTRAINT fk_outbox_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS service_queues (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  workspace_id BIGINT UNSIGNED NOT NULL,
  project_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(160) NOT NULL,
  description VARCHAR(500) NULL,
  query_text VARCHAR(3000) NOT NULL,
  position INT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_service_queue_name (project_id, name),
  CONSTRAINT fk_service_queues_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  CONSTRAINT fk_service_queues_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS sla_policies (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  workspace_id BIGINT UNSIGNED NOT NULL,
  project_id BIGINT UNSIGNED NULL,
  name VARCHAR(160) NOT NULL,
  metric_type ENUM('first_response','resolution') NOT NULL,
  goal_minutes INT UNSIGNED NOT NULL,
  calendar_json JSON NOT NULL,
  conditions_json JSON NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id),
  CONSTRAINT fk_sla_policies_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  CONSTRAINT fk_sla_policies_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS service_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  task_id BIGINT UNSIGNED NOT NULL,
  requester_id BIGINT UNSIGNED NULL,
  requester_email VARCHAR(254) NULL,
  channel ENUM('portal','email','api','agent') NOT NULL DEFAULT 'portal',
  request_type VARCHAR(120) NOT NULL,
  organization_name VARCHAR(180) NULL,
  first_response_at TIMESTAMP NULL,
  resolved_at TIMESTAMP NULL,
  sla_first_response_due TIMESTAMP NULL,
  sla_resolution_due TIMESTAMP NULL,
  satisfaction_score TINYINT UNSIGNED NULL,
  satisfaction_comment VARCHAR(2000) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_service_request_task (task_id),
  CONSTRAINT fk_service_requests_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  CONSTRAINT fk_service_requests_requester FOREIGN KEY (requester_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT ck_satisfaction_score CHECK (satisfaction_score IS NULL OR satisfaction_score BETWEEN 1 AND 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS knowledge_spaces (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  workspace_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(180) NOT NULL,
  slug VARCHAR(100) NOT NULL,
  description VARCHAR(500) NULL,
  visibility ENUM('private','workspace','public') NOT NULL DEFAULT 'workspace',
  created_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_knowledge_space_slug (workspace_id, slug),
  CONSTRAINT fk_knowledge_spaces_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  CONSTRAINT fk_knowledge_spaces_creator FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS knowledge_articles (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  space_id BIGINT UNSIGNED NOT NULL,
  parent_id BIGINT UNSIGNED NULL,
  title VARCHAR(300) NOT NULL,
  slug VARCHAR(180) NOT NULL,
  body MEDIUMTEXT NOT NULL,
  status ENUM('draft','published','archived') NOT NULL DEFAULT 'draft',
  version_number INT UNSIGNED NOT NULL DEFAULT 1,
  author_id BIGINT UNSIGNED NOT NULL,
  published_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_knowledge_article_slug (space_id, slug),
  FULLTEXT KEY fx_knowledge_articles (title, body),
  CONSTRAINT fk_knowledge_articles_space FOREIGN KEY (space_id) REFERENCES knowledge_spaces(id) ON DELETE CASCADE,
  CONSTRAINT fk_knowledge_articles_parent FOREIGN KEY (parent_id) REFERENCES knowledge_articles(id) ON DELETE SET NULL,
  CONSTRAINT fk_knowledge_articles_author FOREIGN KEY (author_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS integration_connections (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  workspace_id BIGINT UNSIGNED NOT NULL,
  provider VARCHAR(80) NOT NULL,
  name VARCHAR(180) NOT NULL,
  config_json JSON NOT NULL,
  secrets_encrypted TEXT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_sync_at TIMESTAMP NULL,
  last_error TEXT NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_integrations_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  CONSTRAINT fk_integrations_creator FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS import_jobs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  workspace_id BIGINT UNSIGNED NOT NULL,
  requested_by BIGINT UNSIGNED NOT NULL,
  source_type ENUM('jira_json','jira_csv','csv','api') NOT NULL,
  status ENUM('queued','running','succeeded','failed') NOT NULL DEFAULT 'queued',
  object_key VARCHAR(700) NULL,
  options_json JSON NULL,
  result_json JSON NULL,
  error_text TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMP NULL,
  finished_at TIMESTAMP NULL,
  PRIMARY KEY (id),
  CONSTRAINT fk_import_jobs_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  CONSTRAINT fk_import_jobs_user FOREIGN KEY (requested_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE projects
  ADD COLUMN issue_type_scheme_id BIGINT UNSIGNED NULL AFTER workflow_id,
  ADD COLUMN permission_scheme_id BIGINT UNSIGNED NULL AFTER issue_type_scheme_id,
  ADD CONSTRAINT fk_projects_issue_type_scheme FOREIGN KEY (issue_type_scheme_id) REFERENCES issue_type_schemes(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_projects_permission_scheme FOREIGN KEY (permission_scheme_id) REFERENCES permission_schemes(id) ON DELETE SET NULL;

ALTER TABLE tasks
  ADD COLUMN issue_type_id BIGINT UNSIGNED NULL AFTER stage_id,
  ADD COLUMN parent_task_id BIGINT UNSIGNED NULL AFTER issue_type_id,
  ADD COLUMN epic_task_id BIGINT UNSIGNED NULL AFTER parent_task_id,
  ADD COLUMN sprint_id BIGINT UNSIGNED NULL AFTER epic_task_id,
  ADD COLUMN release_id BIGINT UNSIGNED NULL AFTER sprint_id,
  ADD COLUMN component_id BIGINT UNSIGNED NULL AFTER release_id,
  ADD COLUMN story_points DECIMAL(8,2) NULL AFTER estimate_minutes,
  ADD COLUMN resolution VARCHAR(100) NULL AFTER progress,
  ADD COLUMN rank_value DECIMAL(30,15) NOT NULL DEFAULT 1000 AFTER position,
  ADD COLUMN environment TEXT NULL AFTER description,
  ADD COLUMN version_number INT UNSIGNED NOT NULL DEFAULT 1 AFTER custom_values_json,
  ADD KEY ix_tasks_parent (parent_task_id),
  ADD KEY ix_tasks_epic (epic_task_id),
  ADD KEY ix_tasks_sprint_rank (sprint_id, rank_value),
  ADD KEY ix_tasks_release (release_id),
  ADD CONSTRAINT fk_tasks_issue_type FOREIGN KEY (issue_type_id) REFERENCES issue_types(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_tasks_parent FOREIGN KEY (parent_task_id) REFERENCES tasks(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_tasks_epic FOREIGN KEY (epic_task_id) REFERENCES tasks(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_tasks_sprint FOREIGN KEY (sprint_id) REFERENCES sprints(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_tasks_release FOREIGN KEY (release_id) REFERENCES releases(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_tasks_component FOREIGN KEY (component_id) REFERENCES project_components(id) ON DELETE SET NULL;

ALTER TABLE comments
  ADD COLUMN is_internal BOOLEAN NOT NULL DEFAULT FALSE AFTER body,
  ADD COLUMN deleted_at TIMESTAMP NULL AFTER updated_at;
