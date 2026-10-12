/** Подключение панели к Socket.IO и состояние соединения. */
import { io, type Socket } from "socket.io-client";
import { PANEL_NAMESPACE } from "@sova/shared";
import { refreshSession } from './api';

let socket: Socket | null = null;

export function getPanelSocket(): Socket {
  if (!socket) {
    socket = io(PANEL_NAMESPACE, {
      path: `${import.meta.env.BASE_URL}socket.io`,
      // Авторизация — по httpOnly-cookie, отдельный токен не нужен.
      withCredentials: true,
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10_000,
    });
    const current=socket;
    let refreshed=false;
    current.on('connect',()=>{refreshed=false;});
    current.on('connect_error',()=>{
      // Auth rejection stops Socket.IO retries. Refresh the cookie once, then reconnect.
      // Transport errors remain with the manager's normal backoff.
      if(current.active||refreshed||socket!==current)return;
      refreshed=true;
      void refreshSession().then(ok=>{if(ok&&socket===current)current.connect();});
    });
  }
  return socket;
}

export function closePanelSocket(): void {
  socket?.close();
  socket = null;
}
