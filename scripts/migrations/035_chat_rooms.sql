CREATE TABLE chat_rooms (
  channel_id BIGINT UNSIGNED NOT NULL,
  join_policy ENUM('workspace','project','invite') NOT NULL DEFAULT 'workspace',
  description VARCHAR(2000) NOT NULL DEFAULT '',
  archived BOOLEAN NOT NULL DEFAULT FALSE,
  revision INT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (channel_id),
  CONSTRAINT fk_chat_rooms_channel FOREIGN KEY (channel_id) REFERENCES chat_channels(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE chat_room_invites (
  channel_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  invited_by BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (channel_id,user_id),
  CONSTRAINT fk_chat_room_invites_room FOREIGN KEY (channel_id) REFERENCES chat_rooms(channel_id) ON DELETE CASCADE,
  CONSTRAINT fk_chat_room_invites_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_chat_room_invites_author FOREIGN KEY (invited_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
