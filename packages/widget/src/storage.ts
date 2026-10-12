/**
 * Локальное хранилище виджета: ключ посетителя, токен сессии, неотправленные сообщения.
 * Всё обёрнуто в try/catch: в приватном режиме или при запрете cookie
 * localStorage может быть недоступен, и виджет обязан продолжать работать.
 */

export interface PendingMessage {
  clientMsgId: string;
  text: string;
  attachmentIds: string[];
  createdAt: number;
}

export class WidgetStorage {
  constructor(private readonly namespace: string) {}

  private key(name: string): string {
    return `sova.${this.namespace}.${name}`;
  }

  private read(name: string): string | null {
    try {
      return window.localStorage.getItem(this.key(name));
    } catch {
      return null;
    }
  }

  private write(name: string, value: string): void {
    try {
      window.localStorage.setItem(this.key(name), value);
    } catch {
      /* хранилище недоступно — работаем без сохранения */
    }
  }

  private remove(name: string): void {
    try {
      window.localStorage.removeItem(this.key(name));
    } catch {
      /* игнорируем */
    }
  }

  get visitorKey(): string | null {
    return this.read("visitor");
  }

  set visitorKey(value: string | null) {
    if (value) this.write("visitor", value);
    else this.remove("visitor");
  }

  get sessionToken(): string | null {
    return this.read("session");
  }

  set sessionToken(value: string | null) {
    if (value) this.write("session", value);
    else this.remove("session");
  }

  get lastSeq(): number {
    const raw = this.read("lastSeq");
    const value = raw ? Number(raw) : 0;
    return Number.isFinite(value) ? value : 0;
  }

  set lastSeq(value: number) {
    this.write("lastSeq", String(value));
  }

  get opened(): boolean {
    return this.read("opened") === "1";
  }

  set opened(value: boolean) {
    this.write("opened", value ? "1" : "0");
  }

  get pending(): PendingMessage[] {
    const raw = this.read("pending");
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as PendingMessage[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  set pending(value: PendingMessage[]) {
    this.write("pending", JSON.stringify(value.slice(-20)));
  }

  addPending(message: PendingMessage): void {
    const list = this.pending.filter((m) => m.clientMsgId !== message.clientMsgId);
    list.push(message);
    this.pending = list;
  }

  removePending(clientMsgId: string): void {
    this.pending = this.pending.filter((m) => m.clientMsgId !== clientMsgId);
  }

  clearSession(): void {
    this.remove("session");
    this.remove("visitor");
    this.remove("lastSeq");
    this.remove("pending");
  }
}

export function randomId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    /* ниже запасной вариант */
  }
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
