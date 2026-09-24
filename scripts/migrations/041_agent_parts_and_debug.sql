-- Общие части сценария публикуются неизменяемыми версиями в границах проекта.
CREATE TABLE ai_agent_parts (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, workspace_id BIGINT UNSIGNED NOT NULL,
 project_id BIGINT UNSIGNED NOT NULL, name VARCHAR(160) NOT NULL, version INT UNSIGNED NOT NULL DEFAULT 1,
 FOREIGN KEY(workspace_id) REFERENCES workspaces(id), FOREIGN KEY(project_id) REFERENCES projects(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE ai_agent_part_versions (
 part_id BIGINT UNSIGNED NOT NULL, version INT UNSIGNED NOT NULL, name VARCHAR(160) NOT NULL,
 flow_json JSON NOT NULL, created_by BIGINT UNSIGNED NOT NULL, request_id CHAR(36) NOT NULL,
 fingerprint CHAR(64) NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(part_id,version), UNIQUE KEY(request_id),
 FOREIGN KEY(part_id) REFERENCES ai_agent_parts(id), FOREIGN KEY(created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
-- Сохранённые входы защищены тем же ключом, что согласования и учётные данные.
CREATE TABLE ai_agent_debug_contexts (
 run_id BIGINT UNSIGNED PRIMARY KEY, context_encrypted MEDIUMTEXT NOT NULL,
 FOREIGN KEY(run_id) REFERENCES ai_agent_runs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
ALTER TABLE ai_agent_run_steps ADD COLUMN input_encrypted MEDIUMTEXT NULL,
 ADD COLUMN input_tokens INT UNSIGNED NULL, ADD COLUMN output_tokens INT UNSIGNED NULL;
