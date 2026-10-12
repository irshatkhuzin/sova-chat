import { PanelEvents } from '@sova/shared';
import type { Socket } from 'socket.io-client';

export const attentionTitle = (count: number) => count > 0
  ? `(${count}) Sova — обращения для оператора`
  : 'Sova — панель поддержки';

/** Lives at app level: independent of route, list filters and page size. */
export function watchAttention(socket: Socket, load: () => Promise<{ count: number }>, apply: (count: number) => void): () => void {
  let stopped = false, running = false, dirty = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const refresh = async () => {
    if (stopped) return;
    if (running) { dirty = true; return; }
    running = true;
    try { const result = await load(); if (!stopped) apply(result.count); }
    catch { /* Keep the last known count until reconnect or the next retry. */ }
    finally { running = false; if (dirty && !stopped) { dirty = false; schedule(); } }
  };
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = undefined; void refresh(); }, 120);
  };
  const events = ['connect', PanelEvents.Message, PanelEvents.ConversationUpdated, PanelEvents.Handoff];
  events.forEach(event => socket.on(event, schedule));
  window.addEventListener('focus', schedule);
  document.addEventListener('visibilitychange', schedule);
  const interval = setInterval(schedule, 30_000);
  void refresh();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    clearInterval(interval);
    events.forEach(event => socket.off(event, schedule));
    window.removeEventListener('focus', schedule);
    document.removeEventListener('visibilitychange', schedule);
  };
}
