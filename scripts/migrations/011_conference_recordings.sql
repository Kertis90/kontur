CREATE TABLE conference_recordings (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  workspace_id BIGINT UNSIGNED NOT NULL,
  conference_id BIGINT UNSIGNED NOT NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  request_id CHAR(36) NOT NULL,
  object_key VARCHAR(700) NOT NULL,
  egress_id VARCHAR(100) NULL,
  status ENUM('starting','recording','stopping','completed','failed') NOT NULL DEFAULT 'starting',
  -- Generate the slot from status only: MySQL forbids cascades on a stored generated column's base FK.
  active_slot TINYINT GENERATED ALWAYS AS (CASE WHEN status IN ('starting','recording','stopping') THEN 1 ELSE NULL END) STORED,
  stop_requested BOOLEAN NOT NULL DEFAULT FALSE,
  error_text VARCHAR(1000) NULL,
  bytes BIGINT UNSIGNED NULL,
  duration_seconds INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMP NULL,
  completed_at TIMESTAMP NULL,
  transcript_status ENUM('none','queued','running','completed','failed') NOT NULL DEFAULT 'none',
  transcript_requested_by BIGINT UNSIGNED NULL,
  transcript_api_token_id BIGINT UNSIGNED NULL,
  transcript_revision CHAR(64) NULL,
  transcript_profile_revision CHAR(64) NULL,
  transcript_error VARCHAR(1000) NULL,
  transcript_chunks INT UNSIGNED NOT NULL DEFAULT 0,
  transcript_completed_chunks INT UNSIGNED NOT NULL DEFAULT 0,
  transcript_heartbeat_at TIMESTAMP NULL,
  transcript_completed_at TIMESTAMP NULL,
  UNIQUE KEY one_active_recording (conference_id, active_slot),
  UNIQUE KEY request_once (workspace_id, request_id),
  UNIQUE KEY unique_egress (egress_id),
  KEY recording_history (conference_id, id),
  KEY transcription_queue (transcript_status, id),
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  FOREIGN KEY (conference_id) REFERENCES conferences(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id),
  FOREIGN KEY (transcript_requested_by) REFERENCES users(id)
);

CREATE TABLE conference_recording_transcripts (
  recording_id BIGINT UNSIGNED NOT NULL,
  chunk_index INT UNSIGNED NOT NULL,
  start_seconds INT UNSIGNED NOT NULL,
  text MEDIUMTEXT NOT NULL,
  profile_revision CHAR(64) NOT NULL,
  PRIMARY KEY (recording_id, chunk_index),
  FOREIGN KEY (recording_id) REFERENCES conference_recordings(id) ON DELETE CASCADE
);

ALTER TABLE ai_jobs ADD COLUMN recording_id BIGINT UNSIGNED NULL,
  ADD COLUMN requested_api_token_id BIGINT UNSIGNED NULL,
  ADD COLUMN heartbeat_at TIMESTAMP NULL,
  ADD FOREIGN KEY (recording_id) REFERENCES conference_recordings(id) ON DELETE CASCADE;
