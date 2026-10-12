package chat.sova.sdk

import kotlinx.coroutines.*
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.*
import org.junit.Test

class SovaLocalizationTest {
    @Test fun restoredSessionLoadsTranslatedSettingsAndPreservesInterfaceLanguage() = runBlocking {
        MockWebServer().use { server ->
            server.start()
            val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
            val store = MemoryStore()
            val repo = SovaRepository(SovaConfig(server.url("/").toString(), "test-channel"), SovaApi(server.url("/").toString(), store), store, scope) {}
            try {
                server.enqueue(MockResponse().setBody("""{"settings":{"title":"Support","subtitle":"Usually a few minutes","greeting":"How can we help?","handoffNotice":"Connecting you to an operator","locale":"en","allowAttachments":false},"strings":{"send":"Send","inputPlaceholder":"Type a message…"},"localization":{"status":"cached","effectiveLanguage":"en"}}"""))
                server.enqueue(MockResponse().setBody("""{"messages":[],"language":"ru"}"""))
                repo.loadHistory()
                assertTrue(server.takeRequest().path!!.startsWith("/api/v1/client/config?channel=test-channel&lang="))
                assertEquals("/api/v1/client/messages?afterSeq=0&uiLanguage=en", server.takeRequest().path)
                assertEquals("Support", repo.widget.value.settings.title)
                assertEquals("How can we help?", repo.widget.value.settings.greeting)
                assertEquals("en", repo.widget.value.settings.locale)
                assertEquals("Send", repo.widget.value.text("send", "Отправить"))
                assertFalse(repo.widget.value.settings.allowAttachments)
                assertEquals("test-session", store.sessionToken)
            } finally { scope.cancel() }
        }
    }
}
