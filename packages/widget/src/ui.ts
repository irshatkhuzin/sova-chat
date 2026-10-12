/**
 * Интерфейс виджета.
 *
 * Весь интерфейс живёт в Shadow DOM: стили страницы не влияют на виджет,
 * а стили виджета не влияют на страницу. Текст вставляется только как
 * текстовые узлы — разметка из сообщений никогда не исполняется.
 */
import type { WidgetSettings } from "@sova/shared";
import type { WidgetStrings } from "./i18n.js";
import { appendLinkedText } from './links.js';

export type UiAuthor = "user" | "agent" | "system";

export interface UiMessage {
  id: string;
  author: UiAuthor;
  text: string;
  createdAt: string;
  status?: "sending" | "sent" | "failed";
  clientMsgId?: string;
  attachments?: Array<{ id: string; url: string; fileName: string; mime:string }>;
}

export type ConnectionState = "connecting" | "online" | "offline";

export interface UiCallbacks {
  onRead: (messageIds: string[]) => void;
  onLoadAttachment: (id:string)=>Promise<string>;
  onSend: (text: string, files: File[]) => void;
  onToggle: (open: boolean) => void;
  onTyping: (active: boolean) => void;
  onRetry: (clientMsgId: string) => void;
}

const STYLES = `
:host { all: initial; }
* { box-sizing: border-box; }
.root {
  position: fixed;
  z-index: 2147483000;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 14px;
  line-height: 1.45;
  color: #16181d;
}
.launcher {
  position: fixed;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0;
  width: 58px;
  height: 58px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  color: #fff;
  box-shadow: 0 6px 20px rgba(16,24,40,.22);
  transition: transform .15s ease;
  justify-content: center;
}
.launcher:hover { transform: scale(1.05); }
.launcher.with-label {
  width: auto;
  border-radius: 999px;
  padding: 0 18px 0 14px;
  height: 52px;
}
.launcher svg { width: 26px; height: 26px; fill: currentColor; }
.launcher-badge {
  position: absolute;
  top: -2px;
  right: -2px;
  min-width: 20px;
  height: 20px;
  padding: 0 5px;
  border-radius: 10px;
  background: #e5484d;
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px solid #fff;
}
.window {
  position: fixed;
  width: 380px;
  height: 560px;
  max-height: calc(100vh - 40px);
  background: #ffffff00;
  border-radius: 14px;
  box-shadow: 0 12px 40px rgba(16,24,40,.24);
  display: none;
  flex-direction: column;
  overflow: hidden;
}
.window.open { display: flex; }
.header {
  padding: 14px 16px;
  color: #fff;
  display: flex;
  align-items: center;
  gap: 10px;
}
.header-texts { flex: 1; min-width: 0; }
.header-title { font-weight: 650; font-size: 15px; }
.header-subtitle { font-size: 12px; opacity: .85; }
.header-close {
  background: rgba(255,255,255,.18);
  border: none;
  color: #fff;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
}
.status-bar {
  padding: 5px 16px;
  font-size: 12px;
  background: #fdf0dc;
  color: #b26b00;
  display: none;
}
.status-bar.visible { display: block; }
.messages {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 16px;
  background: #f5f6f8;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.msg { max-width: 86%; min-width: 0; flex-shrink: 0; display: flex; flex-direction: column; gap: 3px; }
.bubble a { color: inherit; text-decoration: underline; overflow-wrap: anywhere; }
.msg.user { align-self: flex-end; align-items: flex-end; }
.msg.agent { align-self: flex-start; }
.msg.system { align-self: center; max-width: 92%; }
.bubble {
  padding: 9px 13px;
  border-radius: 14px;
  background: #fff;
  border: 1px solid #e2e5ea;
  white-space: pre-wrap;
  word-break: break-word;
}
.msg.user .bubble { color: #fff; border: none; border-bottom-right-radius: 4px; }
.msg.agent .bubble { border-bottom-left-radius: 4px; }
.msg.system .bubble {
  background: #eef1f5;
  border-style: dashed;
  color: #5a6270;
  font-size: 13px;
  text-align: center;
}
.msg-meta { font-size: 11px; color: #8b929d; display: flex; gap: 6px; align-items: center; }
.msg-attachments { display: flex; flex-direction: column; gap: 6px; max-width: 100%; min-width: 0; }
.media-card { width: 220px; max-width: 100%; min-width: 0; padding: 6px; border: 1px solid #d7dbe2; border-radius: 10px; background: #fff; color: #56606f; cursor: pointer; font: inherit; overflow-wrap: anywhere; }
.media-card img { display: block; width: 100%; object-fit: contain; margin: auto; }
.media-card span { display: block; font-size: 11px; margin-top: 4px; }
.media-preview { position: fixed; inset: 0; z-index: 2147483001; background: rgba(0,0,0,.8); display: grid; place-items: center; cursor: zoom-out; }
.media-preview img { max-width: 95vw; max-height: 90vh; object-fit: contain; }
.media-preview button { position: absolute; top: 16px; right: 16px; padding: 8px 14px; cursor: pointer; }
.msg-attachments img, .msg-attachments video {
  max-width: 200px;
  max-height: 200px;
  border-radius: 8px;
  border: 1px solid #e2e5ea;
}
.retry-btn {
  border: none;
  background: none;
  color: #c0392b;
  font-size: 11.5px;
  cursor: pointer;
  text-decoration: underline;
  padding: 0;
}
.typing { display: none; align-self: flex-start; align-items: center; gap: 4px; padding: 8px 12px; font-size: 12px; color: #64748b; }
.typing.visible { display: flex; }
.typing span {
  width: 6px; height: 6px; border-radius: 50%; background: #b3b9c4;
  animation: bounce 1.2s infinite ease-in-out;
}
.typing span:nth-child(2) { animation-delay: .15s; }
.typing span:nth-child(3) { animation-delay: .3s; }
@keyframes bounce { 0%,60%,100% { transform: translateY(0); opacity:.5 } 30% { transform: translateY(-4px); opacity:1 } }
.composer {
  border-top: 1px solid #e2e5ea;
  background: #fff;
  padding: 10px 12px;
  display: flex;
  gap: 8px;
  align-items: flex-end;
}
.composer textarea {
  flex: 1;
  min-width: 0;
  border: 1px solid #d7dbe2;
  border-radius: 10px;
  padding: 9px 11px;
  resize: none;
  max-height: 120px;
  min-height: 40px;
  outline: none;
  font-family: inherit;
  font-size: 14px;
  line-height: 1.4;
}
.composer textarea:focus { border-color: #a8bcf0; }
.icon-btn {
  border: none;
  background: #f0f2f5;
  width: 38px;
  height: 38px;
  border-radius: 10px;
  cursor: pointer;
  font-size: 17px;
  color: #56606f;
  flex-shrink: 0;
}
.send-btn { color: #fff; border: none; }
.icon-btn svg { width: 23px; height: 23px; vertical-align: middle; }
.send-btn:disabled { opacity: .5; cursor: default; }
.footer { text-align: center; font-size: 11px; color: #a0a6b0; padding: 0 0 8px; background: #fff; }
.error-line { color: #c0392b; font-size: 12px; padding: 0 12px 6px; background: #fff; }
@media (max-width: 480px) {
  .window {
    width: 100vw;
    height: 100vh;
    max-height: 100vh;
    inset: 0;
    border-radius: 0;
  }
}
`;

