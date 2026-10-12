/**
 * Клиент REST API панели.
 * Сессия хранится в httpOnly-cookie; заголовок X-Sova-Csrf защищает от CSRF.
 * При истечении access-токена выполняется одна попытка обновления.
 */
import type {
  ChannelDto,
  ConversationDetailDto,
  ConversationListItemDto,
  InternalNoteDto,
  KnowledgeArticleDto,
  OperatorDto,
  Paginated,
  PanelMessageDto,
  ProductDto,
  UsageSummaryDto,
} from "@sova/shared";

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const BASE = `${import.meta.env.BASE_URL}api/v1`;

let refreshing: Promise<boolean> | null = null;

export async function refreshSession(): Promise<boolean> {
  if (!refreshing) {
    refreshing = fetch(`${BASE}/auth/refresh`, {
      method: "POST",
      credentials: "include",
      headers: { "x-sova-csrf": "1" },
    })
      .then((res) => res.ok)
      .catch(() => false)
      .finally(() => {
        setTimeout(() => {
          refreshing = null;
        }, 0);
      });
  }
  return refreshing;
}

export async function request<T>(
  path: string,
  options: RequestInit & { retry?: boolean } = {},
): Promise<T> {
  const { retry = true, ...init } = options;

  const headers = new Headers(init.headers);
  headers.set("x-sova-csrf", "1");
  if (init.body && !(init.body instanceof Blob) && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers,
    credentials: "include",
  });

  if (res.status === 401 && retry && (!path.startsWith("/auth/") || path === "/auth/me")) {
    const ok = await refreshSession();
    if (ok) return request<T>(path, { ...options, retry: false });
  }

  if (!res.ok) {
    let code = "http_error";
    let message = `Ошибка ${res.status}`;
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } };
      code = body.error?.code ?? code;
      message = body.error?.message ?? message;
    } catch {
      /* тело не JSON */
    }
    throw new ApiError(code, message, res.status);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const get = <T>(path: string) => request<T>(path);
const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
const patch = <T>(path: string, body: unknown) =>
  request<T>(path, { method: "PATCH", body: JSON.stringify(body) });
const del = <T>(path: string) => request<T>(path, { method: "DELETE" });

