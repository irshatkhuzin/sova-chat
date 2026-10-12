
const path = require("node:path");

const serverDir = path.join(__dirname, "packages", "server");
const mode = process.env.SOVA_PM2_MODE === "split" ? "split" : "combined";


const heap = {
  combined: Number(process.env.SOVA_HEAP_MB || 256),
  api: Number(process.env.SOVA_API_HEAP_MB || 256),
  worker: Number(process.env.SOVA_WORKER_HEAP_MB || 224),
};

const base = {
  cwd: serverDir,
  interpreter: process.env.SOVA_NODE_BINARY || "node",
  exec_mode: "fork",
  instances: 1,
  autorestart: true,
  watch: false,
  min_uptime: "10s",
  max_restarts: 10,
  restart_delay: 5_000,
  time: true,
};

const combined = {
  ...base,
  name: "sova",
  script: "dist/src/server.js",
  kill_timeout: 30_000,
  max_memory_restart: `${heap.combined + 120}M`,
  node_args: `--max-old-space-size=${heap.combined} --enable-source-maps`,
  env: {
    NODE_ENV: "production",

    SOVA_ROLE: "all",

    WORKER_CONCURRENCY: "2",
  },
};

const split = [
  {
    ...base,
    name: "sova-api",
    script: "dist/src/server.js",
    kill_timeout: 20_000,
    max_memory_restart: `${heap.api + 120}M`,
    node_args: `--max-old-space-size=${heap.api} --enable-source-maps`,
    env: { NODE_ENV: "production", SOVA_ROLE: "api" },
  },
  {
    ...base,
    name: "sova-worker",
    script: "dist/src/worker.js",
    kill_timeout: 30_000,
    max_memory_restart: `${heap.worker + 120}M`,
    node_args: `--max-old-space-size=${heap.worker} --enable-source-maps`,
    env: { NODE_ENV: "production", SOVA_ROLE: "worker", WORKER_CONCURRENCY: "4" },
  },
];

module.exports = {
  apps: mode === "split" ? split : [combined],
};
