-- Личный порядок ссылок не заменяет проверку доступа к исходным объектам.
CREATE TABLE user_favorites (
 user_id BIGINT UNSIGNED PRIMARY KEY,
 revision INT UNSIGNED NOT NULL DEFAULT 1,
 items_json JSON NOT NULL,
 updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
