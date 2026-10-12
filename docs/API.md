# API

REST routes use the `/api/v1` prefix and JSON except raw attachment bodies.
This is an integration overview; route schemas in
`packages/server/src/http/routes` are authoritative.

Errors follow this shape:

```json
{ "error": { "code": "validation_error", "message": "Human-readable description" } }
```

Codes include `unauthorized`, `forbidden`, `not_found`, `validation_error`,
`rate_limited`, `conflict`, `payload_too_large`, `unsupported_media_type`,
`ai_unavailable`, `translation_failed`, and `internal_error`.
Human-readable runtime errors may currently be in Russian.

## Visitor authentication

Use `X-Sova-Session: <sessionToken>` (Bearer authentication is also accepted).
A channel public ID is not a session credential.

### GET /client/config?channel=PUBLIC_ID

Returns public channel settings needed before session creation:

```json
{
  "channelId": "1",
  "productName": "Example product",
  "settings": {},
  "serverUrl": "https://chat.example.com"
}
```

### POST /client/session

```json
{
  "channelPublicId": "PUBLIC_CHANNEL_ID",
  "visitorKey": "OPTIONAL_PREVIOUS_VISITOR_KEY",
  "authToken": "OPTIONAL_BACKEND_SIGNED_TOKEN",
  "languageHint": "en-US"
}
```

Omit optional fields when unused. The response includes `sessionToken`,
`visitorKey`, user details, current conversation (possibly without an ID yet),
and widget settings. Web channels check Origin and rate limits.

Verified identity tokens are signed by the integrating backend:

```text
body = base64url(JSON)
token = body + "." + hex(HMAC_SHA256(channelSecret, body))
JSON = { externalId, name, email, exp }
```

`exp` is a future Unix timestamp in seconds. Never place `channelSecret` in a
browser or app. A client-supplied user ID alone is not proof of identity.
Invalid signatures are rejected.

### GET /client/messages?afterSeq=N

Returns history or messages missed after reconnect, including
`conversationId`, `status`, `lastSeq`, `language`, and `messages`.
Visitor-facing authors are `user`, `agent`, or `system`; AI and operators both
appear as `agent`.

### POST /client/messages

```json
{
  "clientMsgId": "UNIQUE_MESSAGE_UUID",
  "text": "How can I reset my password?",
  "attachmentIds": [],
  "languageHint": "en-US"
}
```

The response contains `conversationId`, `conversationStatus`, `duplicate`,
and `message`. Reusing the same client message ID returns the existing message
with `duplicate: true`.

### POST /client/attachments?name=screenshot.png

Send raw file bytes with the appropriate Content-Type. The response contains an
`attachment`. Validation checks actual content, not just the name or header.
See [media limits](MEDIA.md).

### POST /client/session/logout

Revokes the session. Conversation records remain on the server.

## Operator panel

Authentication uses httpOnly `sova_at` and refresh `sova_rt` cookies.
Mutating requests require `X-Sova-Csrf: 1`.

| Route | Purpose |
|---|---|
| `POST /auth/login` with `{email, password}` | Sign in |
| `POST /auth/refresh` | Rotate refresh and renew access |
| `POST /auth/logout` | Sign out |
| `GET /auth/me` | Current operator |
| `GET /conversations` | Filtered/paginated inbox |
| `GET /conversations/search?q=` | Search original and translated text |
| `GET /conversations/:id` | Conversation details and related cases |
| `GET /conversations/:id/messages` | Original, operator translation, outbound text |
| `GET /conversations/:id/events` | State/event history |
| `POST /conversations/:id/messages` with `{textRu}` | Send operator reply |
| `POST /conversations/:id/messages/:messageId/retry` | Retry translation/delivery |
| `POST /conversations/:id/take` | Take over |
| `POST /conversations/:id/return-to-ai` | Return to AI |
| `POST /conversations/:id/close` | Close |
| `POST /conversations/:id/read` | Mark read |
| `POST /conversations/:id/language` with `{language}` | Set language |
| `GET/POST /conversations/:id/notes` | Internal notes |
| `POST /conversations/:id/attachments?name=` | Operator upload |

Inbox filters include `productId`, `channelId`, `status`, `unread`, `search`,
`limit`, and `offset`.

Panel message fields include `id`, `seq`, `authorType`, `originalText`,
`originalLang`, `translationRu`, `outboundText`, `outboundLang`,
`translationStatus`, `translationError`, `deliveryStatus`, `aiMeta`,
`attachments`, and `createdAt`. Names such as `textRu` and `translationRu`
are retained because the current operator workflow is Russian.

## Administration

| Route family | Purpose |
|---|---|
| `/admin/products` | Products, AI instructions, limits |
| `/admin/channels` | Channels and connection snippets |
| `POST /admin/channels/:id/regenerate-secret` | Rotate identity signing secret |
| `POST /admin/channels/:id/sample-token` | Generate integration example token |
| `/admin/knowledge` | Knowledge articles |
| `/admin/operators` | Operators |
| `GET /admin/usage` | Usage estimates |
| `GET /admin/status` | Provider/configuration status |
| `/admin/agents` | Role configuration, instructions, learning |
| `GET /admin/sdk/android` | Generated SDK source ZIP |
| `GET /admin/sdk/android/readme` | SDK guide |

Products, channels, and knowledge support collection GET/POST and item
GET/PATCH/DELETE routes; permissions and accepted fields depend on the route.
Inspect schemas before writing an external administrative client.

## Files

`GET /api/v1/files/:id` requires an authorized operator session or the owning
visitor's session header. Do not make storage paths public or put session tokens
in file URLs.

## Realtime

Socket.IO uses `/socket.io` (prefixed when deployed under a subpath).

The `/client` namespace uses handshake `auth: { token, conversationId }`.
Events include `ready`, `message`, `conversation:status`, `typing`, and
client `sync` with `{lastSeq}` and an acknowledgement containing missed messages.

The `/panel` namespace authenticates via cookie. Events include `message`,
`message:updated`, `conversation:updated`, `handoff`, and `typing`.
Clients must recover stored history after reconnect; events alone are not durable.

## Default rate limits

| Operation | Default |
|---|---|
| Visitor session creation | 30 per hour per IP |
| Visitor messages | 20 per minute per session |
| Uploads | 20 per five minutes per session |
| Operator login | 10 per 15 minutes per IP |
| Operator messages | 120 per minute |

Some values are environment-configurable. Moderation
have additional limits. Respect HTTP 429 and Retry-After.
