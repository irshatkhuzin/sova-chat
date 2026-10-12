package chat.sova.sdk

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.util.UUID

/**
 * Локальное хранилище сессии.
 *
 * Токен сессии — учётные данные, поэтому используется EncryptedSharedPreferences.
 * Если шифрование недоступно (редкие прошивки), выполняется откат на обычные
 * SharedPreferences: работоспособность важнее, а токен ограничен одним каналом
 * и отзывается при выходе.
 */
internal interface SovaSessionStore {
    var sessionToken: String?
    var visitorKey: String?
    var lastSeq: Int
    var lastReadSeq: Int
    var conversationId: String?
    fun ensureVisitorKey(): String
    fun clear()
}

internal class SovaStorage(context: Context, channelPublicId: String) : SovaSessionStore {

    private val prefs: SharedPreferences = runCatching {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context,
            "sova_$channelPublicId",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        ) as SharedPreferences
    }.getOrElse {
        context.getSharedPreferences("sova_$channelPublicId", Context.MODE_PRIVATE)
    }

    override var sessionToken: String?
        get() = prefs.getString(KEY_SESSION, null)
        set(value) = prefs.edit().apply {
            if (value == null) remove(KEY_SESSION) else putString(KEY_SESSION, value)
        }.apply()

    override var visitorKey: String?
        get() = prefs.getString(KEY_VISITOR, null)
        set(value) = prefs.edit().apply {
            if (value == null) remove(KEY_VISITOR) else putString(KEY_VISITOR, value)
        }.apply()

    override var lastSeq: Int
        get() = prefs.getInt(KEY_LAST_SEQ, 0)
        set(value) = prefs.edit().putInt(KEY_LAST_SEQ, value).apply()

    override var lastReadSeq: Int
        get() = prefs.getInt(KEY_LAST_READ_SEQ, 0)
        set(value) = prefs.edit().putInt(KEY_LAST_READ_SEQ, value).apply()

    override var conversationId: String?
        get() = prefs.getString(KEY_CONVERSATION, null)
        set(value) = prefs.edit().apply {
            if (value == null) remove(KEY_CONVERSATION) else putString(KEY_CONVERSATION, value)
        }.apply()

    override fun ensureVisitorKey(): String {
        val existing = visitorKey
        if (existing != null) return existing
        val generated = UUID.randomUUID().toString()
        visitorKey = generated
        return generated
    }

    /** Полная очистка локальных данных сессии — вызывается при выходе из аккаунта. */
    override fun clear() {
        prefs.edit().clear().apply()
    }

    private companion object {
        const val KEY_SESSION = "session_token"
        const val KEY_VISITOR = "visitor_key"
        const val KEY_LAST_SEQ = "last_seq"
        const val KEY_LAST_READ_SEQ = "last_read_seq"
        const val KEY_CONVERSATION = "conversation_id"
    }
}
