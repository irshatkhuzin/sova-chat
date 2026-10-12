/** Форматирование дат и подписей для интерфейса на русском. */
import { CONVERSATION_STATUS_RU, type ConversationStatus, type MessageAuthorType } from "@sova/shared";

const timeFormatter = new Intl.DateTimeFormat("ru-RU", {
  hour: "2-digit",
  minute: "2-digit",
});

const dateTimeFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

const fullFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatTime(iso: string | null): string {
  if (!iso) return "";
  return timeFormatter.format(new Date(iso));
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return "";
  return dateTimeFormatter.format(new Date(iso));
}

export function formatFull(iso: string | null): string {
  if (!iso) return "";
  return fullFormatter.format(new Date(iso));
}

export function formatRelative(iso: string | null): string {
  if (!iso) return "";
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "только что";
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} дн назад`;
  return formatDateTime(iso);
}

export function statusLabel(status: ConversationStatus): string {
  return CONVERSATION_STATUS_RU[status];
}

export function authorLabel(author: MessageAuthorType): string {
  switch (author) {
    case "user":
      return "Пользователь";
    case "ai":
      return "ИИ-помощник";
    case "operator":
      return "Оператор";
    case "system":
      return "Система";
    default:
      return author;
  }
}

export function channelTypeLabel(type: string): string {
  switch (type) {
    case "web":
      return "Сайт";
    case "android":
      return "Android";
    case "telegram":
      return "Telegram";
    case "webhook":
      return "Вебхук";
    default:
      return type;
  }
}
