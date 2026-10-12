package chat.sova.sdk

import android.graphics.Bitmap
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.ui.Modifier
import android.graphics.Canvas
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.*
import okhttp3.mockwebserver.*
import org.junit.Rule
import org.junit.Test
import org.junit.Assert.*
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "w400dp-h650dp-mdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class SovaScreenTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    @Test fun embedsScreenPreservesFailedDraftAndRendersWidgetLayout() {
        MockWebServer().use { server ->
            server.start()
            server.dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest) = if (request.method == "POST") MockResponse().setResponseCode(429).addHeader("Retry-After", "120")
                else MockResponse().setBody("""{"conversationId":"1","lastSeq":2,"messages":[{"id":"1","seq":1,"author":"user","text":"Where can I download the Android app?","createdAt":"2026-10-08T13:09:00Z"},{"id":"2","seq":2,"author":"operator","text":"Download the Android app from Google Play:\nhttps://play.google.com/store/apps/details?id=com.example.app","createdAt":"2026-10-08T13:09:00Z"}]}""")
            }
            val store = MemoryStore()
            val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
            val repo = SovaRepository(SovaConfig(server.url("/").toString(), "test"), SovaApi(server.url("/").toString(), store), store, scope) {}
            val field = Sova::class.java.getDeclaredField("repository").apply { isAccessible = true }
            field.set(null, repo)
            try {
                runBlocking { repo.loadHistory() }
                compose.setContent { SovaChatScreen(onBack = {}, modifier = Modifier.requiredSize(377.dp, 489.dp), appearance = SovaChatAppearance(showHeader = false, themeMode = SovaThemeMode.LIGHT, placeholder = "Type a message…")) }
                compose.onNodeWithText("Where can I download the Android app?").assertIsDisplayed()
                compose.onNodeWithText("Powered by Sova").assertIsDisplayed()
                compose.waitForIdle()
                val screenshot = File("build/reports/screenshots/sova-chat.png").apply { parentFile.mkdirs() }
                compose.runOnIdle {
                    val view = compose.activity.window.decorView
                    val bitmap = Bitmap.createBitmap(view.width, view.height, Bitmap.Config.ARGB_8888)
                    view.draw(Canvas(bitmap))
                    screenshot.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
                    bitmap.recycle()
                }
                compose.onNode(hasSetTextAction()).performTextInput("Проверка повторной отправки")
                compose.onNodeWithContentDescription("Отправить").performClick()
                compose.waitUntil(10000) { repo.sendError.value != null }
                compose.onNode(hasSetTextAction()).assertTextContains("Проверка повторной отправки")
                compose.onNodeWithContentDescription("Повторить отправку").assertIsDisplayed()
            } finally { repo.stopWatching(); scope.cancel(); field.set(null, null) }
        }
    }

    @Test fun rendersLocalizedChannelHeaderGreetingAndControls() {
        MockWebServer().use { server ->
            server.start()
            server.dispatcher = object : Dispatcher() {
                override fun dispatch(request: RecordedRequest) = MockResponse().setBody(
                    if (request.path!!.startsWith("/api/v1/client/config"))
                        """{"settings":{"title":"Support","subtitle":"We usually reply quickly","greeting":"How can we help?","locale":"en"},"strings":{"send":"Send","inputPlaceholder":"Type a message…","poweredBy":"Powered by Sova","attach":"Attach","close":"Close"},"localization":{"status":"cached"}}"""
                    else """{"messages":[]}"""
                )
            }
            val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
            val store = MemoryStore()
            val repo = SovaRepository(SovaConfig(server.url("/").toString(), "test"), SovaApi(server.url("/").toString(), store), store, scope) {}
            val field = Sova::class.java.getDeclaredField("repository").apply { isAccessible = true }
            field.set(null, repo)
            try {
                runBlocking { repo.loadHistory() }
                compose.setContent { SovaChatScreen(onBack = {}) }
                compose.onNodeWithText("We usually reply quickly").assertIsDisplayed()
                compose.onNodeWithText("How can we help?").assertIsDisplayed()
                compose.onNodeWithText("Type a message…").assertIsDisplayed()
                compose.onNodeWithContentDescription("Send").assertExists()
                compose.onNodeWithText("Поддержка").assertDoesNotExist()
            } finally { repo.stopWatching(); scope.cancel(); field.set(null, null) }
        }
    }
}
