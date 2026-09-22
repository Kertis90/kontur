CREATE TABLE IF NOT EXISTS telephony_calls (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  workspace_id BIGINT UNSIGNED NOT NULL,
  project_id BIGINT UNSIGNED NOT NULL,
  task_id BIGINT UNSIGNED NULL,
  conference_id BIGINT UNSIGNED NULL,
  direction ENUM('outbound','inbound') NOT NULL DEFAULT 'outbound',
  from_number VARCHAR(32) NOT NULL,
  to_number VARCHAR(32) NOT NULL,
  provider_call_id VARCHAR(191) NULL,
  status ENUM('queued','ringing','active','completed','failed','cancelled','busy','no_answer') NOT NULL DEFAULT 'queued',
  record_call BOOLEAN NOT NULL DEFAULT FALSE,
  initiated_by BIGINT UNSIGNED NULL,
  started_at TIMESTAMP NULL,
  answered_at TIMESTAMP NULL,
  ended_at TIMESTAMP NULL,
  duration_seconds INT UNSIGNED NULL,
  failure_reason VARCHAR(1000) NULL,
  metadata_json JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_telephony_provider_call (provider_call_id),
  KEY ix_telephony_project_created (project_id, created_at),
  KEY ix_telephony_status_created (workspace_id, status, created_at),
  CONSTRAINT fk_telephony_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  CONSTRAINT fk_telephony_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_telephony_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL,
  CONSTRAINT fk_telephony_conference FOREIGN KEY (conference_id) REFERENCES conferences(id) ON DELETE SET NULL,
  CONSTRAINT fk_telephony_initiator FOREIGN KEY (initiated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT IGNORE INTO access_role_permissions (role_id, permission_key, effect)
SELECT id, 'telephony.view', 'allow' FROM access_roles WHERE code IN ('project_contributor', 'project_observer');

INSERT IGNORE INTO access_role_permissions (role_id, permission_key, effect)
SELECT id, 'telephony.call', 'allow' FROM access_roles WHERE code='project_contributor';
