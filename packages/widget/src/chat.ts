/**
 * Логика виджета: сессия, история, сокет, отправка с повторами.
 *
 * Гарантии:
 *  • каждое сообщение имеет clientMsgId — повторная отправка не создаёт дубль;
 *  • неотправленные сообщения сохраняются и уходят после восстановления связи;
 *  • история восстанавливается после перезагрузки страницы по lastSeq.
 */
import { io, type Socket } from "socket.io-client";
import {
  CLIENT_NAMESPACE,
  ClientCommands,
  ClientEvents,
  DEFAULT_WIDGET_SETTINGS,
  type ClientMessageDto,
  type ConversationStatus,
  type WidgetSettings,
} from "@sova/shared";
import { WidgetApi } from "./api.js";
import { detectBrowserLocale, pickStrings, type WidgetStrings } from "./i18n.js";
import { randomId, WidgetStorage } from "./storage.js";
import { WidgetUi, type UiMessage } from "./ui.js";
import { ReadReceiptQueue } from './read-receipts.js';

export interface ChatOptions {
  serverUrl: string;
  channelPublicId: string;
  authToken?: string;
  autoOpen?: boolean;
}

export class SovaChat {
  private readonly api: WidgetApi;
  private readonly storage: WidgetStorage;
  private ui: WidgetUi | null = null;
  private socket: Socket | null = null;
  private settings: WidgetSettings = DEFAULT_WIDGET_SETTINGS;
  private strings: WidgetStrings;
  private conversationId: string | null = null;
  private status: ConversationStatus = "ai";
  private unread = 0;
  private greetingShown = false;
  private destroyed = false;
  private sessionReady = false;
  private readonly reads = new ReadReceiptQueue(
    () => this.sessionReady && !this.destroyed && !!this.ui?.isOpen() && document.visibilityState === 'visible' && document.hasFocus(),
    ids => this.api.read(ids),
  );
  private readonly onFocusRead = () => this.reads.wake();
  private localizationTimer: number | null = null;
  private mediaUrls=new Map<string,string>();
  private mediaEpoch=0;

  private clearMedia():void {this.mediaEpoch++;for(const url of this.mediaUrls.values())URL.revokeObjectURL(url);this.mediaUrls.clear();}
  private async loadAttachment(id:string):Promise<string> {
    const cached=this.mediaUrls.get(id);if(cached)return cached;
    const epoch=this.mediaEpoch;const blob=await this.api.attachment(id);
    if(epoch!==this.mediaEpoch||this.destroyed)throw new Error('Session changed');
    const concurrent=this.mediaUrls.get(id);if(concurrent)return concurrent;
    while(this.mediaUrls.size>=4){const first=this.mediaUrls.entries().next().value!;URL.revokeObjectURL(first[1]);this.mediaUrls.delete(first[0]);}
    const url=URL.createObjectURL(blob);this.mediaUrls.set(id,url);return url;
  }
  private messages: UiMessage[] = [];
  private typingTimer: number | null = null;
  private lastTypingSent = 0;
  private userTyping = false;
  private userTypingTimer: number | null = null;
  private readonly onVisibility = () => {
    this.reads.wake();
    if (this.socket?.connected) this.socket.volatile.emit(ClientCommands.Presence, { visible: document.visibilityState === 'visible' });
    if (document.visibilityState !== 'visible') this.sendTyping(false);
  };
  private readonly onBlur = () => this.sendTyping(false);
  private clearAgentTyping(): void {
    if (this.typingTimer !== null) window.clearTimeout(this.typingTimer);
    this.typingTimer = null;
    this.ui?.setAgentTyping(false);
  }

  constructor(private readonly options: ChatOptions) {
    this.api = new WidgetApi(options.serverUrl);
    this.storage = new WidgetStorage(options.channelPublicId);
    this.strings = pickStrings(detectBrowserLocale());
  }

  async init(): Promise<void> {
    const config = await this.api.config(this.options.channelPublicId, detectBrowserLocale());
    this.settings = config.settings;
    this.strings = pickStrings(
      this.settings.locale && this.settings.locale !== "auto"
        ? this.settings.locale
        : detectBrowserLocale(),
    );

    this.ui = new WidgetUi(this.settings, this.strings, {
      onRead: ids => this.reads.add(ids),
      onLoadAttachment:id=>this.loadAttachment(id),
      onSend: (text, files) => void this.handleSend(text, files),
      onToggle: (open) => {
        if (!open) this.sendTyping(false);
        this.storage.opened = open;
        if (open) {
          this.reads.wake();
          this.unread = 0;
          this.ui?.setUnread(0);
          if (this.sessionReady) void this.syncHistory();
        }
      },
      onTyping: active => this.sendTyping(active),
      onRetry: (clientMsgId) => void this.retryPending(clientMsgId),
    });
    this.ui.mount();
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('focus', this.onFocusRead);

    if (this.options.autoOpen || this.storage.opened) this.ui.setOpen(true);

    await this.startSession();
    if (config.localization?.status === "pending") this.retryLocalization(0);
  }

