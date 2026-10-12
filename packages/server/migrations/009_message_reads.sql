-- Durable receipts. Existing messages/data remain unchanged.
CREATE TABLE IF NOT EXISTS sova_message_reads (
  message_id BIGINT UNSIGNED NOT NULL,
  read_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (message_id),
  CONSTRAINT sova_fk_message_reads_message FOREIGN KEY (message_id)
    REFERENCES sova_messages(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
