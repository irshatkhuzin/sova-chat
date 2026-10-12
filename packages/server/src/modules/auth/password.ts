/** Хеширование паролей операторов. */
import bcrypt from "bcryptjs";

const ROUNDS = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

/** Минимальные требования к паролю оператора. */
export function validatePasswordStrength(plain: string): string | null {
  if (plain.length < 10) return "Пароль должен быть не короче 10 символов";
  if (!/[a-zA-Zа-яА-Я]/.test(plain)) return "Пароль должен содержать буквы";
  if (!/\d/.test(plain)) return "Пароль должен содержать хотя бы одну цифру";
  return null;
}
