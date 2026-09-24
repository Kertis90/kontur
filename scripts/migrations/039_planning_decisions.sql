-- Оценка пользы и отдельная версия связей сохраняют контракт обычного редактора плана.
CREATE TABLE work_plan_strategy (
 plan_id BIGINT UNSIGNED PRIMARY KEY, revision INT UNSIGNED NOT NULL DEFAULT 1,
 outcome TEXT NOT NULL, impact TINYINT UNSIGNED NOT NULL DEFAULT 0,
 effort DECIMAL(10,2) NOT NULL DEFAULT 0, rationale TEXT NOT NULL,
 FOREIGN KEY(plan_id) REFERENCES work_plans(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE work_plan_dependencies (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, plan_id BIGINT UNSIGNED NOT NULL,
 item_id BIGINT UNSIGNED NOT NULL, depends_on_item_id BIGINT UNSIGNED NULL,
 depends_on_task_id BIGINT UNSIGNED NULL,
 UNIQUE KEY(item_id,depends_on_item_id), UNIQUE KEY(item_id,depends_on_task_id), KEY(plan_id),
 CHECK ((depends_on_item_id IS NULL) <> (depends_on_task_id IS NULL)),
 FOREIGN KEY(plan_id) REFERENCES work_plans(id), FOREIGN KEY(item_id) REFERENCES work_plan_items(id),
 FOREIGN KEY(depends_on_item_id) REFERENCES work_plan_items(id), FOREIGN KEY(depends_on_task_id) REFERENCES tasks(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE work_plan_reviews (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, plan_id BIGINT UNSIGNED NOT NULL,
 content_hash CHAR(64) NOT NULL, requested_by BIGINT UNSIGNED NOT NULL,
 request_id CHAR(36) NOT NULL, reason TEXT NOT NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY(plan_id,requested_by,request_id),
 FOREIGN KEY(plan_id) REFERENCES work_plans(id), FOREIGN KEY(requested_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE work_plan_reviewers (
 review_id BIGINT UNSIGNED NOT NULL, user_id BIGINT UNSIGNED NOT NULL,
 decision ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending', comment TEXT NULL,
 decided_at DATETIME NULL, PRIMARY KEY(review_id,user_id),
 FOREIGN KEY(review_id) REFERENCES work_plan_reviews(id), FOREIGN KEY(user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
