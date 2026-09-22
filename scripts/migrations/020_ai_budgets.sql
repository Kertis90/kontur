CREATE TABLE ai_usage_ledger (
 id CHAR(36) PRIMARY KEY, workspace_id BIGINT UNSIGNED NOT NULL, user_id BIGINT UNSIGNED NOT NULL,
 purpose VARCHAR(64) NOT NULL, profile_id CHAR(36) NOT NULL, model VARCHAR(200) NOT NULL,
 status ENUM('reserved','completed','uncertain') NOT NULL DEFAULT 'reserved',
 reserved_tokens BIGINT UNSIGNED NOT NULL, charged_tokens BIGINT UNSIGNED NOT NULL,
 input_tokens BIGINT UNSIGNED NULL, output_tokens BIGINT UNSIGNED NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, completed_at DATETIME NULL,
 KEY(workspace_id,created_at), KEY(user_id,created_at),
 FOREIGN KEY(workspace_id) REFERENCES workspaces(id), FOREIGN KEY(user_id) REFERENCES users(id)
);
