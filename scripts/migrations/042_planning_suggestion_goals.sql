-- Историческое предложение сохраняет собственную ссылку на цель для повторной проверки доступа.
ALTER TABLE work_plan_suggestions ADD COLUMN source_goal_id BIGINT UNSIGNED NULL,
 ADD COLUMN source_goal_hash CHAR(64) NULL;
-- Старые предложения без происхождения цели нельзя показывать после смены её привязки.
UPDATE work_plan_suggestions SET status='failed',proposals_json=NULL,
 error_text='Подготовьте предложения заново: требуется проверяемая ссылка на цель'
 WHERE status IN ('running','ready','applied');
