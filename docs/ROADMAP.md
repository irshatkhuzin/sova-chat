# Roadmap

This is a direction of travel, not a release schedule. Open an issue to discuss a
substantial change before implementing it.

## Available today

- Website widget, operator panel, MySQL storage, Redis queues, and translations.
- Anonymous and verified users, ordered history, duplicate suppression, read receipts.
- Product knowledge, AI roles, moderation, spending limits, handoff.
- Reviewable learning proposals, article versions, and operator feedback.
- Compose Android screen, Fragment embedding, themes, attachments, retry handling.
- Image and short-video processing.

## Next areas

### Android

- Persistent realtime transport instead of polling.
- Durable outgoing queue across application restarts.
- Push notifications and device-token management.
- Published Maven artifacts.

### Channels

- Telegram as a customer support channel (operator notifications already exist).
- Signed webhook events with retries and inbound-channel handling.

### Knowledge and AI quality

- More general retrieval beyond the current full-text search.
- Broader imports from documents and websites.
- Operator reply suggestions and topic-level quality reporting.

### Teams and accessibility

- Operator-panel localization beyond Russian.
- Product-level access controls and richer assignment workflows.
- Accessibility review and reporting on response time, resolution, and cost.

## Outside the current scope

Multi-tenant SaaS billing, voice/video calls, and an S3 storage implementation.
The current deployment model is self-hosted and single-tenant.