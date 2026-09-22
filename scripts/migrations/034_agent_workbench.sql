ALTER TABLE users ADD COLUMN is_service BOOLEAN NOT NULL DEFAULT FALSE;
CREATE TABLE ai_agent_identities (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, workspace_id BIGINT UNSIGNED NOT NULL,
 user_id BIGINT UNSIGNED NOT NULL, owner_id BIGINT UNSIGNED NOT NULL,
 name VARCHAR(160) NOT NULL, enabled BOOLEAN NOT NULL DEFAULT TRUE,
 policy_json JSON NOT NULL, monthly_tokens BIGINT UNSIGNED NOT NULL DEFAULT 1000000,
 revision INT UNSIGNED NOT NULL DEFAULT 1, created_by BIGINT UNSIGNED NOT NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 UNIQUE KEY(user_id), KEY(workspace_id,enabled),
 FOREIGN KEY(workspace_id) REFERENCES workspaces(id), FOREIGN KEY(user_id) REFERENCES users(id),
 FOREIGN KEY(owner_id) REFERENCES users(id), FOREIGN KEY(created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE ai_agent_deployments (
 agent_id BIGINT UNSIGNED PRIMARY KEY, published BOOLEAN NOT NULL DEFAULT TRUE,
 identity_id BIGINT UNSIGNED NULL, published_by BIGINT UNSIGNED NULL, published_at DATETIME NULL,
 FOREIGN KEY(agent_id) REFERENCES ai_agents(id), FOREIGN KEY(identity_id) REFERENCES ai_agent_identities(id), FOREIGN KEY(published_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE ai_agent_drafts (
 agent_id BIGINT UNSIGNED PRIMARY KEY, revision INT UNSIGNED NOT NULL DEFAULT 1,
 base_revision INT UNSIGNED NOT NULL, name VARCHAR(160) NOT NULL, enabled BOOLEAN NOT NULL DEFAULT FALSE,
 config_json JSON NOT NULL, identity_id BIGINT UNSIGNED NULL, updated_by BIGINT UNSIGNED NOT NULL,
 updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 FOREIGN KEY(agent_id) REFERENCES ai_agents(id), FOREIGN KEY(identity_id) REFERENCES ai_agent_identities(id), FOREIGN KEY(updated_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE ai_agent_checkpoints (
 run_id BIGINT UNSIGNED PRIMARY KEY, revision INT UNSIGNED NOT NULL DEFAULT 1,
 node_id VARCHAR(40) NOT NULL, status ENUM('waiting','ready','consumed','rejected','expired') NOT NULL,
 reviewers_json JSON NOT NULL, snapshot_encrypted MEDIUMTEXT NOT NULL,
 expires_at DATETIME NOT NULL, decided_by BIGINT UNSIGNED NULL, decision_note VARCHAR(2000) NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, decided_at DATETIME NULL,
 KEY(status,expires_at), FOREIGN KEY(run_id) REFERENCES ai_agent_runs(id) ON DELETE CASCADE, FOREIGN KEY(decided_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE ai_agent_designs (
 id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 workspace_id BIGINT UNSIGNED NOT NULL, project_id BIGINT UNSIGNED NOT NULL, user_id BIGINT UNSIGNED NOT NULL,
 fingerprint CHAR(64) NOT NULL, status ENUM('running','completed','failed') NOT NULL DEFAULT 'running',
 result_json JSON NULL, error_text VARCHAR(1000) NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(workspace_id) REFERENCES workspaces(id), FOREIGN KEY(project_id) REFERENCES projects(id), FOREIGN KEY(user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE ai_agent_eval_suites (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, agent_id BIGINT UNSIGNED NOT NULL,
 name VARCHAR(160) NOT NULL, cases_json JSON NOT NULL, revision INT UNSIGNED NOT NULL DEFAULT 1,
 created_by BIGINT UNSIGNED NOT NULL, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 FOREIGN KEY(agent_id) REFERENCES ai_agents(id), FOREIGN KEY(created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE ai_agent_eval_batches (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, suite_id BIGINT UNSIGNED NOT NULL, suite_revision INT UNSIGNED NOT NULL,
 agent_id BIGINT UNSIGNED NOT NULL, user_id BIGINT UNSIGNED NOT NULL, api_token_id BIGINT UNSIGNED NULL,
 name VARCHAR(160) NOT NULL, status ENUM('running','completed','cancelled') NOT NULL DEFAULT 'running',
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, completed_at DATETIME NULL,
 FOREIGN KEY(suite_id) REFERENCES ai_agent_eval_suites(id), FOREIGN KEY(agent_id) REFERENCES ai_agents(id), FOREIGN KEY(user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE ai_agent_eval_items (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, batch_id BIGINT UNSIGNED NOT NULL, case_key VARCHAR(40) NOT NULL,
 variant VARCHAR(160) NOT NULL, config_json JSON NOT NULL, case_json JSON NOT NULL,
 context_encrypted MEDIUMTEXT NOT NULL, source_refs_json JSON NOT NULL,
 status ENUM('pending','queueing','running','completed','failed','cancelled') NOT NULL DEFAULT 'pending',
 run_id BIGINT UNSIGNED NULL, score_json JSON NULL, error_text VARCHAR(1000) NULL,
 KEY(batch_id,status), UNIQUE KEY(run_id), FOREIGN KEY(batch_id) REFERENCES ai_agent_eval_batches(id), FOREIGN KEY(run_id) REFERENCES ai_agent_runs(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
