CREATE TABLE quality_cases (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, project_id BIGINT UNSIGNED NOT NULL,
 title VARCHAR(300) NOT NULL, preconditions TEXT NOT NULL, steps_json JSON NOT NULL,
 automation_key VARCHAR(200) NULL, priority ENUM('critical','high','medium','low') NOT NULL DEFAULT 'medium',
 archived BOOLEAN NOT NULL DEFAULT FALSE, revision INT UNSIGNED NOT NULL DEFAULT 1,
 created_by BIGINT UNSIGNED NOT NULL, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 UNIQUE KEY(project_id,automation_key), FOREIGN KEY(project_id) REFERENCES projects(id), FOREIGN KEY(created_by) REFERENCES users(id)
);
CREATE TABLE quality_case_tasks (
 case_id BIGINT UNSIGNED NOT NULL, task_id BIGINT UNSIGNED NOT NULL, PRIMARY KEY(case_id,task_id),
 FOREIGN KEY(case_id) REFERENCES quality_cases(id) ON DELETE CASCADE, FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
);
CREATE TABLE quality_plans (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, project_id BIGINT UNSIGNED NOT NULL,
 release_id BIGINT UNSIGNED NULL, title VARCHAR(200) NOT NULL,
 revision INT UNSIGNED NOT NULL DEFAULT 1, created_by BIGINT UNSIGNED NOT NULL,
 FOREIGN KEY(project_id) REFERENCES projects(id), FOREIGN KEY(release_id) REFERENCES releases(id) ON DELETE SET NULL,
 FOREIGN KEY(created_by) REFERENCES users(id)
);
CREATE TABLE quality_plan_cases (
 plan_id BIGINT UNSIGNED NOT NULL, case_id BIGINT UNSIGNED NOT NULL, PRIMARY KEY(plan_id,case_id),
 FOREIGN KEY(plan_id) REFERENCES quality_plans(id) ON DELETE CASCADE, FOREIGN KEY(case_id) REFERENCES quality_cases(id)
);
CREATE TABLE quality_runs (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, plan_id BIGINT UNSIGNED NOT NULL,
 title VARCHAR(200) NOT NULL, release_id BIGINT UNSIGNED NULL, status ENUM('open','completed') NOT NULL DEFAULT 'open',
 created_by BIGINT UNSIGNED NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 completed_at DATETIME NULL, FOREIGN KEY(release_id) REFERENCES releases(id) ON DELETE SET NULL, FOREIGN KEY(plan_id) REFERENCES quality_plans(id), FOREIGN KEY(created_by) REFERENCES users(id)
);
CREATE TABLE quality_run_items (
 run_id BIGINT UNSIGNED NOT NULL, case_id BIGINT UNSIGNED NOT NULL, snapshot_json JSON NOT NULL,
 result ENUM('untested','passed','failed','blocked','skipped') NOT NULL DEFAULT 'untested',
 notes TEXT NULL, defect_task_id BIGINT UNSIGNED NULL, revision INT UNSIGNED NOT NULL DEFAULT 1,
 updated_by BIGINT UNSIGNED NULL, updated_at DATETIME NULL,
 PRIMARY KEY(run_id,case_id), FOREIGN KEY(run_id) REFERENCES quality_runs(id) ON DELETE CASCADE,
 FOREIGN KEY(case_id) REFERENCES quality_cases(id), FOREIGN KEY(defect_task_id) REFERENCES tasks(id) ON DELETE SET NULL
);
CREATE TABLE quality_result_batches (
 run_id BIGINT UNSIGNED NOT NULL, request_id CHAR(36) NOT NULL, fingerprint CHAR(64) NOT NULL,
 user_id BIGINT UNSIGNED NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(run_id,request_id), FOREIGN KEY(run_id) REFERENCES quality_runs(id) ON DELETE CASCADE
);
CREATE TABLE quality_result_history (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, run_id BIGINT UNSIGNED NOT NULL, case_id BIGINT UNSIGNED NOT NULL,
 result VARCHAR(20) NOT NULL, notes TEXT NULL, defect_task_id BIGINT UNSIGNED NULL, user_id BIGINT UNSIGNED NOT NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 KEY(run_id,case_id), FOREIGN KEY(run_id) REFERENCES quality_runs(id) ON DELETE CASCADE
);
