/**
 * Socket.IO: два пространства имён.
 *  • /client — виджет и мобильный SDK, авторизация по session_token;
 *  • /panel  — панель оператора, авторизация по access-токену из cookie.
 *
 * Сервер не хранит состояние переписки в памяти: после переподключения клиент
 * присылает last_seq и добирает пропущенное из MySQL.
 */
import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import {
  CLIENT_NAMESPACE,
  ClientCommands,
  ClientEvents,
  PANEL_NAMESPACE,
  PanelCommands,
  PanelEvents,
  type ClientSyncRequest,
} from "@sova/shared";
import { config } from "../config.js";
import { idToString } from "../infra/db.js";
import { moduleLogger } from "../infra/logger.js";
import { resolveClientSession } from "../modules/auth/client-session.service.js";
import { assertSessionActive, verifyAccessToken } from "../modules/auth/operator-auth.service.js";
import {
  getConversationRow,
  requireConversationRow,
} from "../modules/conversations/conversation.service.js";
import { listMessagesForClient } from "../modules/messages/message.service.js";
import { subscribeEvents, type BusEvent } from "./bus.js";
import { activityError, agentIsTyping, readPresence, setPresence, setTyping } from './activity.js';

const log = moduleLogger("socket");

let io: Server | null = null;
let unsubscribe: (() => Promise<void>) | null = null;

export const PANEL_ROOM = "panel:all";

export function clientRoom(conversationId: string): string {
  return `conv:${conversationId}`;
}

export function disconnectChannelClients(channelId: string): void {
  io?.of(CLIENT_NAMESPACE).in(`channel:${channelId}`).disconnectSockets(true);
}

export function getIo(): Server {
  if (!io) throw new Error("Socket.IO не инициализирован");
  return io;
}

export function initSocketServer(httpServer: HttpServer, path = '/socket.io'): Server {
  io = new Server(httpServer, {
    path,
    serveClient: false,
    cors: {
      // Виджет работает на сайтах клиентов; проверка домена выполняется
      // при создании сессии, а сокет дополнительно проверяет session_token.
      origin: true,
      credentials: true,
    },
    pingInterval: 25_000,
    pingTimeout: 20_000,
    maxHttpBufferSize: 1e6,
  });

  setupClientNamespace(io);
  setupPanelNamespace(io);

  unsubscribe = subscribeEvents(dispatchBusEvent);

  log.info("Socket.IO запущен");
  return io;
}

function dispatchBusEvent(event: BusEvent): void {
  if (!io) return;
  if (event.target.scope === "client") {
    io.of(CLIENT_NAMESPACE).to(clientRoom(event.target.conversationId)).emit(event.event, event.payload);
  } else {
    io.of(PANEL_NAMESPACE).to(PANEL_ROOM).emit(event.event, event.payload);
  }
}

interface ClientSocketData {
  conversationId: string;
  endUserId: string;
  channelId: string;
}

function setupClientNamespace(server: Server): void {
  const nsp = server.of(CLIENT_NAMESPACE);

  nsp.use(async (socket, next) => {
    try {
      const token = String(socket.handshake.auth?.token ?? "");
      const conversationId = String(socket.handshake.auth?.conversationId ?? "");
      if (!token || !conversationId) return next(new Error("Нет данных авторизации"));

      const session = await resolveClientSession(token);
      const conversation = await getConversationRow(conversationId);
      if (!conversation) return next(new Error("Диалог не найден"));

      // Диалог обязан принадлежать этому пользователю и этому каналу.
      if (
        idToString(conversation.end_user_id) !== idToString(session.endUser.id) ||
        idToString(conversation.channel_id) !== idToString(session.channel.id)
      ) {
        return next(new Error("Нет доступа к диалогу"));
      }

      const data: ClientSocketData = {
        conversationId,
        endUserId: idToString(session.endUser.id),
        channelId: idToString(session.channel.id),
      };
      socket.data = data;
      next();
    } catch (err) {
      log.warn({ err: String(err) }, "Отказ в подключении клиента");
      next(new Error("Не авторизовано"));
    }
  });

  nsp.on("connection", (socket: Socket) => {
    const data = socket.data as ClientSocketData;
    void socket.join(clientRoom(data.conversationId));
    void socket.join(`channel:${data.channelId}`);
    let visible = socket.handshake.auth?.visible !== false;
    let presenceChangedAt = 0, lastTyping = 0, userTyping = false;
    let presenceTimer: ReturnType<typeof setTimeout> | undefined;
    const touch = () => setPresence(data.endUserId, socket.id, visible ? 'online' : 'away').catch(activityError);
    void touch();
    const heartbeat = setInterval(() => void touch(), 25_000);
    heartbeat.unref();
    socket.on(ClientCommands.Presence, (payload: { visible?: boolean }) => {
      if (typeof payload?.visible !== 'boolean') return;
      visible = payload.visible;
      if (presenceTimer) clearTimeout(presenceTimer);
      if (Date.now() - presenceChangedAt < 500) {
        presenceTimer = setTimeout(() => { presenceChangedAt = Date.now(); void touch(); }, 500);
        return;
      }
      presenceChangedAt = Date.now();
      void touch();
    });

    void (async () => {
      const conversation = await getConversationRow(data.conversationId);
      socket.emit(ClientEvents.Ready, {
        conversationId: data.conversationId,
        status: conversation?.status ?? "ai",
        language: conversation?.language ?? null,
        lastSeq: Number(conversation?.last_seq ?? 0),
      });
      socket.emit(ClientEvents.Typing, { conversationId: data.conversationId, who: 'agent', active: await agentIsTyping(data.conversationId) });
    })().catch(activityError);

    socket.on(ClientCommands.Sync, async (payload: ClientSyncRequest, ack?: (res: unknown) => void) => {
      try {
        const conversation = await requireConversationRow(data.conversationId);
        const messages = await listMessagesForClient(
          data.conversationId,
          conversation.language,
          { afterSeq: Number(payload?.lastSeq ?? 0), limit: 100 },
        );
        ack?.({ ok: true, messages, status: conversation.status });
      } catch (err) {
        ack?.({ ok: false, error: String(err) });
      }
    });

    socket.on(ClientCommands.Typing, (payload?: { active?: boolean }) => {
      const active = payload?.active !== false;
      if (active && Date.now() - lastTyping < 1500) return;
      if (!active && !userTyping) return;
      if (active) lastTyping = Date.now();
      userTyping = active;
      void setTyping(data.conversationId, 'user', socket.id, active).catch(activityError);
    });

    socket.on("disconnect", () => {
      clearInterval(heartbeat);
      if (presenceTimer) clearTimeout(presenceTimer);
      void setPresence(data.endUserId, socket.id, 'offline').catch(activityError);
      if (userTyping) void setTyping(data.conversationId, 'user', socket.id, false).catch(activityError);
      log.debug({ conversationId: data.conversationId }, "Клиент отключился");
    });
  });
}

