CREATE TABLE integration_health (
 connection_id BIGINT UNSIGNED PRIMARY KEY,
 degraded BOOLEAN NOT NULL DEFAULT FALSE, last_alert_at DATETIME NULL,
 last_success_at DATETIME NULL, last_failure_at DATETIME NULL,
 FOREIGN KEY(connection_id) REFERENCES integration_connections(id) ON DELETE CASCADE
);
