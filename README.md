# Sova

Self-hosted customer support for websites and Android apps, with an AI assistant,
a shared operator inbox, and automatic conversation translation.

Sova answers using your product's knowledge base and hands conversations to a
human when needed. Visitors receive replies in their language. The operator panel
and the default operator workflow currently use Russian; this repository's
documentation is in English.

## Features

- Website widget with anonymous and verified users, history recovery, typing
  indicators, read receipts, attachments, and idempotent message delivery.
- Android SDK with a Compose chat screen, Fragment embedding, themes, attachments,
  session management, and retry handling.
- Operator inbox with search, filters, original messages and translations,
  internal notes, moderation, and conversation handoff.
- Product-specific knowledge, AI instructions, spending limits, and separate
  screening, support, translation, and knowledge-learning roles.
- Reviewable knowledge proposals, article version history, and operator feedback
  on AI answers.
- MySQL message storage, Redis queues and locks, Socket.IO updates, and usage
  accounting.

## Repository layout

| Directory | Purpose |
|---|---|
| `packages/shared` | Shared types, protocols, and localization |
| `packages/server` | REST API, Socket.IO, workers, AI, and migrations |
| `packages/panel` | React operator panel |
| `packages/widget` | Embeddable website widget |
| `android-sdk` | Kotlin SDK and demo application |
| `examples` | Widget integration example |
| `docs` | Architecture, API, setup, and operating guides |
| `scripts` | Tests and maintenance utilities |

## Requirements

- Node.js 22 or later and npm.
- MySQL 8+ (or a compatible MariaDB installation) and Redis 6+.
- FFmpeg and FFprobe for image/video processing; see [media](docs/MEDIA.md).
- An OpenAI-compatible Chat Completions provider for AI and translation.

Without a configured AI provider, conversations can be handed to an operator.
Cross-language replies still need a working translation provider.

## Quick start

Run commands from the repository root:

```sh
npm ci
cp .env.example .env
```

On PowerShell, use `Copy-Item .env.example .env`. Set `JWT_SECRET` and
`APP_ENCRYPTION_KEY` to two different random values (at least 32 characters each).
Run this command separately for each secret:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Start development infrastructure:

```sh
docker compose -f docker-compose.dev.yml up -d
```

The development database uses `DB_USER=sova`, `DB_PASSWORD=sova`, and
`DB_NAME=sova`. Set these in `.env`. If ports 3306 or 6379 are occupied, use your
existing local services or change the port mappings and environment accordingly.
The Compose credentials are for local development only.

Configure your AI provider in `.env` or later in the operator panel. Then:

```sh
npm run build:server
npm run migrate
npm run create-operator -w @sova/server -- --email admin@example.com --name "Administrator" --admin
npm run dev
```

The operator command creates your administrator and prints a generated password.
Save it privately. A fresh installation contains no products, channels, knowledge
articles, owner instructions, or provider credentials. Sign in and create each
product, its instructions, published knowledge, and web/Android channels yourself.
Configure AI connections and budgets before enabling the assistant.

- Operator panel: [localhost:5173](http://localhost:5173)
- API: [localhost:4000/api/v1/health](http://localhost:4000/api/v1/health)
- Widget script: [localhost:4000/widget.js](http://localhost:4000/widget.js)

After creating your first web channel, copy its public ID into [examples/test-page.html](examples/test-page.html).
Serve the example through a local HTTP server and allow that origin in the
channel settings.

## Embed the website widget

```html
<script
  src="https://chat.example.com/widget.js"
  data-channel-id="PUBLIC_CHANNEL_ID"
  async
></script>
```

The panel's channel settings provide a ready-to-use snippet. Channel appearance
and translations are managed in the panel. Shadow DOM isolates the widget from
host-page styles. For authenticated users, sign identity tokens on your backend;
never embed the channel signing secret in client code.

## Android

See the [Android SDK guide](android-sdk/README.md) and
[Fragment embedding guide](android-sdk/EMBEDDING.md). The SDK is distributed as
source, not as a published Maven artifact. Run `npm run package:android-sdk` before
deploying if you want the panel's SDK download to be available.

## Language behavior

Channel titles, greetings, and handoff notices use Russian source text. The widget
and SDK support `ru`, `en`, `de`, `fr`, `es`, `pt`, `it`, `tr`, `uk`, and
`zh`. Automatic mode follows the browser/device language, using English for
unsupported languages. If channel translation fails, appearance text falls back
to Russian. Conversation language is determined separately.

The translation cache is keyed by channel, source-text hash, and target language.
Color or position changes do not trigger another translation; text edits do.
The configured translator and product budget apply.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Start API, worker, panel, and widget watcher |
| `npm run build` | Build all web/server packages |
| `npm run typecheck` | Check TypeScript types |
| `npm test` | Run isolated regression tests after building |
| `npm run check:publication` | Check the Git publication file set |
| `npm run package:android-sdk` | Generate the downloadable SDK source ZIP |
| `npm run migrate` | Apply database migrations |
| `npm run create-operator -w @sova/server -- --email operator@example.com --name "Operator" --admin` | Create an administrator |

## Documentation

- [Architecture](docs/ARCHITECTURE.md) and [data model](docs/DATA-MODEL.md)
- [API](docs/API.md) and [AI configuration](docs/AI-AGENTS.md)
- [Deployment](docs/DEPLOY.md) and [shared VPS](docs/VPS-COEXISTENCE.md)
- [Media](docs/MEDIA.md) and [resource monitoring](docs/RESOURCE-MONITORING.md)
- [Testing](docs/TESTING.md), [manual checklist](docs/CHECKLIST.md), and [roadmap](docs/ROADMAP.md)
- [Contributing](CONTRIBUTING.md) and [security](SECURITY.md)

## Project status

Sova is under active development. Android currently polls for messages and has no
durable outgoing queue across process restarts. Telegram and webhook support
channels, mobile push notifications, and broader operator-panel localization are
future work. Telegram operator notifications are already separate from that
planned support-channel integration.

## License

[MIT](LICENSE). Third-party components retain their own licenses.