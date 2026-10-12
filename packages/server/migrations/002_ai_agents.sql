CREATE TABLE IF NOT EXISTS sova_ai_settings (
  role VARCHAR(20) NOT NULL PRIMARY KEY,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  use_shared TINYINT(1) NOT NULL DEFAULT 1,
  base_url VARCHAR(500) NOT NULL,
  api_key_enc TEXT NULL,
  model VARCHAR(120) NOT NULL DEFAULT '',
  input_price DECIMAL(12,6) NOT NULL DEFAULT 0,
  output_price DECIMAL(12,6) NOT NULL DEFAULT 0,
  send_temperature TINYINT(1) NOT NULL DEFAULT 1,
  token_parameter VARCHAR(30) NOT NULL DEFAULT 'max_tokens',
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sova_screening (
  message_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  verdict ENUM('pending','allowed','rejected') NOT NULL DEFAULT 'pending',
  published TINYINT(1) NOT NULL DEFAULT 0,
  reason VARCHAR(500) NULL,
  source VARCHAR(30) NULL,
  reviewed_by BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_screening_verdict (verdict, created_at),
  CONSTRAINT sova_fk_screening_message FOREIGN KEY (message_id) REFERENCES sova_messages(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sova_learning_jobs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  conversation_id BIGINT UNSIGNED NOT NULL,
  closed_version INT UNSIGNED NOT NULL,
  status ENUM('pending','processing','done','skipped','failed') NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  reason VARCHAR(500) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uniq_learning_close (conversation_id, closed_version),
  CONSTRAINT sova_fk_learning_conversation FOREIGN KEY (conversation_id) REFERENCES sova_conversations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sova_knowledge_proposals (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  job_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NOT NULL,
  conversation_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(255) NOT NULL,
  body MEDIUMTEXT NOT NULL,
  evidence TEXT NOT NULL,
  duplicate_article_id BIGINT UNSIGNED NULL,
  fingerprint CHAR(64) NOT NULL,
  status ENUM('draft','approved','rejected') NOT NULL DEFAULT 'draft',
  article_id BIGINT UNSIGNED NULL,
  reviewed_by BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uniq_proposal_job (job_id),
  UNIQUE KEY uniq_proposal_content (product_id, fingerprint),
  CONSTRAINT sova_fk_proposal_product FOREIGN KEY (product_id) REFERENCES sova_products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sova_knowledge_versions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  article_id BIGINT UNSIGNED NOT NULL,
  snapshot MEDIUMTEXT NOT NULL,
  reason VARCHAR(100) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_versions_article (article_id, id),
  CONSTRAINT sova_fk_versions_article FOREIGN KEY (article_id) REFERENCES sova_knowledge_articles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sova_agent_calls (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  role VARCHAR(20) NOT NULL,
  product_id BIGINT UNSIGNED NULL,
  model VARCHAR(120) NOT NULL,
  prompt_tokens INT NOT NULL,
  completion_tokens INT NOT NULL,
  cost_usd DECIMAL(12,6) NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_agent_calls_time (created_at, role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
