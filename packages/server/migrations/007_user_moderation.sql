SET @sova_ddl = IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='sova_end_users' AND column_name='blocked_at')=0, 'ALTER TABLE sova_end_users ADD COLUMN blocked_at DATETIME(3) NULL, ADD COLUMN blocked_until DATETIME(3) NULL, ADD COLUMN blocked_reason VARCHAR(500) NULL, ADD COLUMN moderation_reset_at DATETIME(3) NULL', 'SELECT 1');
PREPARE sova_stmt FROM @sova_ddl;
EXECUTE sova_stmt;
DEALLOCATE PREPARE sova_stmt;
