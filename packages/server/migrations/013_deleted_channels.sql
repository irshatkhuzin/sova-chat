-- Keep channel references and conversation history while removing the connection.
CREATE TABLE IF NOT EXISTS sova_deleted_channels (
  channel_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  deleted_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT sova_fk_deleted_channels_channel FOREIGN KEY (channel_id)
    REFERENCES sova_channels(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
