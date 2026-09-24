-- Повтор подтверждённого сценария возвращает результат без повторного изменения сроков.
CREATE TABLE work_roadmap_changes (
 id CHAR(36) PRIMARY KEY, workspace_id BIGINT UNSIGNED NOT NULL, user_id BIGINT UNSIGNED NOT NULL,
 fingerprint CHAR(64) NOT NULL, result_json JSON NOT NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(workspace_id) REFERENCES workspaces(id), FOREIGN KEY(user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
