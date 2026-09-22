ALTER TABLE conferences
  ADD COLUMN conference_mode ENUM('interactive','webinar') NOT NULL DEFAULT 'interactive' AFTER status,
  ADD COLUMN capacity SMALLINT UNSIGNED NOT NULL DEFAULT 150 AFTER conference_mode,
  ADD COLUMN max_publishers SMALLINT UNSIGNED NOT NULL DEFAULT 25 AFTER capacity,
  ADD COLUMN media_room_ready_at TIMESTAMP NULL AFTER max_publishers;

CREATE INDEX ix_conference_workspace_time ON conferences (workspace_id, scheduled_start);
