-- Проекты-черновики и инициативы отделены от рабочих задач собственными правами.
CREATE TABLE work_plans (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 workspace_id BIGINT UNSIGNED NOT NULL,
 project_id BIGINT UNSIGNED NULL,
 title VARCHAR(180) NOT NULL, description TEXT NOT NULL,
 start_date DATE NULL, due_date DATE NULL, objective_id BIGINT UNSIGNED NULL,
 archived BOOLEAN NOT NULL DEFAULT FALSE, revision INT UNSIGNED NOT NULL DEFAULT 1,
 created_by BIGINT UNSIGNED NOT NULL, request_id CHAR(36) NOT NULL, creation_hash CHAR(64) NOT NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 UNIQUE KEY(workspace_id,created_by,request_id), KEY(workspace_id,project_id,archived),
 FOREIGN KEY(workspace_id) REFERENCES workspaces(id), FOREIGN KEY(project_id) REFERENCES projects(id),
 FOREIGN KEY(objective_id) REFERENCES work_objectives(id) ON DELETE SET NULL,
 FOREIGN KEY(created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE work_plan_members (
 plan_id BIGINT UNSIGNED NOT NULL, user_id BIGINT UNSIGNED NOT NULL, can_edit BOOLEAN NOT NULL DEFAULT FALSE,
 PRIMARY KEY(plan_id,user_id), FOREIGN KEY(plan_id) REFERENCES work_plans(id) ON DELETE CASCADE,
 FOREIGN KEY(user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE work_plan_items (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, plan_id BIGINT UNSIGNED NOT NULL,
 parent_id BIGINT UNSIGNED NULL, kind ENUM('epic','task') NOT NULL,
 title VARCHAR(300) NOT NULL, description TEXT NOT NULL,
 priority ENUM('critical','high','medium','low') NOT NULL DEFAULT 'medium',
 assignee_id BIGINT UNSIGNED NULL, start_date DATE NULL, due_date DATE NULL,
 estimate_minutes INT UNSIGNED NULL, story_points DECIMAL(10,2) NULL,
 objective_id BIGINT UNSIGNED NULL, state ENUM('planning','active','cancelled') NOT NULL DEFAULT 'planning',
 task_id BIGINT UNSIGNED NULL, revision INT UNSIGNED NOT NULL DEFAULT 1,
 created_by BIGINT UNSIGNED NOT NULL, request_id CHAR(36) NOT NULL, creation_hash CHAR(64) NOT NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 UNIQUE KEY(plan_id,created_by,request_id), UNIQUE KEY(task_id), KEY(plan_id,state,parent_id),
 FOREIGN KEY(plan_id) REFERENCES work_plans(id), FOREIGN KEY(parent_id) REFERENCES work_plan_items(id),
 FOREIGN KEY(assignee_id) REFERENCES users(id), FOREIGN KEY(objective_id) REFERENCES work_objectives(id) ON DELETE SET NULL,
 FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE SET NULL, FOREIGN KEY(created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
