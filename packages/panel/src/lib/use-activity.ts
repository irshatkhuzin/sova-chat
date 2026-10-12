import { useEffect, useRef, useState } from 'react';
import { PanelCommands, PanelEvents, type UserPresence } from '@sova/shared';
import { getPanelSocket } from './socket';

export function useActivity(endUserIds: string[]) {
  const [presence, setPresence] = useState<Record<string, UserPresence>>({});
  const [typing, setTyping] = useState<Record<string, number>>({});
  const ids = useRef(endUserIds);
  ids.current = endUserIds;
  const signature = [...new Set(endUserIds)].sort().join(',');
  useEffect(() => {
    const socket = getPanelSocket();
    let disposed = false;
    const sync = () => {
      if (!socket.connected) return;
      socket.timeout(5000).emit(PanelCommands.Presence, { endUserIds: ids.current },
        (err: unknown, res?: { ok: boolean; items: UserPresence[] }) => {
          if (!disposed && !err && res?.ok) setPresence(Object.fromEntries(res.items.map(p => [p.endUserId, p])));
        });
    };
    const onPresence = (p: UserPresence) => {
      if (ids.current.includes(p.endUserId)) setPresence(prev => ({ ...prev, [p.endUserId]: p }));
    };
    const onTyping = (p: { conversationId: string; who: string; active?: boolean }) => {
      if (p.who !== 'user') return;
      setTyping(prev => {
        const next = { ...prev };
        if (p.active !== false) next[p.conversationId] = Date.now() + 6000;
        else delete next[p.conversationId];
        return next;
      });
    };
    const reset = () => { setPresence({}); setTyping({}); };
    socket.on('connect', sync).on('disconnect', reset).on(PanelEvents.Presence, onPresence).on(PanelEvents.Typing, onTyping);
    const first = setTimeout(sync, 600);
    const poll = setInterval(sync, 20_000);
    const expiry = setInterval(() => setTyping(prev => {
      const alive = Object.entries(prev).filter(([, until]) => until > Date.now());
      return alive.length === Object.keys(prev).length ? prev : Object.fromEntries(alive);
    }), 1000);
    const focus = () => { if (document.visibilityState === 'visible') sync(); };
    document.addEventListener('visibilitychange', focus);
    return () => {
      disposed = true;
      clearTimeout(first); clearInterval(poll); clearInterval(expiry);
      socket.off('connect', sync).off('disconnect', reset).off(PanelEvents.Presence, onPresence).off(PanelEvents.Typing, onTyping);
      document.removeEventListener('visibilitychange', focus);
    };
  }, [signature]);
  return { presence, typing };
}
