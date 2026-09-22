CREATE TABLE user_sessions (
 id CHAR(36) PRIMARY KEY, user_id BIGINT UNSIGNED NOT NULL, user_agent VARCHAR(400) NOT NULL DEFAULT '',
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 expires_at DATETIME NOT NULL, revoked_at DATETIME NULL, mfa_verified BOOLEAN NOT NULL DEFAULT FALSE,
 KEY(user_id,expires_at), FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE user_mfa (
 user_id BIGINT UNSIGNED PRIMARY KEY, secret_encrypted TEXT NULL, pending_secret_encrypted TEXT NULL,
 pending_expires_at DATETIME NULL, enabled BOOLEAN NOT NULL DEFAULT FALSE, last_counter BIGINT NULL,
 recovery_hashes_json JSON NULL, changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE auth_challenges (
 token_hash CHAR(64) PRIMARY KEY, user_id BIGINT UNSIGNED NOT NULL, expires_at DATETIME NOT NULL,
 used_at DATETIME NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE, KEY(expires_at)
);
CREATE TABLE security_rate_limits (
 bucket_hash CHAR(64) PRIMARY KEY, window_start BIGINT UNSIGNED NOT NULL, attempts INT UNSIGNED NOT NULL DEFAULT 0,
 updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
CREATE TABLE directory_sync_configs (
 workspace_id BIGINT UNSIGNED PRIMARY KEY, enabled BOOLEAN NOT NULL DEFAULT FALSE, config_json JSON NOT NULL,
 last_sync_at DATETIME NULL, last_result_json JSON NULL, last_error VARCHAR(500) NULL,
 FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);
CREATE TRIGGER user_revoke_sessions AFTER UPDATE ON users FOR EACH ROW
 UPDATE user_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE user_id=NEW.id AND revoked_at IS NULL AND
 (NEW.status<>'active' OR NOT(NEW.password_hash<=>OLD.password_hash) OR NEW.auth_source<>OLD.auth_source);
CREATE TRIGGER user_revoke_api_tokens AFTER UPDATE ON users FOR EACH ROW
 UPDATE api_tokens SET revoked_at=CURRENT_TIMESTAMP WHERE user_id=NEW.id AND revoked_at IS NULL AND
 (NEW.status<>'active' OR NOT(NEW.password_hash<=>OLD.password_hash) OR NEW.auth_source<>OLD.auth_source);
ALTER TABLE users ADD COLUMN external_issuer VARCHAR(600) NULL,
 ADD COLUMN directory_disabled BOOLEAN NOT NULL DEFAULT FALSE;
