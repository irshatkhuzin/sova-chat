/**
 * Уведомления администратору в Telegram.
 * Необязательный канал: если токен или chat_id не заданы, функции молча ничего не делают,
 * панель продолжает работать как обычно.
 */
import { config } from "../../config.js";
import { moduleLogger } from "../../infra/logger.js";

const log = moduleLogger("telegram");

export async function sendTelegramMessage(text: string): Promise<boolean> {
  if (!config.telegram.enabled) return false;

  const url = `https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: config.telegram.adminChatId,
        text: text.slice(0, 4000),
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      // Токен в URL никогда не логируем.
      log.warn({ status: res.status }, "Telegram отклонил уведомление");
      return false;
    }
    return true;
  } catch (err) {
    log.warn({ err: String(err) }, "Не удалось отправить уведомление в Telegram");
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Экранирование для parse_mode=HTML. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