  /* ── Сессия и история ── */

  private async startSession(): Promise<void> {
    this.sessionReady = false;
    this.ui?.setConnection("connecting");
    try {
      const existingToken = this.storage.sessionToken;
      if (existingToken) {
        this.api.setToken(existingToken);
        try {
          await this.loadHistory();
          this.sessionReady = true;
          this.reads.wake();
          this.connectSocket();
          return;
        } catch (err) {
          // Сессия истекла или отозвана — создадим новую.
          if (!isAuthError(err)) throw err;
          this.storage.sessionToken = null;
          this.api.setToken(null);
        }
      }

      const session = await this.api.createSession({
        channelPublicId: this.options.channelPublicId,
        visitorKey: this.storage.visitorKey ?? undefined,
        authToken: this.options.authToken,
        languageHint: detectBrowserLocale(),
      });

      this.storage.sessionToken = session.sessionToken;
      this.storage.visitorKey = session.visitorKey;
      this.api.setToken(session.sessionToken);
      this.settings = { ...this.settings, ...(session.widget.settings as Partial<WidgetSettings>) };
      this.strings = session.widget.strings ?? pickStrings(this.settings.locale);
      this.ui?.applySettings(this.settings, this.strings);

      this.conversationId = session.conversation.id || null;
      this.status = session.conversation.status;

      await this.loadHistory();
      this.sessionReady = true;
      this.reads.wake();
      this.connectSocket();
      await this.flushPending();
    } catch (err) {
      this.ui?.setConnection("offline");
      this.ui?.showError(describeError(err));
    }
  }

  private async loadHistory(): Promise<void> {
    const history = await this.api.history(0, this.settings.locale);
    this.conversationId = history.conversationId;
    this.status = history.status;
    this.storage.lastSeq = history.lastSeq;

    this.messages = history.messages.map(toUiMessage);

    // Сообщения, которые не успели уйти, показываем как «отправляется».
    for (const pending of this.storage.pending) {
      if (this.messages.some((m) => m.clientMsgId === pending.clientMsgId)) continue;
      this.messages.push({
        id: pending.clientMsgId,
        clientMsgId: pending.clientMsgId,
        author: "user",
        text: pending.text,
        createdAt: new Date(pending.createdAt).toISOString(),
        status: "sending",
      });
    }

    if (this.messages.length === 0 && this.settings.greeting && !this.greetingShown) {
      this.greetingShown = true;
      this.messages.push({
        id: "greeting",
        author: "agent",
        text: this.settings.greeting,
        createdAt: new Date().toISOString(),
      });
    }

    this.ui?.renderMessages(this.messages);
  }

  /** Добираем пропущенное после переподключения — без дублей, по lastSeq. */
  private async syncHistory(): Promise<void> {
    if (!this.storage.sessionToken) return;
    try {
      const history = await this.api.history(this.storage.lastSeq, this.settings.locale);
      this.status = history.status;
      if (history.conversationId) this.conversationId = history.conversationId;
      for (const message of history.messages) {
        this.applyIncoming(message);
      }
      if (history.lastSeq > this.storage.lastSeq) this.storage.lastSeq = history.lastSeq;
    } catch (err) {
      if (isAuthError(err)) {
        this.storage.sessionToken = null;
        await this.startSession();
      }
    }
  }

  /* ── Сокет ── */

  private connectSocket(): void {
    if (this.destroyed) return;
    const token = this.storage.sessionToken;
    if (!token || !this.conversationId) {
      // Диалога ещё нет — соединение установим после первого сообщения.
      this.ui?.setConnection("online");
      return;
    }

    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.clearAgentTyping();
    this.userTyping = false;
    this.lastTypingSent = 0;

    const serverUrl = new URL(this.options.serverUrl);
    const socket = io(`${serverUrl.origin}${CLIENT_NAMESPACE}`, {
      path: `${serverUrl.pathname.replace(/\/+$/, "")}/socket.io`,
      transports: ["websocket", "polling"],
      auth: { token, conversationId: this.conversationId, visible: document.visibilityState === 'visible' },
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10_000,
      withCredentials: false,
    });

    socket.on("connect", () => {
      this.reads.wake();
      this.onVisibility();
      this.ui?.setConnection("online");
      void this.syncHistory();
      void this.flushPending();
    });

    socket.on("disconnect", () => { this.ui?.setConnection("offline"); this.clearAgentTyping(); this.userTyping = false; });
    socket.on("connect_error", () => this.ui?.setConnection("offline"));

    socket.on(ClientEvents.Message, (payload: { message: ClientMessageDto }) => {
      if (payload.message.author !== 'user') this.clearAgentTyping();
      this.applyIncoming(payload.message);
      if (payload.message.author !== "user" && !this.ui?.isOpen()) {
        this.unread += 1;
        this.ui?.setUnread(this.unread);
      }
    });

    socket.on(ClientEvents.ConversationStatus, (payload: { status: ConversationStatus }) => {
      this.status = payload.status;
      this.clearAgentTyping();
      if (payload.status === 'closed') this.sendTyping(false);
    });

    socket.on(ClientEvents.Typing, (payload: { who: string; active?: boolean }) => {
      if (payload.who !== "agent") return;
      if (payload.active === false || this.status === 'closed') { this.clearAgentTyping(); return; }
      this.ui?.setAgentTyping(true);
      if (this.typingTimer) window.clearTimeout(this.typingTimer);
      this.typingTimer = window.setTimeout(() => this.clearAgentTyping(), 6000);
    });

    this.socket = socket;
  }

