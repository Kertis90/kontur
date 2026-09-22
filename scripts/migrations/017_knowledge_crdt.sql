CREATE TABLE knowledge_crdt (
 article_id BIGINT UNSIGNED PRIMARY KEY, epoch CHAR(36) NOT NULL, state_blob MEDIUMBLOB NOT NULL,
 body_hash CHAR(64) NOT NULL, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 FOREIGN KEY(article_id) REFERENCES knowledge_articles(id) ON DELETE CASCADE
);
CREATE TABLE knowledge_cursors (
 article_id BIGINT UNSIGNED NOT NULL, user_id BIGINT UNSIGNED NOT NULL, client_id CHAR(36) NOT NULL,
 epoch CHAR(36) NOT NULL, anchor_json JSON NULL, focus_json JSON NULL, seen_at DATETIME NOT NULL,
 PRIMARY KEY(article_id,user_id,client_id), KEY(seen_at),
 FOREIGN KEY(article_id) REFERENCES knowledge_articles(id) ON DELETE CASCADE,
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
