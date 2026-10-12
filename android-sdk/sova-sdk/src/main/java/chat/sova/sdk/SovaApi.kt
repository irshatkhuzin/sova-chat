package chat.sova.sdk

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit

/* ─────────── Модель данных (совпадает с контрактом веб-виджета) ─────────── */

@Serializable
data class SovaAttachment(
    val id: String,
    val fileName: String,
    val mime: String,
    val sizeBytes: Long,
    val url: String,
)

@Serializable
data class SovaMessage(
    val id: String,
    val seq: Int,
    /** user — сообщение пользователя, agent — ответ поддержки, system — служебное. */
    val author: String,
    val text: String,
    val createdAt: String,
    val clientMsgId: String? = null,
    val attachments: List<SovaAttachment> = emptyList(),
) {
    val isFromUser: Boolean get() = author == "user"
}

@Serializable
internal data class SessionRequest(
    val channelPublicId: String,
    val visitorKey: String? = null,
    val authToken: String? = null,
    val languageHint: String? = null,
)

@Serializable
internal data class SessionEndUser(
    val id: String,
    val displayName: String? = null,
    val isVerified: Boolean = false,
    val language: String? = null,
)

@Serializable
internal data class SessionConversation(
    val id: String,
    val status: String,
    val lastSeq: Int,
)

@Serializable
internal data class SessionResponse(
    val sessionToken: String,
    val visitorKey: String,
    val expiresAt: String,
    val endUser: SessionEndUser,
    val conversation: SessionConversation,
    val widget: SovaWidget = SovaWidget(),
)

@Serializable
internal data class SovaWidgetSettings(
    val title: String = "Поддержка",
    val subtitle: String = "",
    val greeting: String = "",
    val handoffNotice: String = "",
    val locale: String = "ru",
    val allowAttachments: Boolean = true,
)

@Serializable
internal data class SovaLocalization(val status: String = "source", val effectiveLanguage: String = "ru")

@Serializable
internal data class SovaWidget(
    val settings: SovaWidgetSettings = SovaWidgetSettings(),
    val strings: Map<String, String> = emptyMap(),
    val localization: SovaLocalization = SovaLocalization(),
) {
    fun text(key: String, fallback: String): String = strings[key] ?: fallback
}

@Serializable
data class SovaHistory(
    val conversationId: String? = null,
    val status: String = "ai",
    val lastSeq: Int = 0,
    val language: String? = null,
    val messages: List<SovaMessage> = emptyList(),
    val agentTyping: Boolean = false,
)

@Serializable
internal data class SendRequest(
    val clientMsgId: String,
    val text: String,
    val attachmentIds: List<String> = emptyList(),
    val languageHint: String? = null,
)

@Serializable
internal data class SendResponse(
    val conversationId: String,
    val conversationStatus: String,
    val duplicate: Boolean = false,
    val message: SovaMessage? = null,
)

@Serializable
internal data class AttachmentResponse(val attachment: SovaAttachment)

@Serializable
internal data class ActivityRequest(val connectionId: String, val online: Boolean, val typing: Boolean)
@Serializable
internal data class ActivityResponse(val ok: Boolean = false)
@Serializable
internal data class ReadRequest(val messageIds: List<String>)
@Serializable
internal data class ReadReceipt(val messageId: String, val readAt: String)
@Serializable
internal data class ReadResponse(val receipts: List<ReadReceipt> = emptyList())

@Serializable
internal data class ApiErrorEnvelope(val error: ApiErrorBody? = null)

@Serializable
internal data class ApiErrorBody(val code: String = "", val message: String = "")

class SovaApiException(
    val status: Int,
    @SerialName("code") val code: String,
    message: String,
    val retryAfterMs: Long? = null,
) : IOException(message) {
    val isAuthError: Boolean get() = status == 401
}

/* ─────────── Сетевой клиент ─────────── */

