package chat.sova.sdk

import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.*
import org.junit.Test

internal class MemoryStore : SovaSessionStore {
    override var sessionToken: String? = "test-session"
    override var visitorKey: String? = "test-visitor"
    override var lastSeq = 0
    override var lastReadSeq = 0
    override var conversationId: String? = "1"
    override fun ensureVisitorKey() = visitorKey ?: "test-visitor".also { visitorKey = it }
    override fun clear() { sessionToken = null; visitorKey = null; lastSeq = 0; lastReadSeq = 0; conversationId = null }
}

class SovaNetworkTest {
    @Test fun rateLimitBlocksHistorySendAndAttachmentWithoutExtraRequests() {
        MockWebServer().use { server ->
            server.start()
            val api = SovaApi(server.url("/").toString(), MemoryStore())
            server.enqueue(MockResponse().setResponseCode(429).addHeader("Retry-After", "120"))
            val first = runCatching { api.history(0) }.exceptionOrNull() as SovaApiException
            assertEquals(429, first.status)
            assertTrue(first.retryAfterMs!! >= 119000)
            assertEquals(429, (runCatching { api.send("id", "hello", emptyList(), "ru") }.exceptionOrNull() as SovaApiException).status)
            assertEquals(429, (runCatching { api.attachmentBytes("00000000-0000-0000-0000-000000000001") }.exceptionOrNull() as SovaApiException).status)
            assertEquals(1, server.requestCount)
        }
    }

    @Test fun retryKeepsClientIdAndDoesNotSkipEarlierOperatorReply() = runBlocking {
        MockWebServer().use { server ->
            server.start()
            val store = MemoryStore()
            val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
            val repo = SovaRepository(SovaConfig(server.url("/").toString(), "channel"), SovaApi(server.url("/").toString(), store), store, scope) {}
            try {
                server.enqueue(MockResponse().setResponseCode(503).setBody("{}"))
                assertFalse(repo.send("hello"))
                val first = Json.parseToJsonElement(server.takeRequest().body.readUtf8()).jsonObject
                val id = first.getValue("clientMsgId").jsonPrimitive.content
                server.enqueue(MockResponse().setBody("""{"conversationId":"1","conversationStatus":"ai","message":{"id":"3","seq":3,"author":"user","text":"hello","createdAt":"2026-10-08T10:00:00Z"}}"""))
                assertTrue(repo.send("hello"))
                val second = Json.parseToJsonElement(server.takeRequest().body.readUtf8()).jsonObject
                assertEquals(id, second.getValue("clientMsgId").jsonPrimitive.content)
                assertEquals(0, store.lastSeq)
                server.enqueue(MockResponse().setBody("""{"settings":{"locale":"ru"},"strings":{"send":"Отправить"}}"""))
                server.enqueue(MockResponse().setBody("""{"conversationId":"1","lastSeq":3,"messages":[{"id":"2","seq":2,"author":"operator","text":"earlier reply","createdAt":"2026-10-08T09:59:00Z"},{"id":"3","seq":3,"author":"user","text":"hello","createdAt":"2026-10-08T10:00:00Z","clientMsgId":"$id"}]}"""))
                repo.poll()
                assertTrue(server.takeRequest().path!!.startsWith("/api/v1/client/config?"))
                assertEquals("/api/v1/client/messages?afterSeq=0&uiLanguage=ru", server.takeRequest().path)
                assertEquals(listOf("2", "3"), repo.messages.value.map { it.id })
                assertEquals(3, store.lastSeq)
                assertNull(repo.sendError.value)
            } finally { scope.cancel() }
        }
    }

    @Test fun failedSessionIsNotRequestedRepeatedly() = runBlocking {
        MockWebServer().use { server ->
            server.start()
            val store = MemoryStore().apply { sessionToken = null }
            val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
            val repo = SovaRepository(SovaConfig(server.url("/").toString(), "channel"), SovaApi(server.url("/").toString(), store), store, scope) {}
            try {
                server.enqueue(MockResponse().setResponseCode(429).addHeader("Retry-After", "900"))
                assertFalse(repo.ensureSession())
                assertFalse(repo.ensureSession())
                assertEquals(1, server.requestCount)
            } finally { scope.cancel() }
        }
    }

    @Test fun forbiddenDoesNotMeanExpiredSession() {
        assertFalse(SovaApiException(403, "forbidden", "Channel disabled").isAuthError)
        assertTrue(SovaApiException(401, "unauthorized", "Expired").isAuthError)
    }
}