export const api = {
  /* ── Аутентификация ── */
  login: (email: string, password: string) =>
    post<{ operator: OperatorDto }>("/auth/login", { email, password }),
  logout: () => post<{ ok: boolean }>("/auth/logout"),
  me: () => get<{ operator: OperatorDto | null }>("/auth/me"),

  /* ── Диалоги ── */
  attention: () => get<{ count: number }>("/conversations/attention"),
  conversations: (params: Record<string, string | undefined>) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value) query.set(key, value);
    }
    return get<Paginated<ConversationListItemDto>>(`/conversations?${query.toString()}`);
  },
  conversation: (id: string) =>
    get<{ conversation: ConversationDetailDto; otherConversations: ConversationListItemDto[] }>(
      `/conversations/${id}`,
    ),
  messages: (id: string) =>
    get<{ messages: PanelMessageDto[]; lastSeq: number; status: string }>(
      `/conversations/${id}/messages`,
    ),
  sendMessage: (id: string, textRu: string, attachmentIds: string[] = []) =>
    post<{ message: PanelMessageDto }>(`/conversations/${id}/messages`, {
      textRu,
      clientMsgId: crypto.randomUUID(),
      attachmentIds,
    }),
  retryMessage: (id: string, messageId: string) =>
    post<{ ok: boolean }>(`/conversations/${id}/messages/${messageId}/retry`),
  take: (id: string) => post<{ conversation: ConversationDetailDto }>(`/conversations/${id}/take`),
  returnToAi: (id: string) =>
    post<{ conversation: ConversationDetailDto }>(`/conversations/${id}/return-to-ai`),
  close: (id: string) => post<{ conversation: ConversationDetailDto }>(`/conversations/${id}/close`),
  markRead: (id: string) => post<{ ok: boolean }>(`/conversations/${id}/read`),
  setLanguage: (id: string, language: string) =>
    post<{ conversation: ConversationDetailDto }>(`/conversations/${id}/language`, { language }),
  setBlocked: (id:string,blocked:boolean,reason?:string)=>post<{conversation:ConversationDetailDto}>(`/conversations/${id}/block`,{blocked,reason}),
  notes: (id: string) => get<{ notes: InternalNoteDto[] }>(`/conversations/${id}/notes`),
  addNote: (id: string, body: string) =>
    post<{ note: InternalNoteDto }>(`/conversations/${id}/notes`, { body }),
  uploadAttachment: async (conversationId: string, file: File) => {
    const res = await fetch(
      `${BASE}/conversations/${conversationId}/attachments?name=${encodeURIComponent(file.name)}`,
      {
        method: "POST",
        credentials: "include",
        headers: { "x-sova-csrf": "1", "content-type": file.type || "application/octet-stream" },
        body: file,
      },
    );
    if (!res.ok) throw new ApiError("upload_failed", "Не удалось загрузить файл", res.status);
    return (await res.json()) as { attachment: { id: string; url: string; fileName: string; mime?: string } };
  },

  /* ── Продукты ── */
  products: () => get<{ products: ProductDto[] }>("/admin/products"),
  product: (id: string) => get<{ product: ProductDto }>(`/admin/products/${id}`),
  createProduct: (input: Record<string, unknown>) =>
    post<{ product: ProductDto }>("/admin/products", input),
  updateProduct: (id: string, input: Record<string, unknown>) =>
    patch<{ product: ProductDto }>(`/admin/products/${id}`, input),
  deleteProduct: (id: string) => del<{ ok: boolean }>(`/admin/products/${id}`),

  /* ── Каналы ── */
  channels: (productId?: string) =>
    get<{ channels: ChannelDto[] }>(
      `/admin/channels${productId ? `?productId=${productId}` : ""}`,
    ),
  channel: (id: string) => get<{ channel: ChannelDto; snippet: string }>(`/admin/channels/${id}`),
  channelTranslations: (id: string) => get<{ translations: Array<{language: string; status: string; error: string | null}> }>(`/admin/channels/${id}/localization`),
  previewChannel: (id: string, language: string) => post<import('@sova/shared').LocalizedWidget>(`/admin/channels/${id}/localization/preview`, { language }),
  createChannel: (input: Record<string, unknown>) =>
    post<{ channel: ChannelDto; snippet: string }>("/admin/channels", input),
  updateChannel: (id: string, input: Record<string, unknown>) =>
    patch<{ channel: ChannelDto; snippet: string }>(`/admin/channels/${id}`, input),
  regenerateSecret: (id: string) =>
    post<{ channel: ChannelDto }>(`/admin/channels/${id}/regenerate-secret`),
  deleteChannel: (id: string) => del<{ ok: boolean }>(`/admin/channels/${id}`),
  sampleToken: (id: string, externalId: string, name?: string) =>
    post<{ token: string }>(`/admin/channels/${id}/sample-token`, { externalId, name }),

  /* ── База знаний ── */
  articles: (productId: string, search?: string) =>
    get<{ articles: KnowledgeArticleDto[] }>(
      `/admin/knowledge?productId=${productId}${search ? `&search=${encodeURIComponent(search)}` : ""}`,
    ),
  createArticle: (input: Record<string, unknown>) =>
    post<{ article: KnowledgeArticleDto }>("/admin/knowledge", input),
  updateArticle: (id: string, input: Record<string, unknown>) =>
    patch<{ article: KnowledgeArticleDto }>(`/admin/knowledge/${id}`, input),
  deleteArticle: (id: string) => del<{ ok: boolean }>(`/admin/knowledge/${id}`),

  /* ── Служебное ── */
  operators: () => get<{ operators: OperatorDto[] }>("/admin/operators"),
  createOperator: (input: Record<string, unknown>) =>
    post<{ operators: OperatorDto[] }>("/admin/operators", input),
  usage: () => get<{ usage: UsageSummaryDto[]; aiConfigured: boolean }>("/admin/usage"),
  status: () =>
    get<{
      aiConfigured: boolean;
      aiProvider: string;
      aiModel: string;
      translationProvider: string;
      telegramConfigured: boolean;
      publicUrl: string;
      operatorLanguage: string;
    }>("/admin/status"),
};
