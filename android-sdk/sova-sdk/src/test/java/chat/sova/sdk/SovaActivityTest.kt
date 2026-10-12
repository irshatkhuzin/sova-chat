package chat.sova.sdk

import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.*
import org.junit.Test

class SovaActivityTest {
    @Test fun readAcknowledgementContainsOnlyVisibleMessageIds() {
        MockWebServer().use { server ->
            server.start()
            val api = SovaApi(server.url("/").toString(), MemoryStore())
            server.enqueue(MockResponse().setBody("""{"receipts":[{"messageId":"42","readAt":"2026-10-08T18:00:00.000Z"}]}"""))
            val response = api.read(listOf("42"))
            assertEquals("42", response.receipts.single().messageId)
            val request = server.takeRequest()
            assertEquals("/api/v1/client/read", request.path)
            assertEquals("""{"messageIds":["42"]}""", request.body.readUtf8())
        }
    }
    @Test fun presenceUsesHistoryAndTypingNeverSendsDraftContents() {
        MockWebServer().use { server ->
            server.start()
            val api = SovaApi(server.url("/").toString(), MemoryStore())
            server.enqueue(MockResponse().setBody("""{"agentTyping":true,"conversationId":"1","messages":[]}"""))
            assertTrue(api.history(0, "en", "f02e4ef4-6cae-4e74-9195-76f8f9b7bc0c").agentTyping)
            val history = server.takeRequest()
            assertTrue(history.path!!.contains("presenceId=f02e4ef4-6cae-4e74-9195-76f8f9b7bc0c"))
            server.enqueue(MockResponse().setBody("""{"ok":true}"""))
            assertTrue(api.activity("f02e4ef4-6cae-4e74-9195-76f8f9b7bc0c", true, true).ok)
            val typing = server.takeRequest()
            assertEquals("/api/v1/client/activity", typing.path)
            assertEquals("""{"connectionId":"f02e4ef4-6cae-4e74-9195-76f8f9b7bc0c","online":true,"typing":true}""", typing.body.readUtf8())
            server.enqueue(MockResponse().setBody("""{"ok":true}"""))
            api.activity("f02e4ef4-6cae-4e74-9195-76f8f9b7bc0c", false, false)
            assertTrue(server.takeRequest().body.readUtf8().contains("\"online\":false,\"typing\":false"))
        }
    }
}
