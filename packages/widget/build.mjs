/**
 * Сборка виджета в один файл widget.js.
 * Формат IIFE: скрипт подключается тегом <script> и ничего не оставляет в глобальной области,
 * кроме window.SovaChat.
 */
import { build, context } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url));

const options = {
  entryPoints: [path.join(dir, "src", "index.ts")],
  outfile: path.join(dir, "dist", "widget.js"),
  bundle: true,
  format: "iife",
  globalName: "SovaChatBundle",
  target: ["es2019"],
  minify: !process.argv.includes("--watch"),
  sourcemap: true,
  legalComments: "none",
  logLevel: "info",
  define: {
    "process.env.NODE_ENV": '"production"',
  },
};

if (process.argv.includes("--watch")) {
  const ctx = await context(options);
  await ctx.watch();
  // eslint-disable-next-line no-console
  console.log("Виджет пересобирается при изменениях…");
} else {
  await build(options);
}