export class WidgetUi {
  private host: HTMLDivElement;
  private shadow: ShadowRoot;
  private windowEl!: HTMLDivElement;
  private launcherEl!: HTMLButtonElement;
  private badgeEl!: HTMLSpanElement;
  private messagesEl!: HTMLDivElement;
  private statusEl!: HTMLDivElement;
  private typingEl!: HTMLDivElement;
  private readObserver!: IntersectionObserver;
  private visibleReads = new Set<string>();
  private reportedReads = new Set<string>();
  private readTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly checkReads = () => {
    const active = this.open && document.visibilityState === 'visible' && document.hasFocus();
    for (const [id, timer] of this.readTimers) {
      if (!active || !this.visibleReads.has(id)) { clearTimeout(timer); this.readTimers.delete(id); }
    }
    if (!active) return;
    for (const id of this.visibleReads) {
      if (this.reportedReads.has(id) || this.readTimers.has(id)) continue;
      this.readTimers.set(id, setTimeout(() => {
        this.readTimers.delete(id);
        if (this.open && document.visibilityState === 'visible' && document.hasFocus() && this.visibleReads.has(id)) {
          this.reportedReads.add(id);
          this.callbacks.onRead([id]);
        }
      }, 750));
    }
  };
  private textarea!: HTMLTextAreaElement;
  private sendBtn!: HTMLButtonElement;
  private fileInput!: HTMLInputElement;
  private errorEl!: HTMLDivElement;
  private open = false;
  private pendingFiles: File[] = [];
  private mediaObservers=new Set<IntersectionObserver>();

