ALTER TABLE conferences ADD COLUMN waiting_room BOOLEAN NOT NULL DEFAULT FALSE;
CREATE TABLE conference_admissions (
 conference_id BIGINT UNSIGNED NOT NULL, user_id BIGINT UNSIGNED NOT NULL,
 status ENUM('waiting','admitted','denied') NOT NULL DEFAULT 'waiting', requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 decided_at DATETIME NULL, decided_by BIGINT UNSIGNED NULL,
 PRIMARY KEY(conference_id,user_id), FOREIGN KEY(conference_id) REFERENCES conferences(id) ON DELETE CASCADE,
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY(decided_by) REFERENCES users(id)
);
CREATE TABLE conference_polls (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, conference_id BIGINT UNSIGNED NOT NULL, question VARCHAR(500) NOT NULL,
 options_json JSON NOT NULL, results_visible BOOLEAN NOT NULL DEFAULT TRUE, closed BOOLEAN NOT NULL DEFAULT FALSE,
 revision INT UNSIGNED NOT NULL DEFAULT 1, created_by BIGINT UNSIGNED NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(conference_id) REFERENCES conferences(id) ON DELETE CASCADE, FOREIGN KEY(created_by) REFERENCES users(id)
);
CREATE TABLE conference_votes (
 poll_id BIGINT UNSIGNED NOT NULL, user_id BIGINT UNSIGNED NOT NULL, option_index INT UNSIGNED NOT NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(poll_id,user_id),
 FOREIGN KEY(poll_id) REFERENCES conference_polls(id) ON DELETE CASCADE, FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE conference_breakouts (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, conference_id BIGINT UNSIGNED NOT NULL, name VARCHAR(180) NOT NULL,
 room_key CHAR(36) NOT NULL UNIQUE, closed BOOLEAN NOT NULL DEFAULT FALSE, created_by BIGINT UNSIGNED NOT NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(conference_id) REFERENCES conferences(id) ON DELETE CASCADE,
 FOREIGN KEY(created_by) REFERENCES users(id)
);
CREATE TABLE conference_breakout_members (
 breakout_id BIGINT UNSIGNED NOT NULL, user_id BIGINT UNSIGNED NOT NULL, PRIMARY KEY(breakout_id,user_id),
 FOREIGN KEY(breakout_id) REFERENCES conference_breakouts(id) ON DELETE CASCADE, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE conference_media_events (
 event_id VARCHAR(128) PRIMARY KEY, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE conference_attendance (
 participant_sid VARCHAR(128) PRIMARY KEY, conference_id BIGINT UNSIGNED NOT NULL, user_id BIGINT UNSIGNED NOT NULL,
 room_key CHAR(36) NOT NULL, joined_at DATETIME NULL, left_at DATETIME NULL,
 FOREIGN KEY(conference_id) REFERENCES conferences(id) ON DELETE CASCADE, FOREIGN KEY(user_id) REFERENCES users(id),
 KEY(conference_id,user_id,joined_at)
);
