/** REST-клиент виджета. */
import type {
  ClientMessageDto,
  ClientSessionResponse,
  ConversationStatus,
  WidgetSettings,
} from "@sova/shared";

export interface WidgetConfigResponse {
  channelId: string;
  productName: string;
  settings: WidgetSettings;
  localization?: import('@sova/shared').WidgetLocalization;
  strings?: import('@sova/shared').WidgetStrings;
  socketPath: string;
  serverUrl: string;
}

export interface HistoryResponse {
  conversationId: string | null;
  status: ConversationStatus;
  lastSeq: number;
  language: string | null;
  messages: ClientMessageDto[];
}

export interface SendResponse {
  conversationId: string;
  conversationStatus: ConversationStatus;
  duplicate: boolean;
  message: ClientMessageDto | null;
}

export class WidgetApi {
  constructor(
    private readonly serverUrl: string,
    private sessionToken: string | null = null,
  ) {}

  setToken(token: string | null): void {
    this.sessionToken = token;
  }

  async attachment(id:string):Promise<Blob> {
    if(!this.sessionToken)throw new Error('Session unavailable');
    const res=await fetch(`${this.serverUrl}/api/v1/files/${encodeURIComponent(id)}`,{headers:{'x-sova-session':this.sessionToken},credentials:'omit'});
    if(!res.ok)throw new Error(`Не удалось открыть вложение (HTTP ${res.status})`);
    return res.blob();
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    if (this.sessionToken) headers.set("x-sova-session", this.sessionToken);
    if (init.body && typeof init.body === "string" && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }

    const res = await fetch(`${this.serverUrl}/api/v1${path}`, { ...init, headers });
    if (!res.ok) {
      let message = `HTTP ${res.status}`;
      try {
        const body = (await res.json()) as { error?: { message?: string; code?: string } };
        message = body.error?.message ?? message;
      } catch {
        /* не JSON */
      }
      const error = new Error(message) as Error & { status: number };
      error.status = res.status;
      throw error;
    }
    return (await res.json()) as T;
  }

  config(channelPublicId: string, languageHint = 'en'): Promise<WidgetConfigResponse> {
    return this.request<WidgetConfigResponse>(
      `/client/config?channel=${encodeURIComponent(channelPublicId)}&lang=${encodeURIComponent(languageHint)}`,
    );
  }

  createSession(input: {
    channelPublicId: string;
    visitorKey?: string;
    authToken?: string;
    languageHint?: string;
  }): Promise<ClientSessionResponse> {
    return this.request<ClientSessionResponse>("/client/session", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  history(afterSeq = 0, uiLanguage?: string): Promise<HistoryResponse> {
    return this.request<HistoryResponse>(`/client/messages?afterSeq=${afterSeq}${uiLanguage ? `&uiLanguage=${encodeURIComponent(uiLanguage)}` : ""}`);
  }

  send(input: {
    clientMsgId: string;
    text: string;
    attachmentIds?: string[];
    languageHint?: string;
  }): Promise<SendResponse> {
    return this.request<SendResponse>("/client/messages", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async upload(file: File): Promise<{ id: string; url: string; fileName: string }> {
    const res = await this.request<{
      attachment: { id: string; url: string; fileName: string };
    }>(`/client/attachments?name=${encodeURIComponent(file.name)}`, {
      method: "POST",
      headers: { "content-type": file.type || "application/octet-stream" },
      body: file,
    });
    return res.attachment;
  }

  logout(): Promise<{ ok: boolean }> {
    return this.request<{ ok: boolean }>("/client/session/logout", { method: "POST" });
  }

  async read(messageIds: string[]): Promise<void> {
    await this.request('/client/read', { method: 'POST', body: JSON.stringify({ messageIds }) });
  }
}
