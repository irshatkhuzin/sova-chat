package chat.sova.sdk

/** Серверный Retry-After имеет приоритет; без него пауза растёт от минуты до пяти. */
internal class SovaRetryGate(private val now: () -> Long = { System.currentTimeMillis() }) {
    private var until = 0L
    private var failures = 0
    fun remainingSeconds(): Long = ((until - now()).coerceAtLeast(0) + 999) / 1000
    fun onRateLimited(retryAfter: String?) {
        failures = (failures + 1).coerceAtMost(4)
        val seconds = retryAfter?.trim()?.toLongOrNull()?.takeIf { it >= 0 }?.coerceAtLeast(1)
            ?: retryAfter?.let { runCatching {
                ((java.time.ZonedDateTime.parse(it.trim(), java.time.format.DateTimeFormatter.RFC_1123_DATE_TIME)
                    .toInstant().toEpochMilli() - now()).coerceAtLeast(0) + 999).div(1000).coerceAtLeast(1)
            }.getOrNull() }
            ?: (60L shl (failures - 1)).coerceAtMost(300)
        until = now() + seconds.coerceAtMost((Long.MAX_VALUE - now()) / 1000) * 1000
    }
    fun onSuccess() { failures = 0; until = 0 }
}
