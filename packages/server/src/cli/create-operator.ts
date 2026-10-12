/**
 * Создание оператора из командной строки.
 * Пример: npm run create-operator -- --email me@example.com --name "Operator" --password "..." --admin
 * Пароль можно не указывать — он будет сгенерирован и показан один раз.
 */
import { closePool, execute, queryOne } from "../infra/db.js";
import type { RowDataPacket } from "mysql2/promise";
import { logger } from "../infra/logger.js";
import { randomToken } from "../infra/crypto.js";
import { hashPassword, validatePasswordStrength } from "../modules/auth/password.js";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

async function main(): Promise<void> {
  const emailArg = arg("email");
  const name = arg("name") ?? "Оператор";
  const isAdmin = process.argv.includes("--admin");
  let password = arg("password");

  if (!emailArg) {
    // eslint-disable-next-line no-console
    console.error("Укажите --email");
    process.exit(1);
    return;
  }
  const email = emailArg;

  if (!password) {
    password = `${randomToken(9)}1a`;
    // Единственное место, где пароль печатается: его нужно сохранить.
    // eslint-disable-next-line no-console
    console.log(`Сгенерирован пароль: ${password}`);
  } else {
    const weak = validatePasswordStrength(password);
    if (weak) {
      // eslint-disable-next-line no-console
      console.error(weak);
      process.exit(1);
    }
  }

  const existing = await queryOne<RowDataPacket>(
    "SELECT id FROM sova_operators WHERE email = ? LIMIT 1",
    [email.toLowerCase()],
  );

  if (existing) {
    await execute("UPDATE sova_operators SET password_hash = ?, display_name = ?, role = ? WHERE id = ?", [
      await hashPassword(password),
      name,
      isAdmin ? "admin" : "operator",
      existing.id,
    ]);
    logger.info({ email }, "Оператор обновлён");
  } else {
    await execute(
      "INSERT INTO sova_operators (email, password_hash, display_name, role) VALUES (?, ?, ?, ?)",
      [email.toLowerCase(), await hashPassword(password), name, isAdmin ? "admin" : "operator"],
    );
    logger.info({ email, role: isAdmin ? "admin" : "operator" }, "Оператор создан");
  }

  await closePool();
}

main().catch(async (err) => {
  logger.error({ err: err instanceof Error ? err.message : String(err) }, "Ошибка");
  await closePool();
  process.exit(1);
});
