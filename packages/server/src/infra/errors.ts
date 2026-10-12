/** Ошибки приложения с кодом и HTTP-статусом. */
import { ErrorCodes, type ErrorCode } from "@sova/shared";

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;
  /** true — сообщение можно показать пользователю/оператору. */
  readonly expose: boolean;

  constructor(
    code: ErrorCode,
    message: string,
    status: number,
    options: { details?: unknown; expose?: boolean } = {},
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.details = options.details;
    this.expose = options.expose ?? true;
  }
}

export const errors = {
  unauthorized: (message = "Требуется вход") =>
    new AppError(ErrorCodes.Unauthorized, message, 401),
  forbidden: (message = "Недостаточно прав") => new AppError(ErrorCodes.Forbidden, message, 403),
  notFound: (message = "Не найдено") => new AppError(ErrorCodes.NotFound, message, 404),
  validation: (message = "Некорректные данные", details?: unknown) =>
    new AppError(ErrorCodes.Validation, message, 400, { details }),
  conflict: (message = "Конфликт состояния") => new AppError(ErrorCodes.Conflict, message, 409),
  rateLimited: (message = "Слишком много запросов") =>
    new AppError(ErrorCodes.RateLimited, message, 429),
  tooLarge: (message = "Файл слишком большой") =>
    new AppError(ErrorCodes.PayloadTooLarge, message, 413),
  unsupportedMedia: (message = "Неподдерживаемый тип файла") =>
    new AppError(ErrorCodes.UnsupportedMedia, message, 415),
  internal: (message = "Внутренняя ошибка") =>
    new AppError(ErrorCodes.Internal, message, 500, { expose: false }),
  aiUnavailable: (message = "ИИ-помощник недоступен") =>
    new AppError(ErrorCodes.AiUnavailable, message, 503),
  translationFailed: (message = "Не удалось перевести сообщение") =>
    new AppError(ErrorCodes.TranslationFailed, message, 502),
};

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

/** Короткое описание ошибки для логов (без стека внешних библиотек). */
export function describeError(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}
