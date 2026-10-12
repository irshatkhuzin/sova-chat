-- Sova: начальная схема.
-- Все таблицы utf8mb4, InnoDB. Время хранится в UTC (DATETIME(3)).

CREATE TABLE IF NOT EXISTS sova_operators (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email VARCHAR(190) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(120) NOT NULL,
  role ENUM('admin','operator') NOT NULL DEFAULT 'operator',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  telegram_user_id VARCHAR(40) NULL,
  last_login_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uniq_operator_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sova_operator_sessions (
  id CHAR(36) NOT NULL,
  operator_id BIGINT UNSIGNED NOT NULL,
  refresh_token_hash CHAR(64) NOT NULL,
  user_agent VARCHAR(255) NULL,
  ip VARCHAR(45) NULL,
  expires_at DATETIME(3) NOT NULL,
  revoked_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uniq_refresh_hash (refresh_token_hash),
  KEY idx_operator_sessions_operator (operator_id, expires_at),
  CONSTRAINT sova_fk_operator_sessions_operator FOREIGN KEY (operator_id) REFERENCES sova_operators (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sova_products (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug VARCHAR(64) NOT NULL,
  name VARCHAR(160) NOT NULL,
  description TEXT NULL,
  ai_enabled TINYINT(1) NOT NULL DEFAULT 1,
  ai_instructions MEDIUMTEXT NULL,
  ai_model VARCHAR(80) NULL,
  ai_temperature DECIMAL(3,2) NOT NULL DEFAULT 0.30,
  ai_max_output_tokens INT UNSIGNED NOT NULL DEFAULT 500,
  ai_max_clarify_rounds TINYINT UNSIGNED NOT NULL DEFAULT 2,
  handoff_keywords TEXT NULL,
  handoff_rules TEXT NULL,
  default_language VARCHAR(8) NOT NULL DEFAULT 'en',
  reopen_policy ENUM('reopen_to_ai','reopen_to_operator','new_conversation') NOT NULL DEFAULT 'reopen_to_ai',
  ai_daily_cost_limit_usd DECIMAL(10,4) NOT NULL DEFAULT 5.0000,
  ai_monthly_cost_limit_usd DECIMAL(10,4) NOT NULL DEFAULT 50.0000,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uniq_product_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sova_channels (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  product_id BIGINT UNSIGNED NOT NULL,
  type ENUM('web','android','telegram','webhook') NOT NULL,
  name VARCHAR(160) NOT NULL,
  public_id CHAR(32) NOT NULL,
  -- Секрет подписи токенов авторизованных пользователей. Хранится зашифрованным (AES-256-GCM).
  auth_secret_enc VARCHAR(512) NOT NULL,
  allowed_origins TEXT NULL,
  settings MEDIUMTEXT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uniq_channel_public_id (public_id),
  KEY idx_channels_product (product_id, type),
  CONSTRAINT sova_fk_channels_product FOREIGN KEY (product_id) REFERENCES sova_products (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sova_end_users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  product_id BIGINT UNSIGNED NOT NULL,
  first_channel_id BIGINT UNSIGNED NULL,
  external_id VARCHAR(190) NULL,
  is_verified TINYINT(1) NOT NULL DEFAULT 0,
  display_name VARCHAR(160) NULL,
  email VARCHAR(190) NULL,
  language VARCHAR(8) NULL,
  meta TEXT NULL,
  first_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  -- Один подтверждённый пользователь на продукт. NULL в external_id не участвует
  -- в уникальном индексе, поэтому анонимных посетителей может быть сколько угодно.
  UNIQUE KEY uniq_end_user_external (product_id, external_id),
  KEY idx_end_users_product (product_id, last_seen_at),
  CONSTRAINT sova_fk_end_users_product FOREIGN KEY (product_id) REFERENCES sova_products (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sova_end_user_sessions (
  id CHAR(36) NOT NULL,
  end_user_id BIGINT UNSIGNED NOT NULL,
  channel_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL,
  visitor_key CHAR(36) NOT NULL,
  ip VARCHAR(45) NULL,
  user_agent VARCHAR(255) NULL,
  expires_at DATETIME(3) NOT NULL,
  revoked_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uniq_end_user_session_token (token_hash),
  KEY idx_end_user_sessions_user (end_user_id),
  KEY idx_end_user_sessions_visitor (channel_id, visitor_key),
  CONSTRAINT sova_fk_end_user_sessions_user FOREIGN KEY (end_user_id) REFERENCES sova_end_users (id) ON DELETE CASCADE,
  CONSTRAINT sova_fk_end_user_sessions_channel FOREIGN KEY (channel_id) REFERENCES sova_channels (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sova_conversations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  product_id BIGINT UNSIGNED NOT NULL,
  channel_id BIGINT UNSIGNED NOT NULL,
  end_user_id BIGINT UNSIGNED NOT NULL,
  status ENUM('ai','waiting_operator','operator','closed') NOT NULL DEFAULT 'ai',
  state_version INT UNSIGNED NOT NULL DEFAULT 1,
  assigned_operator_id BIGINT UNSIGNED NULL,
  language VARCHAR(8) NULL,
  language_locked TINYINT(1) NOT NULL DEFAULT 0,
  last_seq INT UNSIGNED NOT NULL DEFAULT 0,
  handoff_reason VARCHAR(48) NULL,
  handoff_summary_ru TEXT NULL,
  handoff_at DATETIME(3) NULL,
  unread_for_operator INT UNSIGNED NOT NULL DEFAULT 0,
  ai_clarify_rounds TINYINT UNSIGNED NOT NULL DEFAULT 0,
  last_message_at DATETIME(3) NULL,
  last_message_preview VARCHAR(255) NULL,
  previous_conversation_id BIGINT UNSIGNED NULL,
  closed_at DATETIME(3) NULL,
  closed_by_operator_id BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_conversations_product_status (product_id, status, last_message_at),
  KEY idx_conversations_channel (channel_id, last_message_at),
  KEY idx_conversations_end_user (end_user_id, created_at),
  KEY idx_conversations_status (status, last_message_at),
  CONSTRAINT sova_fk_conversations_product FOREIGN KEY (product_id) REFERENCES sova_products (id) ON DELETE CASCADE,
  CONSTRAINT sova_fk_conversations_channel FOREIGN KEY (channel_id) REFERENCES sova_channels (id) ON DELETE CASCADE,
  CONSTRAINT sova_fk_conversations_end_user FOREIGN KEY (end_user_id) REFERENCES sova_end_users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sova_messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  conversation_id BIGINT UNSIGNED NOT NULL,
  seq INT UNSIGNED NOT NULL,
  author_type ENUM('user','ai','operator','system') NOT NULL,
  author_operator_id BIGINT UNSIGNED NULL,
  client_msg_id VARCHAR(64) NULL,
  original_lang VARCHAR(8) NULL,
  original_text MEDIUMTEXT NOT NULL,
  delivery_status ENUM('pending','sent','failed') NOT NULL DEFAULT 'sent',
  failure_reason VARCHAR(255) NULL,
  ai_meta TEXT NULL,
  has_attachments TINYINT(1) NOT NULL DEFAULT 0,
  -- Системные сообщения (например «передано оператору») клиенту показываются,
  -- служебные (internal) — только в панели.
  is_internal TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uniq_message_seq (conversation_id, seq),
  UNIQUE KEY uniq_message_client_id (conversation_id, client_msg_id),
  KEY idx_messages_conversation (conversation_id, id),
  KEY idx_messages_created (created_at),
  FULLTEXT KEY ft_messages_text (original_text)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE sova_messages
  ADD CONSTRAINT sova_fk_messages_conversation FOREIGN KEY (conversation_id) REFERENCES sova_conversations (id) ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS sova_message_translations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  message_id BIGINT UNSIGNED NOT NULL,
  target_lang VARCHAR(8) NOT NULL,
  text MEDIUMTEXT NULL,
  provider VARCHAR(40) NOT NULL,
  model VARCHAR(80) NULL,
  status ENUM('pending','ok','failed') NOT NULL DEFAULT 'pending',
  error VARCHAR(255) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uniq_translation (message_id, target_lang),
  CONSTRAINT sova_fk_translations_message FOREIGN KEY (message_id) REFERENCES sova_messages (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sova_attachments (
  id CHAR(36) NOT NULL,
  conversation_id BIGINT UNSIGNED NOT NULL,
  message_id BIGINT UNSIGNED NULL,
  uploaded_by ENUM('user','operator') NOT NULL,
  uploader_id VARCHAR(40) NULL,
  storage_key VARCHAR(255) NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  mime VARCHAR(100) NOT NULL,
  size_bytes INT UNSIGNED NOT NULL,
  width INT UNSIGNED NULL,
  height INT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_attachments_conversation (conversation_id),
  KEY idx_attachments_message (message_id),
  CONSTRAINT sova_fk_attachments_conversation FOREIGN KEY (conversation_id) REFERENCES sova_conversations (id) ON DELETE CASCADE,
  CONSTRAINT sova_fk_attachments_message FOREIGN KEY (message_id) REFERENCES sova_messages (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sova_internal_notes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  conversation_id BIGINT UNSIGNED NOT NULL,
  operator_id BIGINT UNSIGNED NOT NULL,
  body TEXT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_notes_conversation (conversation_id, created_at),
  CONSTRAINT sova_fk_notes_conversation FOREIGN KEY (conversation_id) REFERENCES sova_conversations (id) ON DELETE CASCADE,
  CONSTRAINT sova_fk_notes_operator FOREIGN KEY (operator_id) REFERENCES sova_operators (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sova_conversation_reads (
  operator_id BIGINT UNSIGNED NOT NULL,
  conversation_id BIGINT UNSIGNED NOT NULL,
  last_read_seq INT UNSIGNED NOT NULL DEFAULT 0,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (operator_id, conversation_id),
  CONSTRAINT sova_fk_reads_operator FOREIGN KEY (operator_id) REFERENCES sova_operators (id) ON DELETE CASCADE,
  CONSTRAINT sova_fk_reads_conversation FOREIGN KEY (conversation_id) REFERENCES sova_conversations (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sova_knowledge_articles (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  product_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(255) NOT NULL,
  body MEDIUMTEXT NOT NULL,
  kind ENUM('article','faq') NOT NULL DEFAULT 'article',
  lang VARCHAR(8) NOT NULL DEFAULT 'ru',
  tags VARCHAR(255) NULL,
  is_published TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_kb_product (product_id, is_published),
  FULLTEXT KEY ft_kb_text (title, body, tags),
  CONSTRAINT sova_fk_kb_product FOREIGN KEY (product_id) REFERENCES sova_products (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sova_ai_usage (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  product_id BIGINT UNSIGNED NOT NULL,
  conversation_id BIGINT UNSIGNED NULL,
  kind ENUM('reply','translate','detect','summary') NOT NULL,
  provider VARCHAR(40) NOT NULL,
  model VARCHAR(80) NOT NULL,
  prompt_tokens INT UNSIGNED NOT NULL DEFAULT 0,
  completion_tokens INT UNSIGNED NOT NULL DEFAULT 0,
  cost_usd DECIMAL(12,6) NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_usage_product_time (product_id, created_at),
  CONSTRAINT sova_fk_usage_product FOREIGN KEY (product_id) REFERENCES sova_products (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sova_conversation_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  conversation_id BIGINT UNSIGNED NOT NULL,
  type VARCHAR(48) NOT NULL,
  actor_type ENUM('system','operator','ai','user') NOT NULL DEFAULT 'system',
  actor_id VARCHAR(40) NULL,
  payload TEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_events_conversation (conversation_id, created_at),
  CONSTRAINT sova_fk_events_conversation FOREIGN KEY (conversation_id) REFERENCES sova_conversations (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
