/** Локализация интерфейса виджета. Тексты самого чата приходят с сервера. */

export interface WidgetStrings {
  launcher: string;
  inputPlaceholder: string;
  send: string;
  attach: string;
  connecting: string;
  offline: string;
  reconnecting: string;
  sending: string;
  failed: string;
  retry: string;
  typing: string;
  poweredBy: string;
  imageTooLarge: string;
  imageRejected: string;
  close: string;
  today: string;
}

const RU: WidgetStrings = {
  launcher: "Чат с поддержкой",
  inputPlaceholder: "Напишите сообщение…",
  send: "Отправить",
  attach: "Скриншот или видео (MP4/WebM, до 60 с и 32 МБ; анализ видео без звука)",
  connecting: "Подключение…",
  offline: "Нет соединения",
  reconnecting: "Переподключение…",
  sending: "Отправляется",
  failed: "Не отправлено",
  retry: "Повторить",
  typing: "Оператор печатает…",
  poweredBy: "Работает на Sova",
  imageTooLarge: "Файл слишком большой",
  imageRejected: "Допустимы PNG, JPEG, GIF, WebP и видео MP4/WebM до 60 секунд",
  close: "Закрыть",
  today: "Сегодня",
};

const EN: WidgetStrings = {
  launcher: "Chat with support",
  inputPlaceholder: "Type a message…",
  send: "Send",
  attach: "Image or video (MP4/WebM, up to 60s / 32MB; video analysis without audio)",
  connecting: "Connecting…",
  offline: "No connection",
  reconnecting: "Reconnecting…",
  sending: "Sending",
  failed: "Not sent",
  retry: "Retry",
  typing: "Operator is typing…",
  poweredBy: "Powered by Sova",
  imageTooLarge: "File is too large",
  imageRejected: "Use PNG, JPEG, GIF, WebP or MP4/WebM video up to 60 seconds",
  close: "Close",
  today: "Today",
};

