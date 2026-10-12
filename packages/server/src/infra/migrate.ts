/**
 * Простой раннер миграций: выполняет .sql-файлы из ./migrations по порядку имён,
 * запоминая применённые в таблице migrations.
 */
import fs from "node:fs";
import path from "node:path";
import { getPool } from "./db.js";
import { moduleLogger } from "./logger.js";
import { serverRoot } from "./paths.js";

const log = moduleLogger("migrate");

const MIGRATIONS_DIR = path.join(serverRoot, "migrations");

/**
 * Делит файл на отдельные запросы по `;` в конце строки.
 * Комментарии `--` игнорируются. Хранимых процедур в проекте нет, поэтому
 * разбор такого уровня достаточен.
 */
function splitStatements(sql: string): string[] {
  const withoutComments = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  return withoutComments
    .split(/;\s*$/m)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export async function runMigrations(): Promise<string[]> {
  const pool = getPool();
  await pool.query(
    `CREATE TABLE IF NOT EXISTS sova_migrations (
       name VARCHAR(190) NOT NULL,
       applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
       PRIMARY KEY (name)
     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  );

  const [appliedRows] = await pool.query<any[]>("SELECT name FROM sova_migrations");
  const applied = new Set(appliedRows.map((r) => String(r.name)));

  if (!fs.existsSync(MIGRATIONS_DIR)) {
    throw new Error(`Каталог миграций не найден: ${MIGRATIONS_DIR}`);
  }

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const executed: string[] = [];

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    const statements = splitStatements(sql);
    log.info({ file, statements: statements.length }, "Применяю миграцию");

    const conn = await pool.getConnection();
    try {
      // DDL в MySQL не откатывается, поэтому транзакция здесь не спасает.
      // Миграции пишем идемпотентными (IF NOT EXISTS), чтобы повтор был безопасным.
      for (const statement of statements) {
        await conn.query(statement);
      }
      await conn.query("INSERT INTO sova_migrations (name) VALUES (?)", [file]);
      executed.push(file);
    } finally {
      conn.release();
    }
  }

  if (executed.length === 0) {
    log.info("Новых миграций нет");
  } else {
    log.info({ executed }, "Миграции применены");
  }
  return executed;
}
