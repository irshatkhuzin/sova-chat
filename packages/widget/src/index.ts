/**
 * Точка входа виджета.
 *
 * Подключение одной строкой:
 *   <script src="https://CHAT_DOMAIN/widget.js" data-channel-id="PUBLIC_CHANNEL_ID" async></script>
 *
 * Дополнительные атрибуты:
 *   data-auth-token  — подписанный вашим бекендом токен пользователя;
 *   data-server      — адрес сервера, если он отличается от адреса скрипта;
 *   data-auto-open   — "1", чтобы открыть окно сразу.
 *
 * После загрузки доступен объект window.SovaChat:
 *   SovaChat.open() / close() / toggle()
 *   SovaChat.identify(authToken)
 *   SovaChat.logout()
 *   SovaChat.unread()
 */
import { SovaChat, type ChatOptions } from "./chat.js";

interface SovaChatGlobal {
  open: () => void;
  close: () => void;
  toggle: () => void;
  identify: (authToken: string) => Promise<void>;
  logout: () => Promise<void>;
  unread: () => number;
  /** Состояние текущего обращения: ai | waiting_operator | operator | closed. */
  status: () => string;
  destroy: () => void;
  /** Ручная инициализация, если скрипт подключён без data-channel-id. */
  init: (options: ChatOptions) => Promise<void>;
  ready: boolean;
}

declare global {
  interface Window {
    SovaChat?: SovaChatGlobal;
  }
}

let instance: SovaChat | null = null;

function currentScript(): HTMLScriptElement | null {
  if (document.currentScript instanceof HTMLScriptElement) return document.currentScript;
  const scripts = Array.from(document.getElementsByTagName("script"));
  return scripts.find((s) => s.src && /widget(\.min)?\.js(\?|$)/.test(s.src)) ?? null;
}

function serverUrlFromScript(script: HTMLScriptElement | null): string {
  const explicit = script?.getAttribute("data-server");
  if (explicit) return explicit.replace(/\/+$/, "");
  if (script?.src) {
    try {
      const url = new URL(script.src, window.location.href);
      return new URL(".", url).href.replace(/\/+$/, "");
    } catch {
      /* ниже запасной вариант */
    }
  }
  return window.location.origin;
}

async function boot(options: ChatOptions): Promise<void> {
  if (instance) instance.destroy();
  instance = new SovaChat(options);
  await instance.init();
  if (window.SovaChat) window.SovaChat.ready = true;
}

const globalApi: SovaChatGlobal = {
  open: () => instance?.open(),
  close: () => instance?.close(),
  toggle: () => instance?.toggle(),
  identify: async (authToken: string) => {
    await instance?.identify(authToken);
  },
  logout: async () => {
    await instance?.logout();
  },
  unread: () => instance?.unreadCount() ?? 0,
  status: () => instance?.conversationStatus() ?? "ai",
  destroy: () => {
    instance?.destroy();
    instance = null;
  },
  init: boot,
  ready: false,
};

window.SovaChat = globalApi;

const script = currentScript();
const channelId = script?.getAttribute("data-channel-id");

if (channelId) {
  const options: ChatOptions = {
    serverUrl: serverUrlFromScript(script),
    channelPublicId: channelId,
    autoOpen: script?.getAttribute("data-auto-open") === "1",
  };
  const authToken = script?.getAttribute("data-auth-token");
  if (authToken) options.authToken = authToken;

  const start = () => {
    void boot(options).catch((err: unknown) => {
      // Ошибка виджета не должна ломать сайт клиента.
      // eslint-disable-next-line no-console
      console.warn("[Sova] Виджет не запустился:", err);
    });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
}
