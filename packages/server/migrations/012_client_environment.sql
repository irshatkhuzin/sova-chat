CREATE TABLE IF NOT EXISTS sova_client_environment (
 session_id CHAR(36) NOT NULL PRIMARY KEY,
 browser_language VARCHAR(255) NULL,
 observed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 CONSTRAINT sova_fk_environment_session FOREIGN KEY (session_id) REFERENCES sova_end_user_sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
