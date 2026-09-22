CREATE TABLE jira_import_jobs (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, workspace_id BIGINT UNSIGNED NOT NULL,
 project_id BIGINT UNSIGNED NOT NULL, user_id BIGINT UNSIGNED NOT NULL, api_token_id BIGINT UNSIGNED NULL,
 status ENUM('preview','queued','running','completed','failed','cancelled') NOT NULL DEFAULT 'preview',
 phase ENUM('tasks','links') NOT NULL DEFAULT 'tasks', cursor_row INT UNSIGNED NOT NULL DEFAULT 0,
 total INT UNSIGNED NOT NULL, preview_hash CHAR(64) NOT NULL, include_attachments BOOLEAN NOT NULL,
 revision INT UNSIGNED NOT NULL DEFAULT 1, lease_token CHAR(36) NULL, lease_until DATETIME NULL,
 error_code VARCHAR(100) NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 KEY(status,lease_until), KEY(workspace_id,user_id),
 FOREIGN KEY(workspace_id) REFERENCES workspaces(id), FOREIGN KEY(project_id) REFERENCES projects(id), FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE jira_import_records (
 job_id BIGINT UNSIGNED NOT NULL, row_index INT UNSIGNED NOT NULL, external_key VARCHAR(255) NOT NULL,
 payload_encrypted MEDIUMTEXT NOT NULL, task_id BIGINT UNSIGNED NULL,
 status ENUM('pending','created','skipped') NOT NULL DEFAULT 'pending', warnings_json JSON NOT NULL,
 links_complete BOOLEAN NOT NULL DEFAULT FALSE, PRIMARY KEY(job_id,row_index),
 FOREIGN KEY(job_id) REFERENCES jira_import_jobs(id) ON DELETE CASCADE,
 FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE SET NULL
);
CREATE TABLE jira_import_files (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, job_id BIGINT UNSIGNED NOT NULL,
 row_index INT UNSIGNED NOT NULL, external_id VARCHAR(100) NOT NULL, file_name VARCHAR(500) NOT NULL,
 expected_size BIGINT UNSIGNED NOT NULL, mime_type VARCHAR(200) NOT NULL,
 object_key VARCHAR(700) NULL, checksum_sha256 CHAR(64) NULL, attached BOOLEAN NOT NULL DEFAULT FALSE,
 UNIQUE KEY(job_id,row_index,external_id), FOREIGN KEY(job_id,row_index) REFERENCES jira_import_records(job_id,row_index) ON DELETE CASCADE
);
CREATE TABLE jira_task_history (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, task_id BIGINT UNSIGNED NOT NULL,
 source_key VARCHAR(255) NOT NULL, entry_key CHAR(64) NOT NULL, kind ENUM('comment','change') NOT NULL,
 source_author VARCHAR(300) NOT NULL, source_date VARCHAR(60) NOT NULL, body_text MEDIUMTEXT NOT NULL,
 UNIQUE KEY(task_id,entry_key), FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
);
