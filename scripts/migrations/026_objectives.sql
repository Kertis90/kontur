CREATE TABLE work_objectives (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, project_id BIGINT UNSIGNED NOT NULL,
 title VARCHAR(300) NOT NULL, description TEXT NOT NULL, owner_id BIGINT UNSIGNED NOT NULL,
 due_date DATE NOT NULL, archived BOOLEAN NOT NULL DEFAULT FALSE,
 revision INT UNSIGNED NOT NULL DEFAULT 1, created_by BIGINT UNSIGNED NOT NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(project_id) REFERENCES projects(id), FOREIGN KEY(owner_id) REFERENCES users(id)
);
CREATE TABLE objective_key_results (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, objective_id BIGINT UNSIGNED NOT NULL,
 title VARCHAR(300) NOT NULL, mode ENUM('manual','tasks') NOT NULL DEFAULT 'manual',
 unit VARCHAR(30) NOT NULL DEFAULT '%', start_value DECIMAL(18,4) NOT NULL,
 target_value DECIMAL(18,4) NOT NULL, current_value DECIMAL(18,4) NOT NULL,
 weight DECIMAL(8,2) NOT NULL DEFAULT 1, confidence ENUM('on_track','at_risk','off_track') NOT NULL DEFAULT 'on_track',
 revision INT UNSIGNED NOT NULL DEFAULT 1,
 FOREIGN KEY(objective_id) REFERENCES work_objectives(id) ON DELETE CASCADE
);
CREATE TABLE objective_task_links (
 key_result_id BIGINT UNSIGNED NOT NULL, task_id BIGINT UNSIGNED NOT NULL,
 PRIMARY KEY(key_result_id,task_id), FOREIGN KEY(key_result_id) REFERENCES objective_key_results(id) ON DELETE CASCADE,
 FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
);
CREATE TABLE objective_checkins (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, key_result_id BIGINT UNSIGNED NOT NULL,
 value DECIMAL(18,4) NOT NULL, confidence VARCHAR(20) NOT NULL, note TEXT NOT NULL,
 user_id BIGINT UNSIGNED NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 KEY(key_result_id,created_at), FOREIGN KEY(key_result_id) REFERENCES objective_key_results(id) ON DELETE CASCADE
);
