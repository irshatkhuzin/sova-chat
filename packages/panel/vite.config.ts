import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

/**
 * В режиме разработки панель работает на 5173 и проксирует API и сокет на сервер.
 * Благодаря этому cookie-сессия остаётся same-origin — так же, как в production,
 * где nginx отдаёт собранную панель и API с одного домена.
 */
export default defineConfig({
  base: process.env.SOVA_BASE_PATH || "/",
  plugins: [react()],
  resolve: {
    alias: {
      "@sova/shared": fileURLToPath(new URL("../shared/src/index.ts", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:4000", changeOrigin: true },
      "/socket.io": { target: "http://localhost:4000", ws: true, changeOrigin: true },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
    chunkSizeWarningLimit: 900,
  },
});
