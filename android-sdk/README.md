# Sova Android SDK

Embed Sova support in an Android app using the same server and conversation model
as the website widget. The SDK provides a Compose screen, Fragment embedding,
themes, links, attachments, session management, and retry handling.

## Add the module

Create an Android channel for your product in the operator panel and copy its
server URL and public channel ID. Include any deployment path, such as `/chat`,
in the server URL.

The panel can distribute a source ZIP generated with
`npm run package:android-sdk`. This is not a prebuilt AAR or published Maven
package. Extract the source and adapt the module path to your checkout:

```kotlin
// settings.gradle.kts
include(":sova-sdk")
project(":sova-sdk").projectDir = file("../sova-chat/android-sdk/sova-sdk")
```

```kotlin
// App build.gradle.kts
dependencies {
    implementation(project(":sova-sdk"))
}
```

The standalone project uses compile SDK 34, min SDK 24, Kotlin 1.9, and Java 17.
Match Compose/Kotlin/Android Gradle Plugin versions with your host project.
The app needs `android.permission.INTERNET`.

## Initialize

Call once in `Application.onCreate()`:

```kotlin
Sova.init(
    context = this,
    config = SovaConfig(
        serverUrl = "https://chat.example.com",
        channelPublicId = "PUBLIC_CHANNEL_ID"
    )
)
```

The public ID is not a signing secret and does not authorize another visitor's
history. Never ship provider keys or channel signing secrets in the app.

## Open support

```kotlin
Sova.openChat(activity)
```

For an existing Fragment or Compose layout, see [EMBEDDING.md](EMBEDDING.md).
`SovaChat(onBack)` remains a compatibility entry point; the configurable screen
is `SovaChatScreen(onBack = ...)`.

## Identify and log out

Visitors are anonymous by default. After authenticating in your application,
obtain an identity token signed by your backend:

```kotlin
Sova.identify(signedToken)
```

Token format:

```text
base64url(JSON) + "." + hex(HMAC_SHA256(channelSecret, base64url(JSON)))
```

Backend example:

```js
const crypto = require("node:crypto");

function signSovaToken(externalId, channelSecret) {
  const payload = {
    externalId,
    name: "Example user",
    email: "user@example.com",
    exp: Math.floor(Date.now() / 1000) + 3600
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", channelSecret).update(body).digest("hex");
  return body + "." + signature;
}
```

A raw user ID from a client is not proof of identity. On logout:

```kotlin
Sova.logout()
```

The server session is revoked and local session/history state is cleared.
Server-side conversations remain available after identifying again with the
same external ID within the product.

## Unread messages

```kotlin
val count = Sova.unreadCount()
Sova.observeUnread { count -> /* Update a badge. */ }
```

Compose can collect `Sova.unread` as a StateFlow.

## Behavior and limitations

- History is synchronized using `afterSeq`; message retries reuse
  `clientMsgId` to prevent duplicates.
- The SDK polls while the screen is active; a persistent Socket.IO connection
  and mobile push notifications are not implemented.
- Failed sends retain text/attachments and can be retried. There is no durable
  outgoing queue across process termination.
- Attachments include images and short MP4/WebM videos. Default server limits:
  5 MiB images, 32 MiB and 60 seconds for video.
- Original media is accessed with authorization. AI samples video frames without
  audio; a vision-capable support model is required.
- Server-side channel settings control title, greeting, and labels by default.
  Automatic locale uses Android's language; a fixed channel language overrides it.
  Failed translations fall back to Russian. Conversation language is separate.
- `SovaChatAppearance.useChannelTexts = false` enables host-defined text;
  built-in fallback/service strings currently remain Russian.

## Server routes

The SDK uses `POST /api/v1/client/session`,
`GET /api/v1/client/messages?afterSeq=N`,
`POST /api/v1/client/messages`,
`POST /api/v1/client/attachments`, and
`POST /api/v1/client/session/logout`. It does not need a separate Android API.

## Build and test

With Gradle 8.7, JDK 17/21, and Android SDK 34:

```sh
gradle :sova-sdk:testDebugUnitTest :sova-sdk:assembleRelease :demo-app:assembleDebug
```

Run from this directory. The repository has no Gradle wrapper.
Tests use synthetic responses through JUnit, MockWebServer, and Robolectric.
The demo defaults to the emulator host address; configure your own channel.