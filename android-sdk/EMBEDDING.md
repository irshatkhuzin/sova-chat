# Embed the chat screen in a Fragment

Initialize Sova once in your Application with your server URL and public channel
ID. Keep signing and provider secrets on your backend.

```kotlin
Sova.init(this, SovaConfig(
    serverUrl = "https://chat.example.com",
    channelPublicId = "PUBLIC_CHANNEL_ID"
))
```

## Fragment integration

```kotlin
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.ViewCompositionStrategy
import androidx.fragment.app.Fragment
import chat.sova.sdk.SovaChatScreen

class SupportChatFragment : Fragment() {
    override fun onCreateView(
        inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?
    ): View = ComposeView(requireContext()).apply {
        setViewCompositionStrategy(ViewCompositionStrategy.DisposeOnViewTreeLifecycleDestroyed)
        setContent {
            SovaChatScreen(
                onBack = { requireActivity().onBackPressedDispatcher.onBackPressed() }
            )
        }
    }
}
```

The demo's `EmbeddedChatActivity.kt` includes a complete example.
`Sova.openChat(activity)` opens the same screen in an Activity.
`SovaChat(onBack)` remains compatible.

The screen fills the space given by its parent and accepts a modifier.
Set `showHeader = false` if the host provides its own header. The SDK handles
top insets and, by default, keyboard insets. The host Fragment owns bottom system
insets. Set `handleImeInsets = false` if the host already handles the keyboard.

## Appearance

```kotlin
import androidx.compose.ui.graphics.Color
import chat.sova.sdk.*

SovaChatScreen(
    onBack = { /* Navigate back. */ },
    appearance = SovaChatAppearance(
        title = "Product support",
        useChannelTexts = false,
        placeholder = "Write a message...",
        showHeader = true,
        showBranding = true,
        themeMode = SovaThemeMode.LIGHT,
        colors = SovaChatColors().copy(
            outgoingBubble = Color(0xFF303149),
            sendButton = Color(0xFF303149),
            link = Color(0xFF123F79)
        )
    )
)
```

With `colors = null`, the palette follows `themeMode` (SYSTEM, LIGHT, DARK).
Use `SovaChatColors.dark().copy(...)` for custom dark colors. Typography inherits
the host MaterialTheme. Channel text is used by default; disable it only when
the host intentionally supplies its own labels. Built-in service/error strings
in that mode currently fall back to Russian.

## Links and attachments

Plain HTTP(S) links and Markdown links are clickable. Google Play URLs prefer
the Play Store app and fall back to Android ACTION_VIEW. Other links use the
registered system handler. File, intent, javascript, and credential-bearing
URLs are not launched.

The SDK owns selection, upload, authorized download, and media viewing.
A failed send keeps the draft and attachments. Retry reuses the same ID while
the content is unchanged and the process remains alive. A new body or attachment
list is a new message. There is no cross-process durable outgoing queue.

## Network and lifecycle

HTTP 429 honors Retry-After seconds or HTTP-date. Without a valid header,
backoff grows through 60, 120, 240, and 300 seconds. New network requests,
including media requests, respect the pause. History polling resumes
automatically; failed sends remain user-initiated retries.

HTTP 401 can refresh a session; 403 does not create a reauthentication loop.
A send response does not advance the history cursor past unseen operator
messages. Polling stops in the background or after leaving the screen.
Multiple active screens share repository polling. Switching identity clears
retry state and UI state.

## Updating an existing integration

1. Back up your current module.
2. Replace the SDK source and drawable resources together; replacing only the
   Activity is insufficient.
3. Retain your host project's compatible Gradle/plugin/version-catalog setup.
   Required dependencies include Material3, Compose UI/Foundation,
   activity-compose, lifecycle, coroutines, serialization, OkHttp, and
   security-crypto. Public Compose types must be visible to the host.
4. Existing `SovaChat(onBack)` calls remain compatible; use `SovaChatScreen`
   for appearance customization.
5. If copying tests, include their test dependencies separately from runtime
   dependencies. Build and exercise the host app before distribution.

See [README.md](README.md) for standalone build requirements.