ALTER TABLE conferences
  MODIFY COLUMN capacity SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN join_policy ENUM('link','invited') NOT NULL DEFAULT 'link' AFTER max_publishers,
  ADD COLUMN join_code CHAR(36) NULL AFTER join_policy;

UPDATE conferences conference
SET conference.join_policy=IF(
  (SELECT COUNT(*) FROM conference_participants participant WHERE participant.conference_id=conference.id)>1,
  'invited',
  'link'
);

UPDATE conferences SET join_code=UUID() WHERE join_code IS NULL;

ALTER TABLE conferences
  MODIFY COLUMN join_code CHAR(36) NOT NULL,
  ADD UNIQUE KEY uq_conference_join_code (join_code);

CREATE TABLE IF NOT EXISTS knowledge_teams (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  workspace_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(180) NOT NULL,
  slug VARCHAR(100) NOT NULL,
  description VARCHAR(500) NULL,
  color CHAR(7) NOT NULL DEFAULT '#675EE7',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_knowledge_team_slug (workspace_id, slug),
  KEY ix_knowledge_team_workspace (workspace_id, active, name),
  CONSTRAINT fk_knowledge_team_workspace FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
  CONSTRAINT fk_knowledge_team_creator FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS knowledge_team_members (
  team_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  team_role ENUM('lead','member') NOT NULL DEFAULT 'member',
  added_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (team_id, user_id),
  KEY ix_knowledge_team_member_user (user_id, team_id),
  CONSTRAINT fk_knowledge_team_member_team FOREIGN KEY (team_id) REFERENCES knowledge_teams(id) ON DELETE CASCADE,
  CONSTRAINT fk_knowledge_team_member_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_knowledge_team_member_actor FOREIGN KEY (added_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE knowledge_spaces
  MODIFY COLUMN visibility ENUM('private','restricted','workspace','public') NOT NULL DEFAULT 'workspace',
  ADD COLUMN owner_team_id BIGINT UNSIGNED NULL AFTER visibility,
  ADD CONSTRAINT fk_knowledge_space_owner_team FOREIGN KEY (owner_team_id) REFERENCES knowledge_teams(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS knowledge_space_permissions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  space_id BIGINT UNSIGNED NOT NULL,
  principal_type ENUM('user','team') NOT NULL,
  principal_id BIGINT UNSIGNED NOT NULL,
  access_level ENUM('view','edit','admin') NOT NULL DEFAULT 'view',
  granted_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_knowledge_space_principal (space_id, principal_type, principal_id),
  KEY ix_knowledge_space_principal (principal_type, principal_id, space_id),
  CONSTRAINT fk_knowledge_space_permission_space FOREIGN KEY (space_id) REFERENCES knowledge_spaces(id) ON DELETE CASCADE,
  CONSTRAINT fk_knowledge_space_permission_actor FOREIGN KEY (granted_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT IGNORE INTO knowledge_space_permissions (space_id, principal_type, principal_id, access_level, granted_by)
SELECT id, 'user', created_by, 'admin', created_by FROM knowledge_spaces;
