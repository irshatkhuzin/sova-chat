CREATE TABLE IF NOT EXISTS sova_message_feedback (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  message_id BIGINT UNSIGNED NOT NULL,
  rating ENUM('good','bad') NOT NULL,
  comment VARCHAR(2000) NOT NULL DEFAULT '',
  correction TEXT NOT NULL,
  operator_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uniq_feedback_message (message_id),
  CONSTRAINT sova_fk_feedback_message FOREIGN KEY (message_id) REFERENCES sova_messages(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
ALTER TABLE sova_learning_jobs MODIFY closed_version INT UNSIGNED NULL;
SET @sova_feedback_ddl = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sova_learning_jobs' AND COLUMN_NAME='feedback_id')=0, 'ALTER TABLE sova_learning_jobs ADD COLUMN feedback_id BIGINT UNSIGNED NULL, ADD UNIQUE KEY uniq_learning_feedback (feedback_id)', 'SELECT 1');
PREPARE sova_feedback_stmt FROM @sova_feedback_ddl;
EXECUTE sova_feedback_stmt;
DEALLOCATE PREPARE sova_feedback_stmt;
