ALTER TABLE chat_channel_members ADD COLUMN last_read_message_id BIGINT UNSIGNED NOT NULL DEFAULT 0;
UPDATE chat_channel_members member SET last_read_message_id=COALESCE((SELECT MAX(message.id) FROM chat_messages message WHERE message.channel_id=member.channel_id AND message.created_at<=member.last_read_at),0);
CREATE TABLE browser_push_subscriptions (
 id CHAR(64) NOT NULL PRIMARY KEY,
 user_id BIGINT UNSIGNED NOT NULL, workspace_id BIGINT UNSIGNED NOT NULL,
 session_id CHAR(36) NOT NULL, subscription_encrypted TEXT NOT NULL,
 last_notification_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
 last_chat_message_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
 next_attempt_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 lease_token CHAR(36) NULL, lease_until DATETIME NULL,
 failures INT UNSIGNED NOT NULL DEFAULT 0,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 KEY(next_attempt_at), KEY(user_id),
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
 FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
 FOREIGN KEY(session_id) REFERENCES user_sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB;
