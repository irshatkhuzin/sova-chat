# Deployment

Sova runs behind an HTTPS reverse proxy with MySQL and Redis. PM2 supports a
combined API/worker process or separate API and worker processes.
For a shared, memory-constrained server, read [VPS coexistence](VPS-COEXISTENCE.md).

## Prerequisites

Install Node.js 22+, npm, MySQL, Redis, nginx (or another reverse proxy), PM2, and
FFmpeg/FFprobe. Use a dedicated application directory and service account.
Keep MySQL and Redis private. Do not reuse another application's credentials.

Create a dedicated database and account, replacing the password:

```sql
CREATE DATABASE sova CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'sova'@'127.0.0.1' IDENTIFIED BY 'REPLACE_WITH_RANDOM_PASSWORD';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, DROP, REFERENCES
  ON sova.* TO 'sova'@'127.0.0.1';
```

Application tables use the `sova_` prefix. Do not treat that prefix as a
substitute for database isolation. Review migrations before applying them.

## Build and configure

Clone your repository into the application directory:

```sh
npm ci
cp .env.example .env
```

Configure at least:

```ini
NODE_ENV=production
HOST=127.0.0.1
PORT=4000
PUBLIC_URL=https://chat.example.com
PANEL_URL=https://chat.example.com
TRUST_PROXY=1
DB_HOST=127.0.0.1
DB_USER=sova
DB_PASSWORD=REPLACE_WITH_DATABASE_PASSWORD
DB_NAME=sova
REDIS_HOST=127.0.0.1
REDIS_DB=3
REDIS_PREFIX=sova
REDIS_PASSWORD=REPLACE_WITH_REDIS_PASSWORD
JWT_SECRET=REPLACE_WITH_AT_LEAST_32_RANDOM_CHARACTERS
APP_ENCRYPTION_KEY=REPLACE_WITH_ANOTHER_RANDOM_SECRET
OPENAI_API_KEY=
```

Generate two independent secrets using:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Keep `.env` private (`chmod 600 .env` on Linux). Losing or changing
`APP_ENCRYPTION_KEY` prevents existing encrypted channel/provider secrets from
being decrypted. Provider settings can also be configured in the panel.

```sh
npm run build
npm run package:android-sdk
npm run migrate
npm run create-operator -w @sova/server -- --email admin@example.com --name "Administrator" --admin
```

The administrator command creates only the chosen operator. No products, channels,
articles, instructions, or provider accounts are preloaded. Configure them through
the panel after signing in. On updates, apply migrations without recreating users.

If building elsewhere, deploy package manifests, lockfile, compiled package
directories, server migrations, Android documentation and generated SDK ZIP,
and the PM2 configuration. Install production dependencies on the target:

```sh
npm ci --omit=dev
node packages/server/dist/src/cli/migrate.js
```

The compiled migration command does not need development-only `ts-node`.
The root `.env` is resolved independently of PM2's working directory.

## PM2

```sh
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
pm2 logs sova
```

Run the startup command printed by PM2 for your chosen service account.
Process names:

| Mode | Processes |
|---|---|
| Default `combined` | `sova` |
| `split` | `sova-api`, `sova-worker` |

For split mode, stop the old combined process deliberately before starting:

```sh
SOVA_PM2_MODE=split pm2 start ecosystem.config.cjs
```

Do not run both modes accidentally. Optional environment variables
`SOVA_HEAP_MB`, `SOVA_API_HEAP_MB`, `SOVA_WORKER_HEAP_MB`, and
`SOVA_NODE_BINARY` control heap limits and the Node executable.

## Reverse proxy

After provisioning a valid TLS certificate, use an HTTPS server block similar to:

```nginx
server {
    listen 443 ssl;
    server_name chat.example.com;
    ssl_certificate /etc/letsencrypt/live/chat.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/chat.example.com/privkey.pem;
    client_max_body_size 33m;

    location /socket.io/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
    }

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Configure HTTP-to-HTTPS redirection for your certificate setup. Validate with
`nginx -t` before reloading nginx. Node serves the built panel and widget.
Never expose the attachment storage directory directly through nginx.

For deployment under `/chat/`, build the panel with `SOVA_BASE_PATH=/chat/`,
set `PUBLIC_URL=https://example.com/chat` and the matching panel URL, and strip
the `/chat/` prefix when proxying to Node. Proxy the prefixed Socket.IO path
as well. Test cookies, widget loading, and reconnects under the chosen path.

## Updates and backups

Back up the database, configured attachment storage, and `.env` separately
before migrations. Verify restoration in a disposable installation. Relative
storage paths must be resolved using the application's configuration, not guessed
from the shell working directory.

For source deployments:

```sh
git pull --ff-only
npm ci
npm run build
npm run package:android-sdk
npm run migrate
pm2 reload ecosystem.config.cjs
```

Use the same PM2 mode as the existing deployment. Review schema compatibility
before attempting a rollback; reverting code does not reverse migrations.

## Verification

Check `/api/v1/health`, operator login, `/widget.js`, a visitor conversation,
an operator reply, and Socket.IO reconnects. Health reports database and Redis
availability and AI readiness; it is not a full end-to-end test.
See [manual checks](CHECKLIST.md) and [monitoring](RESOURCE-MONITORING.md).

| Symptom | Check |
|---|---|
| Widget unavailable | Public channel ID, enabled channel, allowed origin |
| AI does not answer | Provider settings, budget, worker process, conversation state |
| Operator reply failed | Translator settings and retry status |
| Socket connection fails | Proxy Upgrade headers and base path |
| Startup configuration error | Required secrets and validated environment values |
| SDK download missing | Run `npm run package:android-sdk` and deploy its output |