internal class SovaApi(
    serverUrl: String,
    private val storage: SovaSessionStore,
    private val client: OkHttpClient = defaultClient(),
) {
    private val requestLock = Any()
    private val retryGate = SovaRetryGate()

    private val baseUrl = serverUrl.trimEnd('/') + "/api/v1"

    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
    }

    fun createSession(
        channelPublicId: String,
        visitorKey: String?,
        authToken: String?,
        languageHint: String?,
    ): SessionResponse {
        val body = json.encodeToString(
            SessionRequest(channelPublicId, visitorKey, authToken, languageHint),
        )
        return request("/client/session", "POST", body)
    }

    fun widget(channel: String, language: String): SovaWidget =
        request("/client/config?channel=${channel.encodeQuery()}&lang=${language.encodeQuery()}", "GET", null)

    fun history(afterSeq: Int, uiLanguage: String? = null, presenceId: String? = null): SovaHistory =
        request("/client/messages?afterSeq=$afterSeq" + (uiLanguage?.let { "&uiLanguage=${it.encodeQuery()}" } ?: "") + (presenceId?.let { "&presenceId=${it.encodeQuery()}" } ?: ""), "GET", null)

    fun activity(connectionId: String, online: Boolean, typing: Boolean): ActivityResponse =
        request("/client/activity", "POST", json.encodeToString(ActivityRequest(connectionId, online, typing)))

    fun read(messageIds: List<String>): ReadResponse =
        request("/client/read", "POST", json.encodeToString(ReadRequest(messageIds)))

    fun send(clientMsgId: String, text: String, attachmentIds: List<String>, languageHint: String?): SendResponse {
        val body = json.encodeToString(SendRequest(clientMsgId, text, attachmentIds, languageHint))
        return request("/client/messages", "POST", body)
    }

    fun uploadImage(fileName: String, mime: String, bytes: ByteArray): SovaAttachment {
        val request = Request.Builder()
            .url("$baseUrl/client/attachments?name=${fileName.encodeQuery()}")
            .post(bytes.toRequestBody(mime.toMediaType()))
            .apply { storage.sessionToken?.let { header("x-sova-session", it) } }
            .build()
        val response: AttachmentResponse = execute(request)
        return response.attachment
    }

    fun attachmentBytes(id: String): ByteArray = synchronized(requestLock) {
        checkRateLimit()
        require(id.matches(Regex("[0-9a-fA-F-]{36}")))
        val request = Request.Builder().url("$baseUrl/files/$id")
            .apply { storage.sessionToken?.let { header("x-sova-session", it) } }.build()
        client.newCall(request).execute().use { response ->
            if (response.code == 429) rateLimited(response.header("Retry-After"))
            if (!response.isSuccessful) throw SovaApiException(response.code, "file_unavailable", "Вложение недоступно")
            retryGate.onSuccess()
            response.body?.bytes() ?: error("Пустой файл")
        }
    }

    fun logout() {
        runCatching { request<Map<String, Boolean>>("/client/session/logout", "POST", "{}") }
    }

    private inline fun <reified T> request(path: String, method: String, body: String?): T {
        val builder = Request.Builder().url("$baseUrl$path")
        when (method) {
            "POST" -> builder.post((body ?: "{}").toRequestBody(JSON_MEDIA))
            else -> builder.get()
        }
        storage.sessionToken?.let { builder.header("x-sova-session", it) }
        return execute(builder.build())
    }

    private inline fun <reified T> execute(request: Request): T = synchronized(requestLock) {
        checkRateLimit()
        client.newCall(request).execute().use { response ->
            val raw = response.body?.string().orEmpty()
            if (response.code == 429) {
                rateLimited(response.header("Retry-After"))
            }
            if (!response.isSuccessful) {
                val parsed = runCatching { json.decodeFromString<ApiErrorEnvelope>(raw) }.getOrNull()
                throw SovaApiException(
                    status = response.code,
                    code = parsed?.error?.code ?: "http_error",
                    message = parsed?.error?.message ?: "HTTP ${response.code}",
                )
            }
            retryGate.onSuccess()
            try { json.decodeFromString<T>(raw) }
            catch (err: kotlinx.serialization.SerializationException) {
                throw SovaApiException(response.code, "invalid_response", "Формат ответа сервера не соответствует версии SDK. Обновите приложение или сообщите разработчику.")
            }
        }
    }

    fun retryDelayMs(): Long = synchronized(requestLock) { retryGate.remainingSeconds() * 1000 }

    private fun checkRateLimit() {
        val seconds = retryGate.remainingSeconds()
        if (seconds > 0) throw SovaApiException(429, "rate_limited",
            "Сервер временно ограничил запросы. Повторите через $seconds с.", seconds * 1000)
    }

    private fun rateLimited(header: String?): Nothing {
        retryGate.onRateLimited(header)
        val seconds = retryGate.remainingSeconds()
        throw SovaApiException(429, "rate_limited", "Сервер временно ограничил запросы. Повторите через $seconds с.", seconds * 1000)
    }

    private companion object {
        val JSON_MEDIA = "application/json; charset=utf-8".toMediaType()

        fun defaultClient(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .build()
    }
}

private fun String.encodeQuery(): String =
    java.net.URLEncoder.encode(this, Charsets.UTF_8.name())
