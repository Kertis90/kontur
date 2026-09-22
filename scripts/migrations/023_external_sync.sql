CREATE TABLE external_connections (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, workspace_id BIGINT UNSIGNED NOT NULL,
 user_id BIGINT UNSIGNED NOT NULL, project_id BIGINT UNSIGNED NULL,
 kind ENUM('caldav','gitlab') NOT NULL, name VARCHAR(160) NOT NULL,
 credentials_encrypted TEXT NOT NULL, config_json JSON NOT NULL,
 enabled BOOLEAN NOT NULL DEFAULT FALSE, revision INT UNSIGNED NOT NULL DEFAULT 1,
 next_sync_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, synced_at DATETIME NULL,
 error_code VARCHAR(80) NULL, lease_token CHAR(36) NULL, lease_until DATETIME NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 KEY(enabled,next_sync_at), KEY(workspace_id,user_id),
 FOREIGN KEY(workspace_id) REFERENCES workspaces(id), FOREIGN KEY(user_id) REFERENCES users(id),
 FOREIGN KEY(project_id) REFERENCES projects(id)
);
CREATE TABLE external_bindings (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, connection_id BIGINT UNSIGNED NOT NULL,
 entity_id BIGINT UNSIGNED NOT NULL, external_key VARCHAR(100) NOT NULL,
 baseline_encrypted MEDIUMTEXT NULL, conflict_encrypted MEDIUMTEXT NULL,
 status ENUM('pending','synced','conflict','failed') NOT NULL DEFAULT 'pending',
 resolution ENUM('local','remote') NULL, resolution_hash CHAR(64) NULL,
 error_code VARCHAR(80) NULL, synced_at DATETIME NULL, checked_at DATETIME NULL,
 revision INT UNSIGNED NOT NULL DEFAULT 1,
 UNIQUE KEY(connection_id,entity_id), UNIQUE KEY(connection_id,external_key),
 FOREIGN KEY(connection_id) REFERENCES external_connections(id) ON DELETE CASCADE
);
CREATE TABLE external_sync_log (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, connection_id BIGINT UNSIGNED NOT NULL,
 binding_id BIGINT UNSIGNED NULL, action VARCHAR(80) NOT NULL, error_code VARCHAR(80) NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 KEY(connection_id,created_at), FOREIGN KEY(connection_id) REFERENCES external_connections(id) ON DELETE CASCADE
);
