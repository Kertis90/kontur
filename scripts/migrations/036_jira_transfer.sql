-- Сохраняет подключения и этапы поэтапного переезда без изменения прежнего импорта файлов.
CREATE TABLE jira_transfer_sources (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 workspace_id BIGINT UNSIGNED NOT NULL, project_id BIGINT UNSIGNED NOT NULL,
 user_id BIGINT UNSIGNED NOT NULL, name VARCHAR(160) NOT NULL,
 kind ENUM('data_center','cloud') NOT NULL DEFAULT 'data_center',
 url VARCHAR(1000) NOT NULL, project_key VARCHAR(50) NOT NULL,
 credentials_encrypted TEXT NOT NULL, mapping_json JSON NOT NULL, catalog_json JSON NULL,
 include_files BOOLEAN NOT NULL DEFAULT TRUE,
 status ENUM('draft','preparing','preview','running','paused','completed','cutover','failed') NOT NULL DEFAULT 'draft',
 phase ENUM('listing','details','tasks','links','finished') NOT NULL DEFAULT 'listing',
 cursor_value TEXT NULL, run_number INT UNSIGNED NOT NULL DEFAULT 0,
 revision INT UNSIGNED NOT NULL DEFAULT 1, lease_token CHAR(36) NULL, lease_until DATETIME NULL,
 available_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, attempts INT UNSIGNED NOT NULL DEFAULT 0,
 error_code VARCHAR(100) NULL, prepared_at DATETIME NULL, completed_at DATETIME NULL, cutover_at DATETIME NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 KEY(workspace_id,project_id), KEY(status,available_at,lease_until),
 FOREIGN KEY(workspace_id) REFERENCES workspaces(id),
 FOREIGN KEY(project_id) REFERENCES projects(id), FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Хранит исходный снимок, соответствие задачи и решения конфликтов между повторными переносами.
CREATE TABLE jira_transfer_items (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, source_id BIGINT UNSIGNED NOT NULL,
 issue_id VARCHAR(100) COLLATE utf8mb4_bin NOT NULL, issue_key VARCHAR(255) NOT NULL,
 task_id BIGINT UNSIGNED NULL, seen_run INT UNSIGNED NOT NULL,
 payload_encrypted MEDIUMTEXT NULL, baseline_encrypted MEDIUMTEXT NULL,
 status ENUM('fetch','pending','done','conflict','error','excluded') NOT NULL DEFAULT 'fetch',
 warnings_json JSON NOT NULL, error_code VARCHAR(100) NULL,
 choice ENUM('local','jira') NULL, choice_version INT UNSIGNED NULL,
 files_expected INT UNSIGNED NOT NULL DEFAULT 0, files_done INT UNSIGNED NOT NULL DEFAULT 0,
 links_pending INT UNSIGNED NOT NULL DEFAULT 0,
 updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 UNIQUE KEY(source_id,issue_id), KEY(source_id,status,id), KEY(task_id),
 FOREIGN KEY(source_id) REFERENCES jira_transfer_sources(id) ON DELETE CASCADE,
 FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE SET NULL
);

-- Исключает повторное прикрепление одного файла при перезапуске обработчика.
CREATE TABLE jira_transfer_files (
 item_id BIGINT UNSIGNED NOT NULL, file_id VARCHAR(100) COLLATE utf8mb4_bin NOT NULL,
 attachment_id BIGINT UNSIGNED NOT NULL, checksum_sha256 CHAR(64) NOT NULL,
 PRIMARY KEY(item_id,file_id),
 FOREIGN KEY(item_id) REFERENCES jira_transfer_items(id) ON DELETE CASCADE,
 FOREIGN KEY(attachment_id) REFERENCES task_attachments(id) ON DELETE CASCADE
);
