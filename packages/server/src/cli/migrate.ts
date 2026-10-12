/** Применение миграций: npm run migrate */
import { closePool } from "../infra/db.js";
import { logger } from "../infra/logger.js";
import { runMigrations } from "../infra/migrate.js";

async function main(): Promise<void> {
  const executed = await runMigrations();
  logger.info({ executed }, "Готово");
  await closePool();
}

main().catch(async (err) => {
  logger.error({ err: err instanceof Error ? err.message : String(err) }, "Миграции не применены");
  await closePool();
  process.exit(1);
});
