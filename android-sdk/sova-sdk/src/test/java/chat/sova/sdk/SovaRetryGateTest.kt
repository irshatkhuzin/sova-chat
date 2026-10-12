package chat.sova.sdk
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
class SovaRetryGateTest {
    @Test fun invalidHeaderUsesBackoffAndDateNeverRetriesEarly() {
        var time = 500L
        val gate = SovaRetryGate { time }
        gate.onRateLimited("invalid")
        assertEquals(60L, gate.remainingSeconds())
        gate.onSuccess()
        gate.onRateLimited("Thu, 01 Jan 1970 00:00:02 GMT")
        assertEquals(2L, gate.remainingSeconds())
        time = 2000
        assertTrue(gate.remainingSeconds() >= 0)
    }
    @Test fun pausesAndBacksOffWithoutRetryAfter() {
        var time = 0L
        val gate = SovaRetryGate { time }
        gate.onRateLimited(null)
        assertEquals(60L, gate.remainingSeconds())
        time = 59_001
        assertEquals(1L, gate.remainingSeconds())
        time = 60_000
        assertEquals(0L, gate.remainingSeconds())
        gate.onRateLimited(null)
        assertEquals(120L, gate.remainingSeconds())
        gate.onSuccess()
        gate.onRateLimited(null)
        assertEquals(60L, gate.remainingSeconds())
    }
    @Test fun honorsServerRetryAfter() {
        val gate = SovaRetryGate { 0L }
        gate.onRateLimited("900")
        assertEquals(900L, gate.remainingSeconds())
        gate.onRateLimited("Thu, 01 Jan 1970 00:02:00 GMT")
        assertEquals(120L, gate.remainingSeconds())
    }
}
