CREATE TABLE runtime_heartbeats (
 instance_id CHAR(36) PRIMARY KEY, component VARCHAR(40) NOT NULL,
 last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 KEY(component,last_seen_at)
);
