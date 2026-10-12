# Architecture

Sova is a modular monolith: website widget and Android SDK connect to an API,
which stores messages, runs AI support, and hands conversations to an operator.
The current operator workflow uses Russian while visitors use their own language.

## Components

```text
Website widget ---- HTTP / Socket.IO ----+
Android SDK -------- HTTP polling -------+--> API and domain services --> MySQL
React panel -------- HTTP / Socket.IO ----+             |
                                                      Redis
                                                queues, locks, events
                                                       |
                                                     Worker
                                                       |
                                           AI / translation provider
```

PM2 can run API and workers together (`combined`, the default) or as separate
processes (`split`). Both use the same MySQL and Redis configuration.
Socket.IO uses a Redis adapter for cross-process events.

## Principles

1. MySQL is the durable source of truth. Redis holds queues, locks, presence,
   rate limits, and caches.
2. Save a message before acknowledging it. Client message IDs make retries
   idempotent.
3. Channel adapters separate transport from conversation logic. Web and Android
   are implemented; Telegram and webhook support channels are future work.
4. AI and translation providers sit behind interfaces. Provider credentials
   remain on the server.
5. Module services own their behavior; routes validate and coordinate requests.

## Modules

| Module | Responsibility |
|---|---|
| `auth` | Operator login, visitor sessions, signed identity tokens |
| `products` | Product instructions, handoff rules, and budgets |
| `channels` | Public IDs, encrypted secrets, origins, appearance |
| `users` | Product-scoped identities, language, environment, moderation |
| `conversations` | State transitions, assignment, unread counts |
| `messages` | Storage, sequence allocation, deduplication, read receipts |
| `knowledge` | Articles, retrieval, proposals, feedback, versions |
| `ai` | Screening, prompts, provider calls, validated decisions |
| `translation` | Language selection, translation, protected spans, caching |
| `files` | Validated uploads and authorized media access |
| `notifications` | Panel events and optional Telegram notifications |
| `usage` | Token accounting and estimated spending limits |

## Conversation state

- `ai`: AI support can answer.
- `waiting_operator`: AI is stopped; an operator is needed.
- `operator`: a human handles the conversation.
- `closed`: the conversation is closed.

Taking, returning, and closing a conversation changes its state version.
Product `reopen_policy` chooses what a new message in a closed conversation does:
`reopen_to_ai`, `reopen_to_operator`, or `new_conversation`.

The worker records the state/version before generation and rechecks before
writing an answer. If an operator has taken over, the answer is discarded and
recorded as an event. A Redis conversation lock also serializes AI work.

## Incoming messages

1. Validate session, product/channel access, length, and rate limits.
2. Store the message and allocate its sequence inside a transaction.
3. Acknowledge and publish an update; queue inbound processing.
4. Screen the message and determine conversation language.
5. Translate for the operator when needed.
6. If AI owns the conversation, retrieve knowledge and request a validated
   reply, clarification, or handoff.
7. Recheck state, store the result, and deliver it. Notify operators on handoff.

Product names and descriptions are routing metadata. Public assistant identity
belongs in product instructions. No product-specific data or owner instructions are bundled.

## Operator replies

The panel submits `textRu`. The server stores the original reply and translates
it when the visitor uses another language. Successful translation enables
delivery; a failed translation leaves the reply marked failed for retry instead
of sending untranslated Russian to that visitor.

## Ordering and recovery

Messages use a monotonically increasing `seq` per conversation, allocated while
locking the conversation row. Clients sort by sequence, not timestamps.
`UNIQUE (conversation_id, client_msg_id)` prevents duplicates.
Clients recover missing messages through `afterSeq`; socket events are hints,
not the sole copy of a message. Saved translations avoid repeat translation
requests when reopening history.

Redis loss does not erase stored conversations, but queue availability and
recovery still need monitoring. Do not assume a Redis outage is transparent.

## Security boundaries

Operator access uses authenticated cookies and CSRF headers for mutations.
A public channel ID cannot authorize access to another visitor's conversation.
Verified identity requires a backend-signed HMAC token. Allowed origins are an
additional browser restriction, not proof of identity.

Conversation and file access must enforce session ownership. Uploads are checked
by content and size. Message text is rendered as text, not arbitrary HTML.
Sensitive fields are redacted from structured logs. AI instructions constrain
untrusted messages; this is not a guarantee against every prompt-injection attempt.

See [deployment](DEPLOY.md), [API](API.md), and [security](../SECURITY.md).