interface PanelSocketData {
  operatorId: string;
}

function parseCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  const parts = header.split(";");
  for (const part of parts) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

function setupPanelNamespace(server: Server): void {
  const nsp = server.of(PANEL_NAMESPACE);

  nsp.use(async (socket, next) => {
    try {
      const fromAuth = socket.handshake.auth?.token
        ? String(socket.handshake.auth.token)
        : null;
      const fromCookie = parseCookie(socket.handshake.headers.cookie, "sova_at");
      const token = fromAuth ?? fromCookie;
      if (!token) return next(new Error("Нет токена"));

      const payload = verifyAccessToken(token);
      await assertSessionActive(payload.sid);
      socket.data = { operatorId: payload.sub } satisfies PanelSocketData;
      next();
    } catch {
      next(new Error("Не авторизовано"));
    }
  });

  nsp.on("connection", (socket: Socket) => {
    const data = socket.data as PanelSocketData;
    void socket.join(PANEL_ROOM);
    socket.emit(PanelEvents.Ready, { operatorId: data.operatorId, serverTime: new Date().toISOString() });
    let lastPresence = 0, lastTyping = 0, typingConversation: string | null = null;
    let typingTask = Promise.resolve();
    socket.on(PanelCommands.Presence, (payload: { endUserIds?: unknown }, ack?: (res: unknown) => void) => {
      if (typeof ack !== 'function') return;
      if (Date.now() - lastPresence < 500) { ack({ ok: false }); return; }
      lastPresence = Date.now();
      const ids = Array.isArray(payload?.endUserIds) ? [...new Set(payload.endUserIds.filter((id): id is string => typeof id === 'string' && /^\d{1,20}$/.test(id)))].slice(0, 101) : [];
      void readPresence(ids).then(items => ack({ ok: true, items })).catch(() => ack({ ok: false }));
    });

    socket.on(PanelCommands.SubscribeConversation, (payload: { conversationId?: string }) => {
      if (payload?.conversationId) void socket.join(`panel:conv:${payload.conversationId}`);
    });

    socket.on(PanelCommands.UnsubscribeConversation, (payload: { conversationId?: string }) => {
      if (payload?.conversationId) void socket.leave(`panel:conv:${payload.conversationId}`);
    });

    socket.on(PanelCommands.Typing, (payload: { conversationId?: string; active?: boolean }) => {
      if (typeof payload?.conversationId !== 'string' || !/^\d{1,20}$/.test(payload.conversationId)) return;
      const active = payload.active !== false, id = payload.conversationId;
      if (active && Date.now() - lastTyping < 1500) return;
      if (active) lastTyping = Date.now();
      typingTask = typingTask.then(async () => {
        if (!active) {
          if (typingConversation === id) { typingConversation = null; await setTyping(id, 'agent', socket.id, false); }
          return;
        }
        const conversation = await getConversationRow(id);
        if (!socket.connected || !conversation || conversation.status === 'closed') return;
        if (typingConversation && typingConversation !== id) await setTyping(typingConversation, 'agent', socket.id, false);
        typingConversation = id;
        await setTyping(id, 'agent', socket.id, true);
      }).catch(activityError);
    });
    socket.on('disconnect', () => {
      typingTask = typingTask.then(async () => {
        if (typingConversation) await setTyping(typingConversation, 'agent', socket.id, false);
        typingConversation = null;
      }).catch(activityError);
    });
  });
}

export async function closeSocketServer(): Promise<void> {
  if (unsubscribe) {
    await unsubscribe();
    unsubscribe = null;
  }
  if (io) {
    await new Promise<void>((resolve) => io?.close(() => resolve()));
    io = null;
  }
}

export const socketPath = "/socket.io";
export const panelUrlForLinks = config.panelUrl;
