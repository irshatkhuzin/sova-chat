/**
 * Переписка и поле ответа.
 * Оператор читает русский перевод, оригинал раскрывается по кнопке.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { PanelCommands, type ConversationDetailDto, type PanelMessageDto, type UserPresence } from "@sova/shared";
import { getPanelSocket } from '../lib/socket';
import { Presence } from './Presence';
import { authorLabel, formatTime, statusLabel } from "../lib/format";
import { statusBadgeClass } from "./ConversationList";

import { request } from '../lib/api';
import { MessageFeedback, type Feedback } from './MessageFeedback';

interface Props {
  presence?: UserPresence;
  userTyping: boolean;
  conversation: ConversationDetailDto | null;
  messages: PanelMessageDto[];
  loading: boolean;
  sending: boolean;
  onSend: (text: string, attachmentIds: string[]) => Promise<void>;
  onAddNote: (text: string) => Promise<void>;
  onRetry: (messageId: string) => void;
  onTake: () => void;
  onReturnToAi: () => void;
  onClose: () => void;
  onUploadFile: (file: File) => Promise<{ id: string; url: string; fileName: string; mime?: string } | null>;
}

export function MessageThread(props: Props) {
  const { conversation, messages } = props;
  const feedbackConversation=useRef(conversation?.id);
  feedbackConversation.current=conversation?.id;
  const [feedback,setFeedback]=useState<Feedback[]|undefined>();
  const [feedbackError,setFeedbackError]=useState('');
  useEffect(()=>{
    let active=true;setFeedback(undefined);setFeedbackError('');
    if(conversation) void request<{rows:Feedback[]}>(`/conversations/${conversation.id}/feedback`).then(r=>{if(active)setFeedback(r.rows);}).catch(()=>{if(active)setFeedbackError('Не удалось загрузить оценки. Обновите страницу.');});
    return ()=>{active=false;};
  },[conversation?.id]);
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"reply" | "note">("reply");
  const [attachments, setAttachments] = useState<Array<{ id: string; url: string; fileName: string; mime?: string }>>([]);
  const [uploading, setUploading] = useState(false);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const messageContentRef = useRef<HTMLDivElement | null>(null);
  const followBottomRef = useRef(true);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const lastTyping = useRef(0);
  const typingActive = useRef(false);
  const typingTimer = useRef<ReturnType<typeof setTimeout>>();
  const signalTyping = (active: boolean) => {
    if (typingTimer.current) clearTimeout(typingTimer.current);
    if (!conversation || (active && (mode !== 'reply' || conversation.status === 'closed'))) return;
    const socket = getPanelSocket();
    if (active) typingTimer.current = setTimeout(() => signalTyping(false), 3000);
    if (active && Date.now() - lastTyping.current < 2000) return;
    if (!active && !typingActive.current) return;
    if (active) lastTyping.current = Date.now();
    typingActive.current = active;
    if (socket.connected) socket.volatile.emit(PanelCommands.Typing, { conversationId: conversation.id, active });
  };
  useEffect(() => {
    const stop = () => signalTyping(false);
    window.addEventListener('blur', stop);
    document.addEventListener('visibilitychange', stop);
    return () => {
      stop(); lastTyping.current = 0;
      window.removeEventListener('blur', stop);
      document.removeEventListener('visibilitychange', stop);
    };
  }, [conversation?.id, conversation?.status, mode]);

  useLayoutEffect(() => {
    // History can arrive before markRead finishes: the spinner still replaces
    // the messages then. Scroll only after the actual history has been rendered.
    if (props.loading) return;
    const container = messagesRef.current;
    const content = messageContentRef.current;
    if (!container || !content) return;
    followBottomRef.current = true;
    const scrollToBottom = () => {
      if (followBottomRef.current) container.scrollTop = container.scrollHeight;
    };
    scrollToBottom();
    // Images, video metadata and translations may change the height later.
    const observer = new ResizeObserver(scrollToBottom);
    observer.observe(content);
    observer.observe(container);
    return () => observer.disconnect();
  }, [props.loading, messages.length, conversation?.id]);

  useEffect(() => {
    setText("");
    setAttachments([]);
    setMode("reply");
  }, [conversation?.id]);

  const disabled = !conversation || conversation.status === "closed";

  const placeholder = useMemo(() => {
    if (!conversation) return "";
    if (mode === "note") return "Внутренняя заметка — пользователь её не увидит";
    if (conversation.status === "closed") return "Диалог закрыт";
    if (conversation.language && conversation.language !== "ru") {
      return `Ответ на русском — будет переведён на ${conversation.language.toUpperCase()} перед отправкой`;
    }
    return "Ответ на русском";
  }, [conversation, mode]);

  async function submit() {
    const value = text.trim();
    if (!value || !conversation) return;
    signalTyping(false);
    if (mode === "note") {
      await props.onAddNote(value);
    } else {
      await props.onSend(
        value,
        attachments.map((a) => a.id),
      );
    }
    setText("");
    setAttachments([]);
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files).slice(0, 3)) {
        const uploaded = await props.onUploadFile(file);
        if (uploaded) setAttachments((prev) => [...prev, uploaded]);
      }
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  if (!conversation) {
    return (
      <section className="thread">
        <div className="empty">
          <div style={{ fontSize: 30 }}>💬</div>
          <div>Выберите диалог слева</div>
        </div>
      </section>
    );
  }

  return (
    <section className="thread">
      <header className="thread-header">
        <div>
          <div className="thread-title">{conversation.endUserName}</div>
          <Presence value={props.presence} />
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {conversation.productName} · {conversation.channelName}
          </div>
        </div>
        <span className={statusBadgeClass(conversation.status)}>
          {statusLabel(conversation.status)}
        </span>
        {conversation.endUserIsVerified ? (
          <span className="badge badge-operator">Подтверждён</span>
        ) : (
          <span className="badge">Аноним</span>
        )}

        <div className="thread-actions">
          {conversation.status !== "operator" && conversation.status !== "closed" ? (
            <button type="button" className="btn btn-sm btn-primary" onClick={props.onTake}>
              Взять диалог
            </button>
          ) : null}
          {conversation.status === "operator" ? (
            <button type="button" className="btn btn-sm" onClick={props.onReturnToAi}>
              Вернуть ИИ
            </button>
          ) : null}
          {conversation.status !== "closed" ? (
            <button type="button" className="btn btn-sm btn-danger" onClick={props.onClose}>
              Закрыть
            </button>
          ) : null}
        </div>
      </header>

      {conversation.status === "waiting_operator" && conversation.handoffSummaryRu ? (
        <div className="banner banner-warning">
          Передано оператору: {conversation.handoffSummaryRu}
        </div>
      ) : null}

      {feedbackError&&<div className="banner" role="status">{feedbackError}</div>}
      <div className="messages" ref={messagesRef} style={{ overflowAnchor: 'none' }} onScroll={(event) => {
        const el = event.currentTarget;
        followBottomRef.current = el.scrollHeight - el.clientHeight - el.scrollTop < 48;
      }}>
        <div ref={messageContentRef} style={{ display: 'flex', flexDirection: 'column', gap: 12, flexShrink: 0, minHeight: '100%' }}>
        {props.loading ? (
          <div className="empty">
            <div className="spinner" />
            <div>Загружаем сообщения…</div>
          </div>
        ) : messages.length === 0 ? (
          <div className="empty">Сообщений пока нет</div>
        ) : (
          messages.map((message) => <MessageBubble key={message.id} message={message} onRetry={props.onRetry} feedback={feedback?.find(f=>String(f.message_id)===message.id)??(feedback?null:undefined)} onFeedbackSaved={rows=>{if(feedbackConversation.current===message.conversationId)setFeedback(rows);}} />)
        )}
        </div>
      </div>
      <div className="thread-typing" role="status">{props.userTyping ? 'Пользователь печатает…' : '\u00a0'}</div>

      <div className={`composer${mode === "note" ? " note" : ""}`}>
        <div className="composer-tabs">
          <button
            type="button"
            className={`chip${mode === "reply" ? " active" : ""}`}
            onClick={() => setMode("reply")}
          >
            Ответ пользователю
          </button>
          <button
            type="button"
            className={`chip${mode === "note" ? " active" : ""}`}
            onClick={() => setMode("note")}
          >
            Внутренняя заметка
          </button>
        </div>

        <textarea
          value={text}
          onChange={(e) => { setText(e.target.value); signalTyping(Boolean(e.target.value.trim())); }}
          onBlur={() => signalTyping(false)}
          placeholder={placeholder}
          disabled={disabled && mode === "reply"}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void submit();
            }
          }}
        />

        {attachments.length > 0 ? (
          <div className="message-attachments">
            {attachments.map((a) => (
              a.mime?.startsWith("video/") ? <video key={a.id} src={a.url} controls preload="metadata" style={{maxWidth:260,maxHeight:180}}/> : <img key={a.id} src={a.url} alt={a.fileName} />
            ))}
          </div>
        ) : null}

        <div className="composer-footer">
          <span className="composer-hint">
            {mode === "note"
              ? "Заметка видна только операторам"
              : conversation.language && conversation.language !== "ru"
                ? `Сервер переведёт ответ на ${conversation.language.toUpperCase()} и отправит пользователю`
                : "Пользователь пишет по-русски — перевод не нужен"}
            {" · Ctrl+Enter — отправить"}
          </span>

          {mode === "reply" ? (
            <>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp,video/mp4,video/webm"
                multiple
                hidden
                onChange={(e) => void handleFiles(e.target.files)}
              />
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => fileRef.current?.click()}
                disabled={disabled || uploading}
              >
                {uploading ? "Загрузка…" : "Фото / видео"}
              </button>
            </>
          ) : null}

          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void submit()}
            disabled={(disabled && mode === "reply") || props.sending || !text.trim()}
          >
            {props.sending ? "Отправляем…" : mode === "note" ? "Сохранить заметку" : "Отправить"}
          </button>
        </div>
      </div>
    </section>
  );
}

function MessageBubble({
  message,
  onRetry,
  feedback,
  onFeedbackSaved,
}: {
  message: PanelMessageDto;
  feedback: Feedback|null|undefined;
  onFeedbackSaved: (rows:Feedback[])=>void;
  onRetry: (messageId: string) => void;
}) {
  const [showOriginal, setShowOriginal] = useState(false);

  const isUser = message.authorType === "user";
  const isSystem = message.authorType === "system";
  const side = isUser ? "from-user" : isSystem ? "from-system" : "from-agent";

  // Оператор читает по-русски: перевод, если он есть, иначе оригинал.
  const primaryText =
    message.translationRu ??
    (message.authorType === "operator" ? message.originalText : message.originalText);

  const bubbleClass = isSystem
    ? "bubble bubble-system"
    : message.authorType === "ai"
      ? "bubble bubble-ai"
      : message.authorType === "operator"
        ? message.deliveryStatus === "failed"
          ? "bubble bubble-failed"
          : "bubble bubble-operator"
        : "bubble";

  const hasOriginal =
    (isUser && message.translationRu !== null) ||
    (message.authorType === "ai" && message.translationRu !== null) ||
    (message.authorType === "operator" && message.outboundText !== null && message.outboundLang !== "ru");

  return (
    <div className={`message ${side}`}>
      <div className="message-author">
        <strong>{authorLabel(message.authorType)}</strong>
        {message.authorName ? <span>· {message.authorName}</span> : null}
        <span>· {formatTime(message.createdAt)}</span>
        {message.originalLang ? <span>· {message.originalLang.toUpperCase()}</span> : null}
        {message.deliveryStatus === "pending" ? <span>· отправляется…</span> : null}
        {message.deliveryStatus === "failed" ? (
          <span style={{ color: "var(--danger)" }}>· не отправлено</span>
        ) : null}
        {message.translationStatus === "pending" ? <span>· перевод…</span> : null}
      </div>

      <div className={bubbleClass}>{primaryText}</div>

      {!isUser && !isSystem && !message.isInternal && message.deliveryStatus === 'sent' ? (
        <div style={{ fontSize: 11, color: message.clientReadAt ? 'var(--primary, #3974dc)' : 'var(--text-muted)' }}
          title={message.clientReadAt ? `Прочитано пользователем ${new Date(message.clientReadAt).toLocaleString('ru-RU')}` : 'Сообщение отправлено. Подтверждения прочтения пока нет.'}>
          {message.clientReadAt ? `✓✓ Прочитано · ${formatTime(message.clientReadAt)}` : '✓ Отправлено'}
        </div>
      ) : null}

      {message.authorType==='ai'&&!message.isInternal&&message.deliveryStatus==='sent'&&<MessageFeedback conversationId={message.conversationId} messageId={message.id} initial={feedback} onSaved={onFeedbackSaved}/>}
      {message.attachments.length > 0 ? (
        <div className="message-attachments">
          {message.attachments.map((attachment) => (
            <div key={attachment.id}>{attachment.mime.startsWith("video/")?<video src={attachment.url} controls preload="metadata" style={{maxWidth:320,maxHeight:240}}/>:<a href={attachment.url} target="_blank" rel="noreferrer"><img src={attachment.url} alt={attachment.fileName}/></a>}</div>
          ))}
        </div>
      ) : null}

      {message.deliveryStatus === "failed" ? (
        <div className="row" style={{ gap: 8 }}>
          <span style={{ fontSize: 12, color: "var(--danger)" }}>
            {message.failureReason ?? "Перевод не выполнен"}
          </span>
          <button type="button" className="btn btn-sm" onClick={() => onRetry(message.id)}>
            Повторить
          </button>
        </div>
      ) : null}

      {hasOriginal ? (
        <>
          <button
            type="button"
            className="original-toggle"
            onClick={() => setShowOriginal((v) => !v)}
          >
            {showOriginal ? "Скрыть оригинал" : "Показать оригинал"}
          </button>
          {showOriginal ? (
            <div className="original-text">
              {message.authorType === "operator"
                ? message.outboundText ?? "Перевод ещё не готов"
                : message.originalText}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
