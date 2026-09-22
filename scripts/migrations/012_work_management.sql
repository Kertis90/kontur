-- Work management 0.10: all tables use the existing MySQL workspace identity.
ALTER TABLE automation_rules ADD COLUMN next_run_at DATETIME NULL;
ALTER TABLE automation_runs ADD COLUMN step_results_json JSON NULL;
CREATE TABLE automation_executions (
  rule_id BIGINT UNSIGNED NOT NULL, event_id CHAR(36) NOT NULL, step_path VARCHAR(180) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending', result_json JSON NULL,
  PRIMARY KEY(rule_id,event_id,step_path),
  FOREIGN KEY(rule_id) REFERENCES automation_rules(id) ON DELETE CASCADE
);
CREATE TABLE approval_requests (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, workspace_id BIGINT UNSIGNED NOT NULL,
  project_id BIGINT UNSIGNED NOT NULL, task_id BIGINT UNSIGNED NULL, task_version_number INT UNSIGNED NULL, title VARCHAR(300) NOT NULL,
  mode ENUM('sequential','parallel') NOT NULL, status ENUM('pending','approved','rejected','cancelled') NOT NULL DEFAULT 'pending',
  requested_by BIGINT UNSIGNED NOT NULL, due_at DATETIME NULL, reason TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, completed_at DATETIME NULL, reminded_at DATETIME NULL,
  KEY(workspace_id,status), FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE, FOREIGN KEY(requested_by) REFERENCES users(id)
);
CREATE TABLE approval_steps (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, request_id BIGINT UNSIGNED NOT NULL,
  position INT UNSIGNED NOT NULL, reviewer_id BIGINT UNSIGNED NOT NULL, substitute_id BIGINT UNSIGNED NULL,
  decision ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  decided_by BIGINT UNSIGNED NULL, comment TEXT NULL, decided_at DATETIME NULL,
  UNIQUE KEY(request_id,position), FOREIGN KEY(request_id) REFERENCES approval_requests(id) ON DELETE CASCADE,
  FOREIGN KEY(reviewer_id) REFERENCES users(id), FOREIGN KEY(substitute_id) REFERENCES users(id), FOREIGN KEY(decided_by) REFERENCES users(id)
);
CREATE TABLE approval_gates (
  project_id BIGINT UNSIGNED NOT NULL, stage_id BIGINT UNSIGNED NOT NULL,
  required_fields_json JSON NOT NULL, PRIMARY KEY(project_id,stage_id),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY(stage_id) REFERENCES workflow_stages(id) ON DELETE CASCADE
);
CREATE TABLE resource_calendars (
  user_id BIGINT UNSIGNED PRIMARY KEY, workspace_id BIGINT UNSIGNED NOT NULL,
  hours_json JSON NOT NULL, timezone VARCHAR(100) NOT NULL DEFAULT 'UTC',
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);
CREATE TABLE resource_absences (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, workspace_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NULL, start_date DATE NOT NULL, end_date DATE NOT NULL,
  unavailable_percent INT NOT NULL DEFAULT 100, label VARCHAR(180) NOT NULL,
  CHECK(end_date>=start_date), CHECK(unavailable_percent BETWEEN 1 AND 100),
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE resource_allocations (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, project_id BIGINT UNSIGNED NOT NULL, user_id BIGINT UNSIGNED NOT NULL,
  start_date DATE NOT NULL, end_date DATE NOT NULL, hours_per_day DECIMAL(5,2) NOT NULL,
  CHECK(end_date>=start_date), CHECK(hours_per_day>0 AND hours_per_day<=24),
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE portfolio_baselines (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, workspace_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(180) NOT NULL, created_by BIGINT UNSIGNED NOT NULL, snapshot_json JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE, FOREIGN KEY(created_by) REFERENCES users(id)
);
CREATE TABLE meeting_actions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, conference_id BIGINT UNSIGNED NOT NULL,
  recording_id BIGINT UNSIGNED NULL, source_seconds INT UNSIGNED NULL, source_text TEXT NULL,
  title VARCHAR(300) NOT NULL, description TEXT NULL, assignee_id BIGINT UNSIGNED NULL, due_date DATE NULL,
  status ENUM('draft','accepted','dismissed') NOT NULL DEFAULT 'draft', task_id BIGINT UNSIGNED NULL,
  generated_by BIGINT UNSIGNED NOT NULL, fingerprint CHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, reviewed_by BIGINT UNSIGNED NULL,
  UNIQUE KEY(conference_id,fingerprint), FOREIGN KEY(conference_id) REFERENCES conferences(id) ON DELETE CASCADE,
  FOREIGN KEY(recording_id) REFERENCES conference_recordings(id) ON DELETE SET NULL,
  FOREIGN KEY(assignee_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE SET NULL, FOREIGN KEY(generated_by) REFERENCES users(id), FOREIGN KEY(reviewed_by) REFERENCES users(id)
);
ALTER TABLE conference_recordings ADD COLUMN retained_until DATETIME NULL,
  ADD COLUMN deleted_at DATETIME NULL;
CREATE TABLE recording_chapters (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, recording_id BIGINT UNSIGNED NOT NULL,
  start_seconds INT UNSIGNED NOT NULL, title VARCHAR(300) NOT NULL, created_by BIGINT UNSIGNED NOT NULL,
  FOREIGN KEY(recording_id) REFERENCES conference_recordings(id) ON DELETE CASCADE, FOREIGN KEY(created_by) REFERENCES users(id)
);
CREATE TABLE recording_transcript_edits (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, recording_id BIGINT UNSIGNED NOT NULL,
  chunk_index INT UNSIGNED NOT NULL, original_text MEDIUMTEXT NOT NULL, replacement_text MEDIUMTEXT NOT NULL,
  changed_by BIGINT UNSIGNED NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(recording_id) REFERENCES conference_recordings(id) ON DELETE CASCADE, FOREIGN KEY(changed_by) REFERENCES users(id)
);
ALTER TABLE knowledge_articles ADD COLUMN steward_id BIGINT UNSIGNED NULL,
  ADD COLUMN review_due_date DATE NULL, ADD COLUMN review_status ENUM('none','pending','approved','rejected') NOT NULL DEFAULT 'none',
  ADD COLUMN reviewed_by BIGINT UNSIGNED NULL, ADD COLUMN reviewed_version INT UNSIGNED NULL,
  ADD COLUMN review_reminded_date DATE NULL;
CREATE TABLE knowledge_blocks (
  id CHAR(36) PRIMARY KEY, article_id BIGINT UNSIGNED NOT NULL, position INT NOT NULL,
  body MEDIUMTEXT NOT NULL, revision INT UNSIGNED NOT NULL DEFAULT 1,
  updated_by BIGINT UNSIGNED NOT NULL, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL, FOREIGN KEY(article_id) REFERENCES knowledge_articles(id) ON DELETE CASCADE,
  FOREIGN KEY(updated_by) REFERENCES users(id)
);
CREATE TABLE knowledge_collaborators (
  article_id BIGINT UNSIGNED NOT NULL, user_id BIGINT UNSIGNED NOT NULL, seen_at DATETIME NOT NULL,
  PRIMARY KEY(article_id,user_id), FOREIGN KEY(article_id) REFERENCES knowledge_articles(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE knowledge_annotations (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, article_id BIGINT UNSIGNED NOT NULL,
  block_id CHAR(36) NULL, quote_text TEXT NULL, body TEXT NOT NULL, author_id BIGINT UNSIGNED NOT NULL,
  resolved_at DATETIME NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(article_id) REFERENCES knowledge_articles(id) ON DELETE CASCADE, FOREIGN KEY(author_id) REFERENCES users(id)
);
CREATE TABLE task_field_access (
  project_id BIGINT UNSIGNED NOT NULL, field_code VARCHAR(120) NOT NULL,
  readers_json JSON NOT NULL, editors_json JSON NOT NULL,
  PRIMARY KEY(project_id,field_code), FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE TABLE project_access_requests (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, project_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL, project_role ENUM('viewer','member') NOT NULL,
  reason TEXT NOT NULL, expires_at DATETIME NOT NULL, status ENUM('pending','approved','rejected','revoked','expired') NOT NULL DEFAULT 'pending',
  decided_by BIGINT UNSIGNED NULL, decision_reason TEXT NULL, decided_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(decided_by) REFERENCES users(id)
);
CREATE TABLE offline_operations (
  user_id BIGINT UNSIGNED NOT NULL, operation_id CHAR(36) NOT NULL, request_hash CHAR(64) NOT NULL, result_json JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(user_id,operation_id),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE notification_preferences (
  user_id BIGINT UNSIGNED PRIMARY KEY, timezone VARCHAR(100) NOT NULL DEFAULT 'UTC',
  quiet_start TIME NULL, quiet_end TIME NULL, digest ENUM('off','daily','weekly') NOT NULL DEFAULT 'off',
  digest_hour INT NOT NULL DEFAULT 9, last_digest_at DATETIME NULL, mentions_only BOOLEAN NOT NULL DEFAULT FALSE,
  email_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  enabled_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
ALTER TABLE user_notifications ADD COLUMN mail_delivered_at DATETIME NULL;
CREATE TABLE development_connections (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, project_id BIGINT UNSIGNED NOT NULL,
  provider ENUM('github','gitlab') NOT NULL, name VARCHAR(180) NOT NULL, repository_url VARCHAR(1000) NOT NULL,
  secret_encrypted TEXT NOT NULL, enabled BOOLEAN NOT NULL DEFAULT TRUE,
  FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE TABLE development_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, connection_id BIGINT UNSIGNED NOT NULL,
  external_id VARCHAR(200) NOT NULL, task_id BIGINT UNSIGNED NOT NULL, kind VARCHAR(40) NOT NULL,
  title VARCHAR(300) NOT NULL, url VARCHAR(1500) NULL, state VARCHAR(80) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY(connection_id,external_id,task_id), FOREIGN KEY(connection_id) REFERENCES development_connections(id) ON DELETE CASCADE,
  FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
);
CREATE TABLE work_ai_requests (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, workspace_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL, purpose VARCHAR(80) NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY(user_id,created_at), FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE, FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE work_ai_jobs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, workspace_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL, api_token_id BIGINT UNSIGNED NULL, conference_id BIGINT UNSIGNED NOT NULL,
  recording_id BIGINT UNSIGNED NOT NULL, status ENUM('queued','running','completed','failed') NOT NULL DEFAULT 'queued',
  progress INT NOT NULL DEFAULT 0, error_text VARCHAR(1000) NULL, heartbeat_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE, FOREIGN KEY(user_id) REFERENCES users(id),
  FOREIGN KEY(conference_id) REFERENCES conferences(id) ON DELETE CASCADE, FOREIGN KEY(recording_id) REFERENCES conference_recordings(id) ON DELETE CASCADE
);
CREATE TABLE knowledge_article_revisions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, article_id BIGINT UNSIGNED NOT NULL,
  version_number INT UNSIGNED NOT NULL, title VARCHAR(300) NOT NULL, body MEDIUMTEXT NOT NULL,
  changed_by BIGINT UNSIGNED NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY(article_id,version_number), FOREIGN KEY(article_id) REFERENCES knowledge_articles(id) ON DELETE CASCADE,
  FOREIGN KEY(changed_by) REFERENCES users(id)
);
CREATE TABLE work_import_items (
  project_id BIGINT UNSIGNED NOT NULL, external_key VARCHAR(255) NOT NULL, task_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY(project_id,external_key), FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

-- Indexes for periodic scans and per-user delivery under multiple workers.
CREATE INDEX automation_due_idx ON automation_rules(enabled,trigger_type,next_run_at);
CREATE INDEX approval_reminder_idx ON approval_requests(status,reminded_at,due_at);
CREATE INDEX recording_retention_idx ON conference_recordings(deleted_at,retained_until);
CREATE INDEX access_request_effective_idx ON project_access_requests(user_id,status,expires_at,project_id);
CREATE INDEX work_ai_pending_idx ON work_ai_jobs(status,heartbeat_at);
CREATE INDEX notification_mail_idx ON user_notifications(user_id,read_at,mail_delivered_at,created_at);
