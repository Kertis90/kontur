CREATE TABLE integration_connections (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 workspace_id BIGINT UNSIGNED NOT NULL, project_id BIGINT UNSIGNED NOT NULL,
 provider ENUM('telegram','mattermost','slack','webhook') NOT NULL,
 name VARCHAR(160) NOT NULL, destination_label VARCHAR(255) NOT NULL,
 config_json JSON NOT NULL, credentials_encrypted TEXT NOT NULL, event_types_json JSON NOT NULL,
 enabled BOOLEAN NOT NULL DEFAULT FALSE, version_number INT UNSIGNED NOT NULL DEFAULT 1,
 created_by BIGINT UNSIGNED NOT NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 KEY(workspace_id,project_id),
 FOREIGN KEY(workspace_id) REFERENCES workspaces(id),
 FOREIGN KEY(project_id) REFERENCES projects(id), FOREIGN KEY(created_by) REFERENCES users(id)
);
CREATE TABLE integration_deliveries (
 id CHAR(36) NOT NULL PRIMARY KEY, connection_id BIGINT UNSIGNED NOT NULL,
 event_uuid CHAR(36) NOT NULL, event_type VARCHAR(120) NOT NULL,
 task_id BIGINT UNSIGNED NULL, requested_by BIGINT UNSIGNED NULL, payload_encrypted TEXT NULL,
 connection_version INT UNSIGNED NOT NULL,
 status ENUM('pending','running','delivered','failed','cancelled') NOT NULL DEFAULT 'pending',
 attempts INT UNSIGNED NOT NULL DEFAULT 0, available_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 lease_token CHAR(36) NULL, lease_until DATETIME NULL,
 http_status INT NULL, error_code VARCHAR(80) NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, completed_at DATETIME NULL,
 UNIQUE KEY(connection_id,event_uuid), KEY(status,available_at), KEY(connection_id,created_at),
 FOREIGN KEY(connection_id) REFERENCES integration_connections(id) ON DELETE CASCADE
);
