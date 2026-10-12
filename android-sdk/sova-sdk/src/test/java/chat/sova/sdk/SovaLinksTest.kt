package chat.sova.sdk
import org.junit.Assert.*
import org.junit.Test

class SovaLinksTest {
    @Test fun plainAndMarkdownLinksPreserveQueriesAndLabels() {
        val text = parseSovaLinks("Скачать [Example App](https://play.google.com/store/apps/details?id=com.example.app) или https://example.com/help.")
        assertEquals("Скачать Example App или https://example.com/help.", text.text)
        assertEquals(2, text.links.size)
        assertEquals("Example App", text.text.substring(text.links[0].start, text.links[0].end))
        assertEquals("https://play.google.com/store/apps/details?id=com.example.app", text.links[0].url)
        assertEquals("https://example.com/help", text.links[1].url)
    }
    @Test fun refusesUnsafeSchemesAndFakeStoreHosts() {
        listOf("javascript:alert(1)", "file:///secret", "intent://test", "https://user:password@example.com").forEach { assertFalse(validWebUrl(it)) }
        assertFalse(isPlayStoreLink("https://play.google.com.evil.test/store/apps/details?id=x"))
        assertTrue(isPlayStoreLink("https://play.google.com/store/apps/details?id=x"))
    }
}
