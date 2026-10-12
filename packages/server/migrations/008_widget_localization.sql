CREATE TABLE IF NOT EXISTS sova_widget_translations (
  channel_id BIGINT UNSIGNED NOT NULL,
  source_hash CHAR(64) NOT NULL,
  target_lang VARCHAR(8) NOT NULL,
  status ENUM('ok','failed') NOT NULL,
  texts MEDIUMTEXT NULL,
  error VARCHAR(250) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (channel_id, source_hash, target_lang),
  CONSTRAINT sova_fk_widget_translation_channel FOREIGN KEY (channel_id) REFERENCES sova_channels (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Interface language is separate from the language detected in message text.
CREATE TABLE IF NOT EXISTS sova_widget_preferences (
  channel_id BIGINT UNSIGNED NOT NULL,
  end_user_id BIGINT UNSIGNED NOT NULL,
  language VARCHAR(8) NOT NULL,
  PRIMARY KEY (channel_id, end_user_id),
  CONSTRAINT sova_fk_widget_pref_channel FOREIGN KEY (channel_id) REFERENCES sova_channels (id) ON DELETE CASCADE,
  CONSTRAINT sova_fk_widget_pref_user FOREIGN KEY (end_user_id) REFERENCES sova_end_users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