  constructor(
    private settings: WidgetSettings,
    private strings: WidgetStrings,
    private readonly callbacks: UiCallbacks,
  ) {
    this.host = document.createElement("div");
    this.host.setAttribute("data-sova-widget", "");
    this.shadow = this.host.attachShadow({ mode: "open" });
  }

  mount(): void {
    const style = document.createElement("style");
    style.textContent = STYLES;
    this.shadow.appendChild(style);

    const root = document.createElement("div");
    root.className = "root";
    this.shadow.appendChild(root);

    this.launcherEl = document.createElement("button");
    this.launcherEl.type = "button";
    this.launcherEl.className = "launcher";
    this.launcherEl.setAttribute("aria-label", this.strings.launcher);
    this.launcherEl.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3C6.98 3 3 6.58 3 11c0 2.35 1.14 4.44 2.95 5.86-.13 1.1-.6 2.3-1.42 3.4-.2.27 0 .66.33.6 2.1-.36 3.6-1.13 4.55-1.8.82.2 1.7.3 2.6.3 5.02 0 9-3.58 9-8S17.02 3 12 3z"/></svg>';
    this.badgeEl = document.createElement("span");
    this.badgeEl.className = "launcher-badge";
    this.badgeEl.style.display = "none";
    this.launcherEl.appendChild(this.badgeEl);
    this.launcherEl.addEventListener("click", () => this.setOpen(!this.open));
    root.appendChild(this.launcherEl);

    this.windowEl = document.createElement("div");
    this.windowEl.className = "window";
    root.appendChild(this.windowEl);

    // Шапка
    const header = document.createElement("div");
    header.className = "header";
    const texts = document.createElement("div");
    texts.className = "header-texts";
    const title = document.createElement("div");
    title.className = "header-title";
    const subtitle = document.createElement("div");
    subtitle.className = "header-subtitle";
    texts.append(title, subtitle);
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "header-close";
    closeBtn.textContent = "×";
    closeBtn.setAttribute("aria-label", this.strings.close);
    closeBtn.addEventListener("click", () => this.setOpen(false));
    header.append(texts, closeBtn);
    this.windowEl.appendChild(header);

    this.statusEl = document.createElement("div");
    this.statusEl.className = "status-bar";
    this.windowEl.appendChild(this.statusEl);

    this.messagesEl = document.createElement("div");
    this.messagesEl.className = "messages";
    this.windowEl.appendChild(this.messagesEl);
    this.readObserver = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.readMessageId!;
        if (entry.isIntersecting && entry.intersectionRatio >= 0.99) this.visibleReads.add(id);
        else this.visibleReads.delete(id);
      }
      this.checkReads();
    }, { root: this.messagesEl, threshold: [0, 1] });
    document.addEventListener('visibilitychange', this.checkReads);
    window.addEventListener('focus', this.checkReads);
    window.addEventListener('blur', this.checkReads);

    this.typingEl = document.createElement("div");
    this.typingEl.className = "typing";
    this.typingEl.innerHTML = "<span></span><span></span><span></span>";
    this.typingEl.setAttribute('role', 'status');
    const typingLabel = document.createElement('em');
    typingLabel.className = 'typing-label';
    typingLabel.style.cssText = 'font-style:normal;margin-left:6px';
    this.typingEl.appendChild(typingLabel);
    this.messagesEl.appendChild(this.typingEl);

    this.errorEl = document.createElement("div");
    this.errorEl.className = "error-line";
    this.errorEl.style.display = "none";
    this.windowEl.appendChild(this.errorEl);

    // Поле ввода
    const composer = document.createElement("div");
    composer.className = "composer";

    this.fileInput = document.createElement("input");
    this.fileInput.type = "file";
    this.fileInput.accept = "image/png,image/jpeg,image/gif,image/webp,video/mp4,video/webm";
    this.fileInput.multiple = false;
    this.fileInput.style.display = "none";
    this.fileInput.addEventListener("change", () => {
      const files = this.fileInput.files;
      if (files && files[0]) {
        this.pendingFiles = [files[0]];
        this.updateSendState();
        this.showError(files[0].name, false);
      }
    });

    const attachBtn = document.createElement("button");
    attachBtn.type = "button";
    attachBtn.className = "icon-btn";
    attachBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13"></path></svg>';
    attachBtn.setAttribute('aria-label',this.strings.attach);
    attachBtn.title = this.strings.attach;
    attachBtn.addEventListener("click", () => this.fileInput.click());

    this.textarea = document.createElement("textarea");
    this.textarea.rows = 1;
    this.textarea.placeholder = this.strings.inputPlaceholder;
    this.textarea.addEventListener("input", () => {
      this.textarea.style.height = "auto";
      this.textarea.style.height = `${Math.min(this.textarea.scrollHeight, 120)}px`;
      this.updateSendState();
      this.callbacks.onTyping(Boolean(this.textarea.value.trim()));
    });
    this.textarea.addEventListener('blur', () => this.callbacks.onTyping(false));
    this.textarea.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        this.submit();
      }
    });

    this.sendBtn = document.createElement("button");
    this.sendBtn.type = "button";
    this.sendBtn.className = "icon-btn send-btn";
    this.sendBtn.textContent = "➤";
    this.sendBtn.title = this.strings.send;
    this.sendBtn.disabled = true;
    this.sendBtn.addEventListener("click", () => this.submit());

    composer.append(attachBtn, this.textarea, this.sendBtn, this.fileInput);
    this.windowEl.appendChild(composer);

    const footer = document.createElement("div");
    footer.className = "footer";
    footer.textContent = this.strings.poweredBy;
    this.windowEl.appendChild(footer);

    this.titleEl = title;
    this.subtitleEl = subtitle;
    this.attachBtn = attachBtn;

    document.body.appendChild(this.host);
    this.applySettings();
  }

  private titleEl!: HTMLDivElement;
  private subtitleEl!: HTMLDivElement;
  private attachBtn!: HTMLButtonElement;

  applySettings(settings?: WidgetSettings, strings?: WidgetStrings): void {
    if (settings) this.settings = settings;
    if (strings) this.strings = strings;

    const color = this.settings.primaryColor || "#2f6df6";
    this.launcherEl.style.background = color;
    this.sendBtn.style.background = color;
    const header = this.shadow.querySelector<HTMLDivElement>(".header");
    if (header) header.style.background = color;
    this.shadow.querySelectorAll<HTMLDivElement>(".msg.user .bubble").forEach((el) => {
      el.style.background = color;
    });

    const side = this.settings.position === "left" ? "left" : "right";
    const opposite = side === "left" ? "right" : "left";
    for (const el of [this.launcherEl, this.windowEl]) {
      el.style[side] = `${this.settings.offsetX}px`;
      el.style[opposite] = "auto";
      el.style.bottom = `${this.settings.offsetY}px`;
    }
    this.windowEl.style.bottom = `${this.settings.offsetY + 72}px`;

    this.launcherEl.querySelectorAll('.launcher-label').forEach(el => el.remove());
    this.launcherEl.classList.toggle('with-label', this.settings.showLauncherLabel);
    if (this.settings.showLauncherLabel) {
      this.launcherEl.classList.add("with-label");
      const label = document.createElement("span");
      label.className = 'launcher-label';
      label.textContent = this.settings.launcherLabel || this.strings.launcher;
      this.launcherEl.appendChild(label);
    }

    this.titleEl.textContent = this.settings.title;
    this.subtitleEl.textContent = this.settings.subtitle;
    this.textarea.placeholder = this.strings.inputPlaceholder;
    const typingLabel = this.typingEl.querySelector('.typing-label');
    if (typingLabel) typingLabel.textContent = this.strings.typing;
    this.launcherEl.setAttribute('aria-label', this.strings.launcher);
    this.shadow.querySelector('.header-close')?.setAttribute('aria-label', this.strings.close);
    this.sendBtn.title = this.strings.send;
    this.sendBtn.setAttribute('aria-label', this.strings.send);
    this.attachBtn.title = this.strings.attach;
    this.attachBtn.setAttribute('aria-label', this.strings.attach);
    const footer = this.shadow.querySelector('.footer');
    if (footer) footer.textContent = this.strings.poweredBy;
    this.attachBtn.style.display = this.settings.allowAttachments ? "" : "none";
  }

  private submit(): void {
    const text = this.textarea.value.trim();
    if (!text && this.pendingFiles.length === 0) return;
    const files = this.pendingFiles;
    this.pendingFiles = [];
    this.fileInput.value = "";
    this.textarea.value = "";
    this.textarea.style.height = "auto";
    this.updateSendState();
    this.hideError();
    this.callbacks.onSend(text, files);
  }

  private updateSendState(): void {
    this.sendBtn.disabled = this.textarea.value.trim().length === 0 && this.pendingFiles.length === 0;
  }

  setOpen(open: boolean): void {
    this.open = open;
    this.windowEl.classList.toggle("open", open);
    if (open) {
      this.setUnread(0);
      this.scrollToBottom();
      setTimeout(() => this.textarea.focus(), 50);
    }
    this.callbacks.onToggle(open);
    this.checkReads();
  }

  isOpen(): boolean {
    return this.open;
  }

  setUnread(count: number): void {
    if (count > 0 && !this.open) {
      this.badgeEl.textContent = count > 9 ? "9+" : String(count);
      this.badgeEl.style.display = "flex";
    } else {
      this.badgeEl.style.display = "none";
    }
  }

  setConnection(state: ConnectionState): void {
    if (state === "online") {
      this.statusEl.classList.remove("visible");
      return;
    }
    this.statusEl.textContent =
      state === "connecting" ? this.strings.connecting : this.strings.reconnecting;
    this.statusEl.classList.add("visible");
  }

  setAgentTyping(typing: boolean): void {
    this.typingEl.classList.toggle("visible", typing);
    if (typing) this.scrollToBottom();
  }

  showError(text: string, isError = true): void {
    this.errorEl.textContent = text;
    this.errorEl.style.color = isError ? "#c0392b" : "#56606f";
    this.errorEl.style.display = "block";
  }

  hideError(): void {
    this.errorEl.style.display = "none";
  }

  clearMessages(): void {
    this.readObserver.disconnect();
    this.visibleReads.clear(); this.reportedReads.clear();
    for (const timer of this.readTimers.values()) clearTimeout(timer);
    this.readTimers.clear();
    for(const observer of this.mediaObservers)observer.disconnect();this.mediaObservers.clear();
    const nodes = Array.from(this.messagesEl.querySelectorAll(".msg"));
    for (const node of nodes) node.remove();
  }

  renderMessages(messages: UiMessage[]): void {
    this.clearMessages();
    for (const message of messages) this.appendMessage(message, false);
    this.scrollToBottom();
  }

  appendMessage(message: UiMessage, scroll = true): void {
    const existing = this.findNode(message);
    if (existing) {
      const oldMeta = existing.querySelector('[data-read-message-id]');
      if (oldMeta) {
        this.readObserver.unobserve(oldMeta);
        const oldId = oldMeta.getAttribute('data-read-message-id');
        if (oldId) {
          this.visibleReads.delete(oldId);
          const timer = this.readTimers.get(oldId);
          if (timer) clearTimeout(timer);
          this.readTimers.delete(oldId);
        }
      }
      existing.replaceWith(this.buildMessageNode(message));
      return;
    }
    this.messagesEl.insertBefore(this.buildMessageNode(message), this.typingEl);
    if (scroll) this.scrollToBottom();
  }

  private findNode(message: UiMessage): HTMLElement | null {
    if (message.clientMsgId) {
      const byClient = this.messagesEl.querySelector<HTMLElement>(
        `[data-client-id="${cssEscape(message.clientMsgId)}"]`,
      );
      if (byClient) return byClient;
    }
    return this.messagesEl.querySelector<HTMLElement>(`[data-id="${cssEscape(message.id)}"]`);
  }

  private buildMessageNode(message: UiMessage): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = `msg ${message.author}`;
    wrapper.setAttribute("data-id", message.id);
    if (message.clientMsgId) wrapper.setAttribute("data-client-id", message.clientMsgId);

    const bubble = document.createElement("div");
    bubble.className = "bubble";
    // Только текстовый узел: никакой разметки из сообщения не исполняется.
    appendLinkedText(bubble,message.text);
    if (message.author === "user") {
      bubble.style.background = this.settings.primaryColor || "#2f6df6";
    }
    if(!message.attachments?.length||!['','🖼','(вложение)'].includes(message.text))wrapper.appendChild(bubble);

    if (message.attachments && message.attachments.length > 0) {
      const box = document.createElement("div");
      box.className = "msg-attachments";
      for (const attachment of message.attachments) {
        const button=document.createElement('button');button.type='button';button.className='media-card';
        button.textContent=attachment.fileName;
        const load=()=>{button.disabled=true;void this.callbacks.onLoadAttachment(attachment.id).then(url=>{
          if(!button.isConnected)return;
          if(attachment.mime.startsWith('video/')){const video=document.createElement('video');video.src=url;video.controls=true;video.preload='metadata';video.playsInline=true;button.replaceWith(video);}
          else{const img=document.createElement('img');img.src=url;img.alt=attachment.fileName;const label=document.createElement('span');label.textContent=attachment.fileName;button.replaceChildren(img,label);button.disabled=false;
            button.onclick=()=>{void this.callbacks.onLoadAttachment(attachment.id).then(fresh=>{
              const overlay=document.createElement('div');overlay.className='media-preview';overlay.setAttribute('role','dialog');overlay.setAttribute('aria-label',attachment.fileName);
              const full=document.createElement('img');full.src=fresh;full.alt=attachment.fileName;const close=document.createElement('button');close.textContent='×';close.setAttribute('aria-label',this.strings.close);overlay.append(full,close);this.shadow.append(overlay);close.focus();overlay.onclick=()=>overlay.remove();overlay.onkeydown=e=>{if(e.key==='Escape')overlay.remove();};
            }).catch(()=>this.showError(this.strings.failed));};}
        }).catch(()=>{button.disabled=false;button.textContent=attachment.fileName;button.onclick=load;this.showError(this.strings.failed);});};
        button.onclick=load;
        if(attachment.mime.startsWith('image/')){
          const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){observer.disconnect();this.mediaObservers.delete(observer);load();}},{root:this.messagesEl,rootMargin:'100px'});
          observer.observe(button);this.mediaObservers.add(observer);
        }
        box.appendChild(button);
      }
      wrapper.appendChild(box);
    }

    const meta = document.createElement("div");
    meta.className = "msg-meta";
    const time = document.createElement("span");
    time.textContent = formatTime(message.createdAt);
    meta.appendChild(time);

    if (message.status === "sending") {
      const status = document.createElement("span");
      status.textContent = this.strings.sending;
      meta.appendChild(status);
    } else if (message.status === "failed") {
      const status = document.createElement("span");
      status.textContent = this.strings.failed;
      status.style.color = "#c0392b";
      meta.appendChild(status);

      if (message.clientMsgId) {
        const retry = document.createElement("button");
        retry.type = "button";
        retry.className = "retry-btn";
        retry.textContent = this.strings.retry;
        const clientMsgId = message.clientMsgId;
        retry.addEventListener("click", () => this.callbacks.onRetry(clientMsgId));
        meta.appendChild(retry);
      }
    }

    wrapper.appendChild(meta);
    if (message.author === 'agent' && /^\d+$/.test(message.id)) {
      meta.dataset.readMessageId = message.id;
      this.readObserver.observe(meta);
    }
    return wrapper;
  }

  private scrollToBottom(): void {
    requestAnimationFrame(() => {
      this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    });
  }

  destroy(): void {
    this.readObserver.disconnect();
    for (const timer of this.readTimers.values()) clearTimeout(timer);
    document.removeEventListener('visibilitychange', this.checkReads);
    window.removeEventListener('focus', this.checkReads);
    window.removeEventListener('blur', this.checkReads);
    for(const observer of this.mediaObservers)observer.disconnect();this.mediaObservers.clear();
    this.host.remove();
  }
}

function formatTime(iso: string): string {
  try {
    const date = new Date(iso);
    return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

/** Экранирование значения для селектора (CSS.escape есть не везде). */
function cssEscape(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}
