CREATE TABLE business_calendars (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, workspace_id BIGINT UNSIGNED NOT NULL,
 name VARCHAR(180) NOT NULL, timezone VARCHAR(100) NOT NULL DEFAULT 'UTC', weekly_json JSON NOT NULL,
 holidays_json JSON NOT NULL, revision INT UNSIGNED NOT NULL DEFAULT 1, created_by BIGINT UNSIGNED NOT NULL,
 FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE, FOREIGN KEY(created_by) REFERENCES users(id)
);
ALTER TABLE task_sla_policies ADD COLUMN counter_key VARCHAR(80) NOT NULL DEFAULT 'completion',
 ADD COLUMN calendar_id BIGINT UNSIGNED NULL, ADD COLUMN config_json JSON NULL,
 ADD COLUMN revision INT UNSIGNED NOT NULL DEFAULT 1,
 ADD CONSTRAINT fk_sla_calendar FOREIGN KEY(calendar_id) REFERENCES business_calendars(id);
ALTER TABLE tasks ADD COLUMN completed_at DATETIME(6) NULL;
UPDATE tasks t JOIN workflow_stages s ON s.id=t.stage_id SET t.completed_at=t.updated_at WHERE s.is_done=TRUE;
CREATE TABLE task_state_events (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, task_id BIGINT UNSIGNED NOT NULL,
 stage_id BIGINT UNSIGNED NOT NULL, is_done BOOLEAN NOT NULL, occurred_at DATETIME(6) NOT NULL,
 source ENUM('recorded','baseline','workflow') NOT NULL DEFAULT 'recorded',
 KEY(task_id,occurred_at,id), FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
);
INSERT INTO task_state_events(task_id,stage_id,is_done,occurred_at,source)
 SELECT t.id,t.stage_id,s.is_done,IF(s.is_done,t.updated_at,t.created_at),'baseline' FROM tasks t JOIN workflow_stages s ON s.id=t.stage_id;
CREATE TRIGGER task_state_insert AFTER INSERT ON tasks FOR EACH ROW
 INSERT INTO task_state_events(task_id,stage_id,is_done,occurred_at) SELECT NEW.id,NEW.stage_id,is_done,NEW.created_at FROM workflow_stages WHERE id=NEW.stage_id;
CREATE TRIGGER task_state_update AFTER UPDATE ON tasks FOR EACH ROW
 INSERT INTO task_state_events(task_id,stage_id,is_done,occurred_at) SELECT NEW.id,NEW.stage_id,is_done,CURRENT_TIMESTAMP(6) FROM workflow_stages WHERE id=NEW.stage_id AND NEW.stage_id<>OLD.stage_id;
CREATE TRIGGER task_completion_update BEFORE UPDATE ON tasks FOR EACH ROW
 SET NEW.completed_at=IF(NEW.stage_id=OLD.stage_id,OLD.completed_at,IF((SELECT is_done FROM workflow_stages WHERE id=NEW.stage_id),CURRENT_TIMESTAMP(6),NULL));
CREATE TRIGGER workflow_completion_update AFTER UPDATE ON workflow_stages FOR EACH ROW
 INSERT INTO task_state_events(task_id,stage_id,is_done,occurred_at,source) SELECT id,NEW.id,NEW.is_done,CURRENT_TIMESTAMP(6),'workflow' FROM tasks WHERE stage_id=NEW.id AND NEW.is_done<>OLD.is_done;
CREATE TRIGGER task_completion_insert BEFORE INSERT ON tasks FOR EACH ROW
 SET NEW.completed_at=IF((SELECT is_done FROM workflow_stages WHERE id=NEW.stage_id),COALESCE(NEW.created_at,CURRENT_TIMESTAMP(6)),NULL);