  private sendTyping(active = true): void {
    if (this.userTypingTimer !== null) window.clearTimeout(this.userTypingTimer);
    if (!this.socket?.connected) { this.userTyping = false; return; }
    if (active && (!this.ui?.isOpen() || document.visibilityState !== 'visible')) return;
    if (active) this.userTypingTimer = window.setTimeout(() => this.sendTyping(false), 3000);
    const now = Date.now();
    if (active && now - this.lastTypingSent < 2000) return;
    if (!active && !this.userTyping) return;
    if (active) this.lastTypingSent = now;
    this.userTyping = active;
    this.socket.volatile.emit(ClientCommands.Typing, { active });
  }

  /* ── Отправка ── */

  private async handleSend(text: string, files: File[]): Promise<void> {
    this.sendTyping(false);
    const clientMsgId = randomId();
    const attachmentIds: string[] = [];

    for (const file of files.slice(0, 1)) {
      try {
        const uploaded = await this.uploadFile(file);
        if (uploaded) attachmentIds.push(uploaded.id);
      } catch (err) {
        this.ui?.showError(describeError(err));
        return;
      }
    }

    const optimistic: UiMessage = {
      id: clientMsgId,
      clientMsgId,
      author: "user",
      text,
      createdAt: new Date().toISOString(),
      status: "sending",
    };
    this.messages.push(optimistic);
    this.ui?.appendMessage(optimistic);

    this.storage.addPending({
      clientMsgId,
      text,
      attachmentIds,
      createdAt: Date.now(),
    });

    await this.deliver(clientMsgId, text, attachmentIds);
  }

  private async deliver(
    clientMsgId: string,
    text: string,
    attachmentIds: string[],
  ): Promise<void> {
    try {
      if (!this.storage.sessionToken) await this.startSession();

      const res = await this.api.send({
        clientMsgId,
        text,
        attachmentIds,
        languageHint: detectBrowserLocale(),
      });

      this.storage.removePending(clientMsgId);

      const isNewConversation = res.conversationId !== this.conversationId;
      this.conversationId = res.conversationId;
      this.status = res.conversationStatus;

      if (res.message) {
        this.applyIncoming(res.message, clientMsgId);
      } else {
        this.updateStatus(clientMsgId, "sent");
      }

      // Первое сообщение создало диалог — подключаем сокет.
      if (!this.socket || isNewConversation) this.connectSocket();
    } catch (err) {
      if((err as {status?:number})?.status===423){this.storage.removePending(clientMsgId);this.updateStatus(clientMsgId,'failed');this.ui?.showError(describeError(err));return;}
      if (isAuthError(err)) {
        this.storage.sessionToken = null;
        this.api.setToken(null);
        await this.startSession();
        // После восстановления сессии повторим отправку один раз.
        try {
          await this.api.send({ clientMsgId, text, attachmentIds });
          this.storage.removePending(clientMsgId);
          this.updateStatus(clientMsgId, "sent");
          return;
        } catch {
          /* ниже пометим как неудачу */
        }
      }
      this.updateStatus(clientMsgId, "failed");
      this.ui?.showError(describeError(err));
    }
  }

  /** Повторная отправка всех неотправленных сообщений (после восстановления связи). */
  private async flushPending(): Promise<void> {
    const pending = this.storage.pending;
    for (const message of pending) {
      await this.deliver(message.clientMsgId, message.text, message.attachmentIds);
    }
  }

  private async retryPending(clientMsgId: string): Promise<void> {
    const message = this.storage.pending.find((m) => m.clientMsgId === clientMsgId);
    if (!message) return;
    this.updateStatus(clientMsgId, "sending");
    await this.deliver(message.clientMsgId, message.text, message.attachmentIds);
  }

