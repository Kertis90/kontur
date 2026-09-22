ALTER TABLE conferences ADD COLUMN captions_enabled BOOLEAN NOT NULL DEFAULT FALSE, ADD COLUMN caption_sequence BIGINT UNSIGNED NOT NULL DEFAULT 0;
CREATE TABLE conference_captions (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 conference_id BIGINT UNSIGNED NOT NULL, workspace_id BIGINT UNSIGNED NOT NULL, user_id BIGINT UNSIGNED NOT NULL,
 client_id CHAR(36) NOT NULL, payload_hash CHAR(64) NOT NULL,
 status ENUM('processing','completed','failed') NOT NULL DEFAULT 'processing',
 reserved_seconds INT UNSIGNED NOT NULL DEFAULT 12, duration_seconds DECIMAL(7,3) NULL,
 sequence_number BIGINT UNSIGNED NULL, text TEXT NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), completed_at DATETIME(3) NULL,
 UNIQUE KEY(conference_id,user_id,client_id), UNIQUE KEY(conference_id,sequence_number), KEY(workspace_id,created_at), KEY(user_id,created_at), KEY(conference_id,status,id),
 FOREIGN KEY(conference_id) REFERENCES conferences(id) ON DELETE CASCADE,
 FOREIGN KEY(workspace_id) REFERENCES workspaces(id), FOREIGN KEY(user_id) REFERENCES users(id)
);
