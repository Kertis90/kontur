ALTER TABLE system_settings MODIFY COLUMN category ENUM('general','mail','authentication','notifications','ai') NOT NULL;

CREATE TABLE IF NOT EXISTS ai_jobs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  workspace_id BIGINT UNSIGNED NOT NULL,
  project_id BIGINT UNSIGNED NOT NULL,
  conference_id BIGINT UNSIGNED NULL,
  job_type ENUM('project','conference') NOT NULL,
  requested_by BIGINT UNSIGNED NOT NULL,
  request_id CHAR(36) NOT NULL,
  cache_key CHAR(64) NOT NULL,
  profile_id CHAR(36) NOT NULL,
  profile_revision CHAR(64) NOT NULL,
  provider_name VARCHAR(100) NOT NULL,
  model VARCHAR(200) NOT NULL,
  instructions VARCHAR(2000) NOT NULL DEFAULT '',
  input_json JSON NULL,
  source_meta_json JSON NOT NULL,
  result_text MEDIUMTEXT NULL,
  status ENUM('queued','running','completed','failed','cancelled') NOT NULL DEFAULT 'queued',
  error_text VARCHAR(1000) NULL,
  input_tokens INT UNSIGNED NULL,
  output_tokens INT UNSIGNED NULL,
  incomplete BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMP NULL,
  completed_at TIMESTAMP NULL,
  UNIQUE KEY uq_ai_cache (workspace_id, cache_key),
  UNIQUE KEY uq_ai_request (workspace_id, requested_by, request_id),
  KEY ix_ai_pending (status, created_at),
  KEY ix_ai_project (project_id, job_type, created_at),
  KEY ix_ai_conference (conference_id, created_at),
  KEY ix_ai_user_usage (workspace_id, requested_by, created_at),
  CONSTRAINT fk_ai_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  CONSTRAINT fk_ai_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_ai_conference FOREIGN KEY (conference_id) REFERENCES conferences(id) ON DELETE CASCADE,
  CONSTRAINT fk_ai_requester FOREIGN KEY (requested_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE projects ADD COLUMN deleted_at TIMESTAMP NULL;

CREATE TABLE IF NOT EXISTS project_group_access (
  project_id BIGINT UNSIGNED NOT NULL,
  group_id BIGINT UNSIGNED NOT NULL,
  project_role ENUM('manager','member','viewer') NOT NULL DEFAULT 'viewer',
  created_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (project_id, group_id),
  KEY ix_group_project_access (group_id, project_id),
  CONSTRAINT fk_pga_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_pga_group FOREIGN KEY (group_id) REFERENCES access_groups(id) ON DELETE CASCADE,
  CONSTRAINT fk_pga_creator FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
