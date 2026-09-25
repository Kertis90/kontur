-- Добавляет подразделения компании и права, ограниченные конкретным трайбом.
ALTER TABLE users MODIFY COLUMN global_role ENUM('owner','admin','project_manager','tribe_leader','member','viewer') NOT NULL DEFAULT 'member';
CREATE TABLE tribes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  workspace_id BIGINT UNSIGNED NOT NULL,
  leader_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(160) NOT NULL,
  description VARCHAR(2000) NOT NULL DEFAULT '',
  color VARCHAR(16) NOT NULL DEFAULT '#e30611',
  revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tribe_name (workspace_id,name),
  CONSTRAINT fk_tribe_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  CONSTRAINT fk_tribe_leader FOREIGN KEY (leader_id) REFERENCES users(id),
  CONSTRAINT fk_tribe_creator FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE tribe_members (
  tribe_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  can_manage_space BOOLEAN NOT NULL DEFAULT FALSE,
  can_manage_members BOOLEAN NOT NULL DEFAULT FALSE,
  can_create_projects BOOLEAN NOT NULL DEFAULT FALSE,
  can_manage_projects BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tribe_id,user_id),
  KEY ix_tribe_member_user (user_id,tribe_id),
  CONSTRAINT fk_tribe_member_tribe FOREIGN KEY (tribe_id) REFERENCES tribes(id) ON DELETE CASCADE,
  CONSTRAINT fk_tribe_member_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
ALTER TABLE projects
  ADD COLUMN tribe_id BIGINT UNSIGNED NULL,
  ADD COLUMN owner_id BIGINT UNSIGNED NULL,
  ADD COLUMN access_mode ENUM('members','scheme') NOT NULL DEFAULT 'scheme',
  ADD COLUMN access_revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
  ADD CONSTRAINT fk_project_tribe FOREIGN KEY (tribe_id) REFERENCES tribes(id),
  ADD CONSTRAINT fk_project_owner FOREIGN KEY (owner_id) REFERENCES users(id);
-- Сохраняет прежнюю видимость существующих проектов; владелец берётся из автора проекта.
UPDATE projects p JOIN users u ON u.id=p.created_by AND u.workspace_id=p.workspace_id SET p.owner_id=u.id WHERE u.is_service=FALSE;
ALTER TABLE projects ALTER COLUMN access_mode SET DEFAULT 'members';
