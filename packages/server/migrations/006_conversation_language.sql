-- MySQL-compatible, repeatable column additions.
SET @sova_ddl = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='sova_conversations' AND column_name='language_established')=0, 'ALTER TABLE sova_conversations ADD COLUMN language_established TINYINT NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE sova_stmt FROM @sova_ddl;
EXECUTE sova_stmt;
DEALLOCATE PREPARE sova_stmt;
SET @sova_ddl = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='sova_messages' AND column_name='outbound_lang')=0, 'ALTER TABLE sova_messages ADD COLUMN outbound_lang VARCHAR(10) NULL', 'SELECT 1');
PREPARE sova_stmt FROM @sova_ddl;
EXECUTE sova_stmt;
DEALLOCATE PREPARE sova_stmt;
