-- Отзывает сессии и API-токены при блокировке, смене пароля или источника входа.
CREATE FUNCTION kontur_revoke_access() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status<>'active' OR NEW.password_hash IS DISTINCT FROM OLD.password_hash OR NEW.auth_source<>OLD.auth_source THEN
  UPDATE user_sessions SET revoked_at=statement_timestamp() AT TIME ZONE 'UTC' WHERE user_id=NEW.id AND revoked_at IS NULL;
  UPDATE api_tokens SET revoked_at=statement_timestamp() AT TIME ZONE 'UTC' WHERE user_id=NEW.id AND revoked_at IS NULL;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER user_revoke_access AFTER UPDATE ON users FOR EACH ROW EXECUTE FUNCTION kontur_revoke_access();

-- Запоминает дату завершения задачи и сохраняет её при редактировании других полей.
CREATE FUNCTION kontur_task_completion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.stage_id=OLD.stage_id THEN
  NEW.completed_at=OLD.completed_at;
 ELSIF EXISTS(SELECT 1 FROM workflow_stages WHERE id=NEW.stage_id AND is_done=1) THEN
  NEW.completed_at=CASE WHEN TG_OP='INSERT' THEN COALESCE(NEW.created_at,statement_timestamp() AT TIME ZONE 'UTC') ELSE statement_timestamp() AT TIME ZONE 'UTC' END;
 ELSE NEW.completed_at=NULL;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER task_completion BEFORE INSERT OR UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION kontur_task_completion();

-- Сохраняет историю этапов для отчётов и расчёта сроков задач.
CREATE FUNCTION kontur_task_state() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' OR NEW.stage_id<>OLD.stage_id THEN
  INSERT INTO task_state_events(task_id,stage_id,is_done,occurred_at)
  SELECT NEW.id,NEW.stage_id,is_done,CASE WHEN TG_OP='INSERT' THEN NEW.created_at ELSE statement_timestamp() AT TIME ZONE 'UTC' END FROM workflow_stages WHERE id=NEW.stage_id;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER task_state AFTER INSERT OR UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION kontur_task_state();

-- Записывает изменение смысла этапа для всех находящихся на нём задач.
CREATE FUNCTION kontur_workflow_completion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.is_done<>OLD.is_done THEN
  INSERT INTO task_state_events(task_id,stage_id,is_done,occurred_at,source)
  SELECT id,NEW.id,NEW.is_done,statement_timestamp() AT TIME ZONE 'UTC','workflow' FROM tasks WHERE stage_id=NEW.id;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER workflow_completion AFTER UPDATE ON workflow_stages FOR EACH ROW EXECUTE FUNCTION kontur_workflow_completion();
