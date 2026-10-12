# Manual verification

Use a disposable installation with synthetic users. Build, migrate, create an administrator, and
start the application as described in the [README](../README.md).
Create your own channels and published knowledge. Configure a working provider for AI/translation checks. These requests may incur
provider charges.

The current panel labels are Russian; the actions below describe their meaning
in English.

## Main flow

| Step | Expected result |
|---|---|
| Sign in using your administrator credentials | Inbox loads |
| Create and open your first product | Instructions, handoff rules, budgets visible |
| Add a knowledge article | Saved article available to AI when published |
| Open a web channel | Integration snippet available |
| Configure and serve the example page | Widget loads without host CSS conflicts |
| Ask an English question covered by knowledge | Relevant English answer |
| Open the conversation in the panel | Originals and Russian translations visible |
| Ask to speak to a human | Handoff notice and waiting-operator state |
| Take over and reply in Russian | Visitor receives the translated reply |
| Send another visitor message | Operator receives it; AI remains silent |
| Return to AI | Next visitor message can receive an AI answer |
| Close, then send a new message | Configured reopen policy applies |
| Reload the widget page | History restores without duplicates |
| Disconnect/reconnect while sending | Delivery recovers without duplicates |
| Upload an image and short video | Authorized preview works in both clients |
| Open a private browser window | Another visitor cannot see the first history |
| Open settings | Provider readiness and usage visible |

## Races and failures

- Take over while AI is generating: the stale AI answer must not reach the
  visitor. Inspect the conversation event log.
- Disable the support provider in the test environment: the message is saved and
  the conversation is handed off, without a fabricated answer. Clear role-level
  overrides as well as environment keys when testing this.
- Break the translator connection: the reply becomes failed and can be retried.
  Restore the connection and retry; untranslated Russian must not be sent to a
  foreign-language visitor.
- Expire the panel session and reconnect: refresh should restore access without
  an unbounded authentication retry loop.
- Hide/unfocus the visitor page: unread messages should not be marked read until
  actually visible.
- Block and unblock a synthetic visitor: sending/uploading is blocked while
  existing history remains accessible.

## Access boundaries

- A public channel ID must not reveal another visitor's history.
- Disallowed web origins cannot create a session.
- Incorrectly signed identity tokens are rejected.
- Unauthenticated or unrelated sessions cannot download private attachments.
- HTML-like messages are displayed as text, not executed.
- Attempts to override AI rules must not expose private instructions or data.
  Record model/version and examples; a single passing test is not a guarantee.

## Android

Test anonymous and identified sessions, logout, app background/foreground,
Fragment navigation, failed-send retry, HTTP 429 pauses, attachment viewing,
channel language, and theme. Confirm the host app never contains signing or
provider secrets.