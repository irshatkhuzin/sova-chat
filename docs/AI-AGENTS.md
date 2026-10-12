# AI configuration

Sign in as an administrator and open the AI agents page. Changes apply to new
requests without restarting the application.

## Connection and roles

1. Configure an OpenAI-compatible Chat Completions base URL and API key.
   Keys are encrypted and never returned to the panel. An empty key field keeps
   the existing key; use the explicit deletion control to remove it.
2. Choose models for screening, support, translation, and knowledge learning.
   Roles can inherit the shared connection or use their own. Changing a base URL
   requires re-entering its key.
3. Enter the provider's current input/output prices per million tokens.
   Accounting is an estimate, not the provider's invoice. Zero prices disable
   cost accounting for those tokens. Model options include completion-token
   limits and disabling temperature when necessary.
4. Save and test the connection. This makes a small provider request and can
   incur a charge. A product's explicit support-model override takes precedence
   over the role model; role pricing still applies.

The implementation targets `/chat/completions` with structured JSON responses
for relevant roles. Other native provider APIs require adapters. Keep the
original `APP_ENCRYPTION_KEY` with encrypted-setting backups.

## Instructions

Product names and descriptions are routing metadata. Define the assistant's
public role, supported products, and factual boundaries in product instructions.
Do not claim the model can read arbitrary linked pages without an actual tool.
Published owner-provided installation links can be returned from knowledge.

Additional role instructions can be global or product-specific. Product
additions take precedence over global additions; built-in role tasks, response
formats, handoff requirements, and privacy constraints still apply.
Each additional field is limited to 4,000 characters. Keep screening instructions
short because they are sent with requests. Connection tests do not execute
the full role workflow.

## Screening and moderation

Messages are stored before screening. Obvious repeated spam can be rejected
locally; other messages can use the screening model. Screening failure allows
the support request through. Short answers, IDs, complaints, and attachments are
not spam merely because of their format.

Rejected messages do not add operator unread counts or enter normal operator/AI
history. Administrators can inspect and restore them.
Three clearly spammy messages within ten minutes can cause a 24-hour block.
Directed abuse without a support question can be rejected at high confidence;
negative feedback or frustration in a genuine request is not sufficient.

Manual blocks apply to a visitor within a product, not an IP address. More than
eight distinct messages in ten seconds triggers a 15-minute sending block before
AI processing. Retries with the same client message ID do not count again.
Blocked visitors retain history access but new messages/uploads return HTTP 423.
Anonymous visitors clearing browser storage may create a new identity.

## Translation and learning

Translation continues while an operator owns a conversation.
Knowledge learning is disabled by default. Once configured and enabled, closing
a conversation with an operator answer can queue a review of its last 40
customer/operator messages. Common secret/contact formats are masked, but a human
must still review proposals for personal data.

Proposals can be edited, rejected, published as new FAQ articles, or used to
replace a selected article of the same product. Exact duplicate drafts are
suppressed. Article versions support review and rollback; rolling a new article
back to its pre-publication version unpublishes it. Learning does not rewrite
the product's main instruction. Failed/skipped analysis can be retried.
A reopened conversation must not complete an outdated close-analysis job.

## Operator feedback

Sent AI answers have positive/negative feedback controls. The latest change
records its operator. Comments (up to 2,000 characters) and corrections (up to
4,000) are panel-only.

Positive feedback can request a learning draft. Negative feedback without an
explanation is saved without a model call. A correction or explanation can
trigger learning even while the conversation is open. The context includes the
rated reply and up to eight messages, each capped at 1,800 characters; internal
notes and rejected spam are excluded and masking applies.

Drafts require approval before publication. Changing feedback replaces an older
unpublished draft; concurrent changes during analysis are blocked. Repeating
the same feedback does not trigger duplicate analysis. Removing a learning job
does not remove the feedback or a published article.

## Implementation references

Migrations `002_ai_agents.sql`, `003_agent_instructions.sql`, and
`011_message_feedback.sql` introduce role settings, instructions, and feedback.
Use a disposable installation for live verification; see [testing](TESTING.md).
