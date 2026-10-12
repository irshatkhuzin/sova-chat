/**
 * Основной экран: список диалогов, переписка, панель сведений.
 * Обновления приходят по сокету; при обрыве соединения показывается предупреждение,
 * а после восстановления данные перезагружаются.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  PanelEvents,
  type ChannelDto,
  type ConversationDetailDto,
  type ConversationListItemDto,
  type InternalNoteDto,
  type PanelMessageDto,
  type MessageReadReceipt,
} from "@sova/shared";
import type { AppContext } from "../App";
import { api, ApiError } from "../lib/api";
import { getPanelSocket } from "../lib/socket";
import { sortConversations, canMarkRead } from "../lib/inbox-order";
import { useActivity } from '../lib/use-activity';
import { ConversationList, type Filters } from "../components/ConversationList";
import { MessageThread } from "../components/MessageThread";
import { DetailsPanel } from "../components/DetailsPanel";

const DEFAULT_FILTERS: Filters = {
  productId: "",
  channelId: "",
  statuses: [],
  onlyUnread: false,
  search: "",
};

export function InboxPage({ ctx }: { ctx: AppContext }) {
  const params = useParams();
  const navigate = useNavigate();
  const selectedId = params.id ?? null;

  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [items, setItems] = useState<ConversationListItemDto[]>([]);
  const [total, setTotal] = useState(0);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [channels, setChannels] = useState<ChannelDto[]>([]);

  const [conversation, setConversation] = useState<ConversationDetailDto | null>(null);
  const [otherConversations, setOtherConversations] = useState<ConversationListItemDto[]>([]);
  const [messages, setMessages] = useState<PanelMessageDto[]>([]);
  const [notes, setNotes] = useState<InternalNoteDto[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [connected, setConnected] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const activity = useActivity([...items.map(item => item.endUserId), ...(conversation ? [conversation.endUserId] : [])]);

  const selectedRef = useRef<string | null>(selectedId);
  selectedRef.current = selectedId;
  const loadedConversationRef = useRef<string | null>(conversation?.id ?? null);
  loadedConversationRef.current = conversation?.id ?? null;

  const listRequest = useRef(0);
  const threadRequest = useRef(0);

  /* ── Загрузка списка ── */
  const loadList = useCallback(async (silent = false) => {
    const request = ++listRequest.current;
    if (!silent) setListLoading(true);
    setListError(null);
    try {
      const res = await api.conversations({
        productId: filters.productId || undefined,
        channelId: filters.channelId || undefined,
        status: filters.statuses.length ? filters.statuses.join(",") : undefined,
        unread: filters.onlyUnread ? "1" : undefined,
        search: filters.search.trim().length >= 2 ? filters.search.trim() : undefined,
        limit: "100",
      });
      if (request !== listRequest.current) return;
      setItems(sortConversations(res.items));
      setTotal(res.total);
    } catch (err) {
      if (request === listRequest.current) setListError(err instanceof ApiError ? err.message : "Не удалось загрузить диалоги");
    } finally {
      if (request === listRequest.current) setListLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    const timer = setTimeout(() => void loadList(), filters.search ? 350 : 0);
    return () => { clearTimeout(timer); listRequest.current++; };
  }, [loadList, filters.search]);

  useEffect(() => {
    void api
      .channels()
      .then((res) => setChannels(res.channels))
      .catch(() => setChannels([]));
  }, []);

  /* ── Загрузка выбранного диалога ── */
  const loadConversation = useCallback(async (id: string) => {
    const request = ++threadRequest.current;
    // Focus/reconnect refreshes must not replace an already open thread with
    // a spinner: doing so destroys its scroll position and interrupts reading.
    if (loadedConversationRef.current !== id) setThreadLoading(true);
    try {
      const [detail, thread, noteList] = await Promise.all([
        api.conversation(id),
        api.messages(id),
        api.notes(id),
      ]);
      if (request !== threadRequest.current || selectedRef.current !== id) return;
      setConversation(detail.conversation);
      setOtherConversations(detail.otherConversations);
      setMessages(prev => thread.messages.map(m => ({ ...m, clientReadAt: m.clientReadAt ?? prev.find(old => old.id === m.id)?.clientReadAt ?? null })));
      setNotes(noteList.notes);
      setThreadLoading(false);
      if (canMarkRead(selectedRef.current, id, document.visibilityState, document.hasFocus())) {
        await api.markRead(id).catch(() => undefined);
      }
    } catch (err) {
      if (selectedRef.current === id) setToast(err instanceof ApiError ? err.message : "Не удалось открыть диалог");
    } finally {
      if (request === threadRequest.current) setThreadLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setConversation(null);
      setMessages([]);
      setNotes([]);
      return;
    }
    void loadConversation(selectedId);
    return () => { threadRequest.current++; };
  }, [selectedId, loadConversation]);

  useEffect(() => {
    const onFocus = () => {
      const id = selectedRef.current;
      if (id && canMarkRead(id, id, document.visibilityState, document.hasFocus())) void loadConversation(id);
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => { window.removeEventListener("focus", onFocus); document.removeEventListener("visibilitychange", onFocus); };
  }, [loadConversation]);

  /* ── Realtime ── */
  useEffect(() => {
    const socket = getPanelSocket();

    let listTimer: ReturnType<typeof setTimeout> | undefined;
    const upsertItem = (incoming: ConversationListItemDto) => {
      if (listTimer) clearTimeout(listTimer);
      listTimer = setTimeout(() => void loadList(true), 200);
      setItems((prev) => {
        const rest = prev.filter((item) => item.id !== incoming.id);
        const matches = (!filters.productId || incoming.productId === filters.productId)
          && (!filters.channelId || incoming.channelId === filters.channelId)
          && (!filters.statuses.length || filters.statuses.includes(incoming.status))
          && (!filters.onlyUnread || incoming.unreadCount > 0);
        if (!matches) return rest;
        if (filters.search.trim().length >= 2 && !prev.some(item => item.id === incoming.id)) return prev;
        return sortConversations([incoming, ...rest]).slice(0, 100);
      });
    };

    const onMessage = (payload: {
      conversationId: string;
      message: PanelMessageDto;
      conversation: ConversationListItemDto;
    }) => {
      upsertItem(payload.conversation);
      if (payload.conversationId === selectedRef.current) {
        setMessages((prev) => {
          const exists = prev.some((m) => m.id === payload.message.id);
          return exists
            ? prev.map((m) => (m.id === payload.message.id ? { ...payload.message, clientReadAt: payload.message.clientReadAt ?? m.clientReadAt } : m))
            : [...prev, payload.message];
        });
        if (canMarkRead(selectedRef.current, payload.conversationId, document.visibilityState, document.hasFocus())) {
          void api.markRead(payload.conversationId).catch(() => undefined);
        }
      }
    };

    const onMessageUpdated = (payload: { conversationId: string; message: PanelMessageDto }) => {
      if (payload.conversationId !== selectedRef.current) return;
      setMessages((prev) =>
        prev.map((m) => (m.id === payload.message.id ? { ...payload.message, clientReadAt: payload.message.clientReadAt ?? m.clientReadAt } : m)),
      );
    };

    const onConversationUpdated = (payload: { conversation: ConversationListItemDto }) => {
      upsertItem(payload.conversation);
      if (payload.conversation.id === selectedRef.current) {
        setConversation((prev) =>
          prev ? { ...prev, ...payload.conversation } : prev,
        );
      }
    };

    const onHandoff = (payload: {
      conversationId: string;
      reasonRu: string;
      summaryRu: string;
      conversation: ConversationListItemDto;
    }) => {
      upsertItem(payload.conversation);
      setToast(`Новое обращение к оператору: ${payload.reasonRu}`);
      notifyOperator(payload.conversation.endUserName, payload.summaryRu);
      if (payload.conversationId === selectedRef.current) {
        void loadConversation(payload.conversationId);
      }
    };

    const onConnect=() => {
      setConnected(true);
      void loadList();
      if (selectedRef.current) void loadConversation(selectedRef.current);
    };
    const onRead = (payload: { conversationId: string; receipts: MessageReadReceipt[] }) => {
      if (payload.conversationId !== selectedRef.current) return;
      const reads = new Map(payload.receipts.map(r => [r.messageId, r.readAt]));
      setMessages(prev => prev.map(m => reads.has(m.id) ? { ...m, clientReadAt: m.clientReadAt ?? reads.get(m.id)! } : m));
    };
    const onDisconnect=() => setConnected(false);
    setConnected(socket.connected);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onDisconnect);
    socket.on(PanelEvents.Message, onMessage);
    socket.on(PanelEvents.MessageUpdated, onMessageUpdated);
    socket.on(PanelEvents.ReadReceipt, onRead);
    socket.on(PanelEvents.ConversationUpdated, onConversationUpdated);
    socket.on(PanelEvents.Handoff, onHandoff);

    return () => {
      if (listTimer) clearTimeout(listTimer);
      socket.off(PanelEvents.Message, onMessage);
      socket.off(PanelEvents.MessageUpdated, onMessageUpdated);
      socket.off(PanelEvents.ReadReceipt, onRead);
      socket.off(PanelEvents.ConversationUpdated, onConversationUpdated);
      socket.off(PanelEvents.Handoff, onHandoff);
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onDisconnect);
    };
  }, [loadList, loadConversation, filters]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      void Notification.requestPermission();
    }
  }, []);

  /* ── Действия ── */
  const handleSend = useCallback(
    async (text: string, attachmentIds: string[]) => {
      if (!selectedId) return;
      setSending(true);
      try {
        const res = await api.sendMessage(selectedId, text, attachmentIds);
        setMessages((prev) =>
          prev.some((m) => m.id === res.message.id) ? prev : [...prev, res.message],
        );
        await loadConversation(selectedId);
      } catch (err) {
        setToast(err instanceof ApiError ? err.message : "Не удалось отправить сообщение");
      } finally {
        setSending(false);
      }
    },
    [selectedId, loadConversation],
  );

  const handleAction = useCallback(
    async (action: "take" | "return" | "close") => {
      if (!selectedId) return;
      try {
        const res =
          action === "take"
            ? await api.take(selectedId)
            : action === "return"
              ? await api.returnToAi(selectedId)
              : await api.close(selectedId);
        setConversation(res.conversation);
        await loadList();
      } catch (err) {
        setToast(err instanceof ApiError ? err.message : "Действие не выполнено");
      }
    },
    [selectedId, loadList],
  );

  const handleNote = useCallback(
    async (body: string) => {
      if (!selectedId) return;
      try {
        const res = await api.addNote(selectedId, body);
        setNotes((prev) => [...prev, res.note]);
      } catch (err) {
        setToast(err instanceof ApiError ? err.message : "Заметка не сохранена");
      }
    },
    [selectedId],
  );

  const handleRetry = useCallback(
    (messageId: string) => {
      if (!selectedId) return;
      void api
        .retryMessage(selectedId, messageId)
        .then(() => setToast("Повторная отправка запущена"))
        .catch((err: unknown) =>
          setToast(err instanceof ApiError ? err.message : "Не удалось повторить"),
        );
    },
    [selectedId],
  );

  const handleUpload = useCallback(
    async (file: File) => {
      if (!selectedId) return null;
      try {
        const res = await api.uploadAttachment(selectedId, file);
        return res.attachment;
      } catch (err) {
        setToast(err instanceof ApiError ? err.message : "Файл не загружен");
        return null;
      }
    },
    [selectedId],
  );

  const handleLanguage = useCallback(
    (language: string) => {
      if (!selectedId) return;
      void api
        .setLanguage(selectedId, language)
        .then((res) => setConversation(res.conversation))
        .catch(() => setToast("Не удалось изменить язык"));
    },
    [selectedId],
  );

  const visibleItems = useMemo(() => sortConversations(items), [items]);

  return (
    <div className="page">
      {!connected ? <div className="banner">Соединение потеряно. Переподключаемся…</div> : null}
      {toast ? <div className="banner banner-warning">{toast}</div> : null}

      <div className="inbox">
        <ConversationList
          presence={activity.presence}
          typing={activity.typing}
          items={visibleItems}
          loading={listLoading}
          error={listError}
          selectedId={selectedId}
          filters={filters}
          products={ctx.products}
          channels={channels}
          total={total}
          onSelect={(id) => navigate(`/conversations/${id}`)}
          onFiltersChange={setFilters}
          onReload={() => void loadList()}
        />

        <MessageThread
          presence={conversation ? activity.presence[conversation.endUserId] : undefined}
          userTyping={Boolean(selectedId && activity.typing[selectedId])}
          conversation={conversation}
          messages={messages}
          loading={threadLoading}
          sending={sending}
          onSend={handleSend}
          onAddNote={handleNote}
          onRetry={handleRetry}
          onTake={() => void handleAction("take")}
          onReturnToAi={() => void handleAction("return")}
          onClose={() => void handleAction("close")}
          onUploadFile={handleUpload}
        />

        {conversation ? (
          <DetailsPanel
            conversation={conversation}
            notes={notes}
            otherConversations={otherConversations}
            onLanguageChange={handleLanguage}
            onBlockChange={async(blocked,reason)=>{if(!selectedId)return;try{const r=await api.setBlocked(selectedId,blocked,reason);setConversation(r.conversation);await loadList();}catch(err){setToast(err instanceof Error?err.message:'Не удалось изменить блокировку');}}}
            onOpenConversation={(id) => navigate(`/conversations/${id}`)}
          />
        ) : null}
      </div>
    </div>
  );
}

function notifyOperator(title: string, body: string): void {
  try {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(`Sova: ${title}`, { body: body.slice(0, 200) });
    }
  } catch {
    /* уведомления недоступны — не критично */
  }
}