const DICTIONARIES: Record<string, WidgetStrings> = {
  ru: RU,
  en: EN,
  de: {
    ...EN,
    launcher: "Chat mit dem Support",
    inputPlaceholder: "Nachricht schreiben…",
    send: "Senden",
    connecting: "Verbindung…",
    offline: "Keine Verbindung",
    reconnecting: "Erneut verbinden…",
    sending: "Wird gesendet",
    failed: "Nicht gesendet",
    retry: "Erneut versuchen",
    typing: "Ein Mitarbeiter schreibt…",
    close: "Schließen",
    today: "Heute",
    poweredBy: "Unterstützt von Sova",
    imageTooLarge: "Datei ist zu groß",
    imageRejected: "PNG, JPEG, GIF, WebP oder MP4/WebM-Videos bis 60 Sekunden",
    attach: "Bild oder Video (MP4/WebM, bis 60 s / 32 MB; Videoanalyse ohne Ton)",
  },
  fr: {
    ...EN,
    launcher: "Discuter avec le support",
    inputPlaceholder: "Écrivez un message…",
    send: "Envoyer",
    connecting: "Connexion…",
    offline: "Pas de connexion",
    reconnecting: "Reconnexion…",
    sending: "Envoi",
    failed: "Non envoyé",
    retry: "Réessayer",
    typing: "Un conseiller écrit…",
    close: "Fermer",
    today: "Aujourd’hui",
    poweredBy: "Propulsé par Sova",
    imageTooLarge: "Fichier trop volumineux",
    imageRejected: "PNG, JPEG, GIF, WebP ou vidéo MP4/WebM de 60 secondes maximum",
    attach: "Image ou vidéo (MP4/WebM, 60 s / 32 Mo maximum ; analyse vidéo sans audio)",
  },
  es: {
    ...EN,
    launcher: "Chatear con soporte",
    inputPlaceholder: "Escribe un mensaje…",
    send: "Enviar",
    connecting: "Conectando…",
    offline: "Sin conexión",
    reconnecting: "Reconectando…",
    sending: "Enviando",
    failed: "No enviado",
    retry: "Reintentar",
    typing: "El operador está escribiendo…",
    close: "Cerrar",
    today: "Hoy",
    poweredBy: "Con tecnología de Sova",
    imageTooLarge: "El archivo es demasiado grande",
    imageRejected: "PNG, JPEG, GIF, WebP o vídeo MP4/WebM de hasta 60 segundos",
    attach: "Imagen o vídeo (MP4/WebM, hasta 60 s / 32 MB; análisis sin audio)",
  },
  pt: {
    ...EN,
    launcher: "Falar com o suporte",
    inputPlaceholder: "Escreva uma mensagem…",
    send: "Enviar",
    connecting: "Conectando…",
    offline: "Sem conexão",
    reconnecting: "Reconectando…",
    sending: "Enviando",
    failed: "Não enviado",
    retry: "Tentar novamente",
    typing: "O atendente está digitando…",
    close: "Fechar",
    today: "Hoje",
    poweredBy: "Desenvolvido com Sova",
    imageTooLarge: "O arquivo é muito grande",
    imageRejected: "PNG, JPEG, GIF, WebP ou vídeo MP4/WebM de até 60 segundos",
    attach: "Imagem ou vídeo (MP4/WebM, até 60 s / 32 MB; análise sem áudio)",
  },
  tr: {
    ...EN,
    launcher: "Destek ile sohbet",
    inputPlaceholder: "Bir mesaj yazın…",
    send: "Gönder",
    connecting: "Bağlanıyor…",
    offline: "Bağlantı yok",
    reconnecting: "Yeniden bağlanıyor…",
    sending: "Gönderiliyor",
    failed: "Gönderilmedi",
    retry: "Tekrar dene",
    typing: "Temsilci yazıyor…",
    close: "Kapat",
    today: "Bugün",
    poweredBy: "Sova tarafından desteklenir",
    imageTooLarge: "Dosya çok büyük",
    imageRejected: "PNG, JPEG, GIF, WebP veya en fazla 60 saniyelik MP4/WebM video",
    attach: "Görsel veya video (MP4/WebM, en fazla 60 sn / 32 MB; sessiz video analizi)",
  },
  it: { ...EN, launcher: "Chat con l'assistenza", inputPlaceholder: "Scrivi un messaggio…", send: "Invia", attach: "Allega immagine o video", connecting: "Connessione…", offline: "Nessuna connessione", reconnecting: "Riconnessione…", sending: "Invio…", failed: "Non inviato", retry: "Riprova", typing: "Operatore sta scrivendo…", close: "Chiudi", today: "Oggi", poweredBy: "Powered by Sova", imageTooLarge: "File troppo grande", imageRejected: "Usa PNG, JPEG, GIF, WebP o video MP4/WebM fino a 60 secondi" },
  zh: { ...EN, launcher: "联系客服", inputPlaceholder: "输入消息…", send: "发送", attach: "添加图片或视频", connecting: "正在连接…", offline: "连接已断开", reconnecting: "正在重新连接…", sending: "正在发送…", failed: "发送失败", retry: "重试", typing: "客服正在输入…", close: "关闭", today: "今天", poweredBy: "由 Sova 提供支持", imageTooLarge: "文件过大", imageRejected: "支持 PNG、JPEG、GIF、WebP 或不超过60秒的 MP4/WebM 视频" },
  uk: {
    ...RU,
    launcher: "Чат з підтримкою",
    inputPlaceholder: "Напишіть повідомлення…",
    send: "Надіслати",
    connecting: "Підключення…",
    offline: "Немає зʼєднання",
    reconnecting: "Перепідключення…",
    sending: "Надсилається",
    failed: "Не надіслано",
    retry: "Повторити",
    typing: "Оператор друкує…",
    close: "Закрити",
    today: "Сьогодні",
    poweredBy: "Працює на Sova",
    imageTooLarge: "Файл завеликий",
    imageRejected: "PNG, JPEG, GIF, WebP або відео MP4/WebM до 60 секунд",
    attach: "Зображення або відео (MP4/WebM, до 60 с / 32 МБ; аналіз без звуку)",
  },
};

export function pickStrings(locale: string): WidgetStrings {
  const base = (locale || "").toLowerCase().split("-")[0] ?? "en";
  return DICTIONARIES[base] ?? EN;
}
