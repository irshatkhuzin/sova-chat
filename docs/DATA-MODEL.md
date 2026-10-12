# Data model

The schema uses InnoDB, `utf8mb4`, and UTC timestamps, generally `DATETIME(3)`.
Physical application tables have the `sova_` prefix. The initial schema is in
`packages/server/migrations/001_init.sql`; later migrations extend it.
The SQL migrations are the authoritative field definitions.

## Relationships

```text
operators ----< operator_sessions
    |
    +----< internal_notes >---- conversations
                                   |
products ----< channels ------------+
    |             |                |
    |             +----< end_users-+
    |                       |
    |                       +----< end_user_sessions
    |
    +----< knowledge_articles
    +----< ai_usage
                                   |
conversations ----< messages ----< message_translations
    |                   +----< attachments
    +----< conversation_events
    +----< conversation_reads
```

## Core tables

| Table (without prefix) | Purpose and notable fields |
|---|---|
| `operators` | Panel users, bcrypt password hashes, `admin` or `operator` role |
| `operator_sessions` | SHA-256 refresh-token hashes, rotation, revocation |
| `products` | Instructions, AI parameters, handoff rules, language, budgets |
| `channels` | Transport, public ID, encrypted identity secret, origins, appearance |
| `end_users` | Product-scoped visitor identity and profile |
| `end_user_sessions` | Hashed session tokens and anonymous visitor keys |
| `conversations` | Product, channel, visitor, state, assignment, sequence |
| `messages` | Original content, sequence, client ID, author, delivery state |
| `message_translations` | Cached translations and translation errors |
| `attachments` | Private files and metadata |
| `internal_notes` | Operator-only notes |
| `conversation_reads` | Per-operator read position |
| `knowledge_articles` | Published/unpublished articles and full-text search |
| `ai_usage` | Model, task, token counts, and estimated cost |
| `conversation_events` | Handoffs, transitions, failures, discarded AI replies |

## Product and channel settings

Product `ai_instructions` defines the assistant's public role. Product names and
descriptions are administrative routing metadata, not its public identity.
Model parameters can override configured defaults. Clarification limits,
handoff keywords/rules, and daily/monthly spending limits control AI behavior.

A channel `public_id` is not secret. Its `auth_secret_enc` is encrypted with
AES-256-GCM using `APP_ENCRYPTION_KEY`. Back up that key separately.
`allowed_origins` constrains browser origins; an empty list is unrestricted.
Channel `settings` stores appearance and customer-facing texts.

## Identity and conversations

`UNIQUE (product_id, external_id)` joins a verified user's history within a
product. Anonymous users have a null external ID and are separate identities.

Conversation `status` is `ai`, `waiting_operator`, `operator`, or `closed`.
`state_version` increments on transitions to protect against stale AI replies.
`language` and language establishment/locking fields track the chosen language.
`last_seq` allocates message order; `handoff_reason`, `handoff_summary_ru`, and
`handoff_at` record transfers. `previous_conversation_id` links reopened cases
when the product creates a new conversation.

## Message invariants

- Allocate `seq` in a transaction locking the conversation row.
- Keep `UNIQUE (conversation_id, seq)` and
  `UNIQUE (conversation_id, client_msg_id)`.
- Preserve original text/language; translations live in separate records.
- Delivery is `pending`, `sent`, or `failed`.
- Authors are `user`, `ai`, `operator`, or `system`.
- Internal content never belongs in visitor-facing DTOs.
- AI writes must verify conversation state/version.

## Later migrations

| Migration | Area |
|---|---|
| `002_ai_agents.sql` | Role settings, screening, learning, knowledge versions |
| `003_agent_instructions.sql` | Additional role instructions |
| `006_conversation_language.sql` | Conversation language state |
| `007_user_moderation.sql` | Visitor moderation |
| `008_widget_localization.sql` | Channel translations and preferences |
| `009_message_reads.sql` | Visitor read receipts |
| `010_support_scope.sql` | Support scope |
| `011_message_feedback.sql` | Operator feedback and learning links |
| `012_client_environment.sql` | Client environment metadata |
| `013_deleted_channels.sql` | Deleted-channel handling |

Deletion rules are defined by foreign keys and service logic. Product deletion
can cascade through its data; back up and review the scope before using it.