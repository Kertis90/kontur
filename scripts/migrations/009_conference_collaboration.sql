ALTER TABLE conference_participants
  ADD COLUMN hand_raised_at TIMESTAMP NULL AFTER response,
  ADD COLUMN last_joined_at TIMESTAMP NULL AFTER hand_raised_at;

CREATE INDEX ix_conference_participant_hand
  ON conference_participants (conference_id, hand_raised_at);

CREATE TABLE IF NOT EXISTS conference_messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  conference_id BIGINT UNSIGNED NOT NULL,
  sender_id BIGINT UNSIGNED NOT NULL,
  message_type ENUM('message','question') NOT NULL DEFAULT 'message',
  body VARCHAR(4000) NOT NULL,
  client_id CHAR(36) NOT NULL,
  revision INT UNSIGNED NOT NULL DEFAULT 1,
  question_status ENUM('open','answered','dismissed') NULL,
  moderated_by BIGINT UNSIGNED NULL,
  moderated_at TIMESTAMP NULL,
  edited_at TIMESTAMP NULL,
  deleted_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_conference_message_client (conference_id, sender_id, client_id),
  KEY ix_conference_messages_history (conference_id, id),
  KEY ix_conference_messages_questions (conference_id, message_type, question_status, id),
  CONSTRAINT fk_conference_message_conference FOREIGN KEY (conference_id) REFERENCES conferences(id) ON DELETE CASCADE,
  CONSTRAINT fk_conference_message_sender FOREIGN KEY (sender_id) REFERENCES users(id),
  CONSTRAINT fk_conference_message_moderator FOREIGN KEY (moderated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
