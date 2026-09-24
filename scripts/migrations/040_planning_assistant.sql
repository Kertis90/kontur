-- Предложения модели сохраняются отдельно от задач; повторное применение не дублирует состав.
CREATE TABLE work_plan_suggestions (
 id CHAR(36) PRIMARY KEY, plan_id BIGINT UNSIGNED NOT NULL, user_id BIGINT UNSIGNED NOT NULL,
 fingerprint CHAR(64) NOT NULL, content_hash CHAR(64) NOT NULL,
 status ENUM('running','ready','failed','applied') NOT NULL DEFAULT 'running',
 proposals_json JSON NULL, applied_json JSON NULL, selection_hash CHAR(64) NULL,
 error_text VARCHAR(1000) NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(plan_id) REFERENCES work_plans(id), FOREIGN KEY(user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