  private async uploadFile(file: File): Promise<{ id: string; url: string; fileName: string } | null> {
    if (!this.settings.allowAttachments) return null;
    if (!['image/png','image/jpeg','image/gif','image/webp','video/mp4','video/webm'].includes(file.type)) {
      this.ui?.showError(this.strings.imageRejected);
      return null;
    }
    if (!this.storage.sessionToken) await this.startSession();
    return this.api.upload(file);
  }

  /* ── Приём сообщений ── */

  private applyIncoming(message: ClientMessageDto, matchClientMsgId?: string): void {
    const clientMsgId = message.clientMsgId ?? matchClientMsgId;
    const ui = toUiMessage(message);
    if (clientMsgId) ui.clientMsgId = clientMsgId;

    const index = this.messages.findIndex(
      (m) => (clientMsgId && m.clientMsgId === clientMsgId) || m.id === ui.id,
    );
    if (index >= 0) this.messages[index] = ui;
    else this.messages.push(ui);

    // Приветствие убираем, как только появились настоящие сообщения.
    if (this.messages.length > 1) {
      this.messages = this.messages.filter((m) => m.id !== "greeting");
    }

    this.ui?.appendMessage(ui);
    if (message.seq > this.storage.lastSeq) this.storage.lastSeq = message.seq;
  }

  private updateStatus(clientMsgId: string, status: UiMessage["status"]): void {
    const message = this.messages.find((m) => m.clientMsgId === clientMsgId);
    if (!message) return;
    message.status = status;
    this.ui?.appendMessage(message);
  }

  /* ── Публичные методы ── */

  open(): void {
    this.ui?.setOpen(true);
  }

  close(): void {
    this.ui?.setOpen(false);
  }

  toggle(): void {
    this.ui?.setOpen(!this.ui.isOpen());
  }

  unreadCount(): number {
    return this.unread;
  }

  /** Текущее состояние диалога — полезно хост-странице (например, для аналитики). */
  conversationStatus(): ConversationStatus {
    return this.status;
  }

  /** Подключение подтверждённого пользователя: токен подписан вашим бекендом. */
  async identify(authToken: string): Promise<void> {
    this.reads.reset();
    this.sessionReady = false;
    this.clearMedia();
    this.storage.clearSession();
    this.api.setToken(null);
    (this.options as { authToken?: string }).authToken = authToken;
    this.socket?.close();
    this.socket = null;
    await this.startSession();
  }

  /** Выход из аккаунта: сессия отзывается, локальные данные очищаются. */
  async logout(): Promise<void> {
    this.reads.reset();
    this.sessionReady = false;
    this.clearMedia();
    try {
      if (this.storage.sessionToken) await this.api.logout();
    } catch {
      /* даже при ошибке чистим локальные данные */
    }
    this.storage.clearSession();
    this.api.setToken(null);
    this.conversationId = null;
    this.messages = [];
    this.ui?.clearMessages();
    this.socket?.close();
    this.socket = null;
    (this.options as { authToken?: string }).authToken = undefined;
    await this.startSession();
  }

  private retryLocalization(attempt: number): void {
    if (this.destroyed || attempt >= 40) return;
    this.localizationTimer = window.setTimeout(async () => {
      try {
        const config = await this.api.config(this.options.channelPublicId, detectBrowserLocale());
        if (this.destroyed) return;
        if (config.localization?.status === 'pending') { this.retryLocalization(attempt + 1); return; }
        this.settings = config.settings;
        this.strings = config.strings ?? pickStrings(this.settings.locale);
        this.ui?.applySettings(this.settings, this.strings);
        this.messages = this.messages.map(m => m.id === 'greeting' ? { ...m, text: this.settings.greeting } : m);
        this.ui?.renderMessages(this.messages);
        await this.syncHistory();
      } catch { this.retryLocalization(attempt + 1); }
    }, 3000);
  }

  destroy(): void {
    this.reads.reset();
    window.removeEventListener('focus', this.onFocusRead);
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('blur', this.onBlur);
    this.sendTyping(false);
    if (this.userTypingTimer !== null) window.clearTimeout(this.userTypingTimer);
    this.clearAgentTyping();
    if (this.localizationTimer !== null) window.clearTimeout(this.localizationTimer);
    this.clearMedia();
    this.destroyed = true;
    this.socket?.close();
    this.ui?.destroy();
  }
}

function toUiMessage(message: ClientMessageDto): UiMessage {
  return {
    id: message.id,
    clientMsgId: message.clientMsgId ?? undefined,
    author: message.author === "user" ? "user" : message.author === "system" ? "system" : "agent",
    text: message.text,
    createdAt: message.createdAt,
    status: "sent",
    attachments: message.attachments?.map((a) => ({
      mime:a.mime,
      id: a.id,
      url: a.url,
      fileName: a.fileName,
    })),
  };
}

function isAuthError(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status;
  return status === 401 || status === 403;
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Не удалось выполнить запрос";
}
