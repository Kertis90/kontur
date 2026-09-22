CREATE TABLE ai_agents (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 workspace_id BIGINT UNSIGNED NOT NULL, project_id BIGINT UNSIGNED NOT NULL,
 name VARCHAR(160) NOT NULL, enabled BOOLEAN NOT NULL DEFAULT FALSE,
 config_json JSON NOT NULL, revision INT UNSIGNED NOT NULL DEFAULT 1,
 execution_user_id BIGINT UNSIGNED NOT NULL, execution_api_token_id BIGINT UNSIGNED NULL,
 next_run_at DATETIME NULL, last_error VARCHAR(1000) NULL,
 created_by BIGINT UNSIGNED NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 KEY(workspace_id,project_id), KEY(enabled,next_run_at),
 FOREIGN KEY(workspace_id) REFERENCES workspaces(id), FOREIGN KEY(project_id) REFERENCES projects(id),
 FOREIGN KEY(execution_user_id) REFERENCES users(id), FOREIGN KEY(created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE ai_agent_runs (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, agent_id BIGINT UNSIGNED NOT NULL,
 workspace_id BIGINT UNSIGNED NOT NULL, project_id BIGINT UNSIGNED NOT NULL,
 actor_id BIGINT UNSIGNED NOT NULL, api_token_id BIGINT UNSIGNED NULL,
 agent_revision INT UNSIGNED NOT NULL, config_json JSON NOT NULL,
 trigger_type ENUM('manual','event','schedule') NOT NULL,
 trigger_key VARCHAR(180) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
 trigger_context_json JSON NOT NULL,
 status ENUM('queued','running','review','completed','failed','cancelled','rejected') NOT NULL DEFAULT 'queued',
 source_refs_json JSON NULL, source_meta_json JSON NULL, result_json JSON NULL, applied_json JSON NULL,
 model VARCHAR(200) NULL, error_text VARCHAR(1000) NULL,
 input_tokens BIGINT UNSIGNED NULL, output_tokens BIGINT UNSIGNED NULL,
 reviewed_by BIGINT UNSIGNED NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, started_at DATETIME NULL, completed_at DATETIME NULL,
 UNIQUE KEY(agent_id,trigger_key), KEY(status,created_at), KEY(agent_id,created_at),
 FOREIGN KEY(agent_id) REFERENCES ai_agents(id), FOREIGN KEY(workspace_id) REFERENCES workspaces(id),
 FOREIGN KEY(project_id) REFERENCES projects(id), FOREIGN KEY(actor_id) REFERENCES users(id),
 FOREIGN KEY(reviewed_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
