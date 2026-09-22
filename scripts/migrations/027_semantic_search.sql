CREATE TABLE semantic_settings (
 workspace_id BIGINT UNSIGNED PRIMARY KEY, enabled BOOLEAN NOT NULL DEFAULT FALSE,
 profile_id CHAR(36) NULL, model VARCHAR(200) NOT NULL DEFAULT '', revision INT UNSIGNED NOT NULL DEFAULT 1,
 FOREIGN KEY(workspace_id) REFERENCES workspaces(id)
);
CREATE TABLE semantic_documents (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, workspace_id BIGINT UNSIGNED NOT NULL,
 namespace CHAR(64) NOT NULL, kind ENUM('task','knowledge','recording') NOT NULL,
 source_id BIGINT UNSIGNED NOT NULL, chunk_index INT UNSIGNED NOT NULL,
 content_hash CHAR(64) NOT NULL, chunk_start INT UNSIGNED NOT NULL, chunk_length INT UNSIGNED NOT NULL,
 vector_encrypted MEDIUMTEXT NOT NULL, indexed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY(workspace_id,namespace,kind,source_id,chunk_index),
 FOREIGN KEY(workspace_id) REFERENCES workspaces(id)
);
CREATE TABLE semantic_buckets (
 document_id BIGINT UNSIGNED NOT NULL, workspace_id BIGINT UNSIGNED NOT NULL,
 namespace CHAR(64) NOT NULL, band TINYINT UNSIGNED NOT NULL, bucket TINYINT UNSIGNED NOT NULL,
 PRIMARY KEY(document_id,band), KEY(workspace_id,namespace,band,bucket),
 FOREIGN KEY(document_id) REFERENCES semantic_documents(id) ON DELETE CASCADE
);
CREATE TABLE semantic_jobs (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, workspace_id BIGINT UNSIGNED NOT NULL,
 user_id BIGINT UNSIGNED NOT NULL, api_token_id BIGINT UNSIGNED NULL, namespace CHAR(64) NOT NULL,
 status ENUM('queued','running','completed','failed','cancelled') NOT NULL DEFAULT 'queued',
 kind_index TINYINT UNSIGNED NOT NULL DEFAULT 0, cursor_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
 indexed_count INT UNSIGNED NOT NULL DEFAULT 0, skipped_count INT UNSIGNED NOT NULL DEFAULT 0,
 lease_token CHAR(36) NULL, lease_until DATETIME NULL, error_code VARCHAR(80) NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 KEY(status,lease_until), KEY(workspace_id,id),
 FOREIGN KEY(workspace_id) REFERENCES workspaces(id), FOREIGN KEY(user_id) REFERENCES users(id)
);
