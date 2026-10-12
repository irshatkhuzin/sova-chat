package chat.sova.sdk

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.CancellationException
import java.time.Instant
import java.time.format.DateTimeFormatter
import java.util.Locale
import java.util.UUID

/**
 * Состояние чата и работа с сервером.
 *
 * Правила те же, что и в веб-виджете:
 *  • у каждого сообщения есть clientMsgId — повтор не создаёт дубль;
 *  • после переподключения догружаются сообщения с seq больше сохранённого;
 *  • история хранится на сервере, локально — только последняя выдача и счётчики.
 */
internal class SovaRepository(
    val config: SovaConfig,
    private val api: SovaApi,
    private val storage: SovaSessionStore,
    private val scope: CoroutineScope,
    private val onUnreadChanged: (Int) -> Unit,
) {
    private val mutex = Mutex()
    private val operationMutex = Mutex()
    @Volatile private var watchers = 0
    private var pollingJob: Job? = null
    private val presenceId = UUID.randomUUID().toString()
    private val typingState = MutableStateFlow(false)
    val agentTyping: StateFlow<Boolean> get() = typingState
    private var typingExpiry: Job? = null
    private var inputExpiry: Job? = null
    private var lastTypingSent = 0L
    private var userTyping = false
    private val pendingReads = linkedSetOf<String>()
    private val confirmedReads = mutableSetOf<String>()

    /** Called by the visible, resumed Compose screen; polling alone never records a read. */
    suspend fun markVisibleRead(ids: List<String>) = operationMutex.withLock { withContext(Dispatchers.IO) {
        if (watchers == 0 || storage.sessionToken == null) return@withContext
        val visible = messagesState.value.filter { it.id in ids && !it.isFromUser && it.author != "system" }
        synchronized(pendingReads) { pendingReads.addAll(visible.map { it.id }.filterNot { it in confirmedReads }) }
        flushReads()
    } }

    private fun flushReads() {
        val batch = synchronized(pendingReads) { pendingReads.take(100) }
        if (batch.isEmpty() || storage.sessionToken == null) return
        try {
            val result = api.read(batch)
            synchronized(pendingReads) { pendingReads.removeAll(batch.toSet()); confirmedReads.addAll(result.receipts.map { it.messageId }) }
        } catch (_: Exception) { /* Retry the already observed IDs with the next foreground poll. */ }
    }

    private fun clearReadReceipts() = synchronized(pendingReads) { pendingReads.clear(); confirmedReads.clear() }

    private fun updateAgentTyping(active: Boolean) {
        typingExpiry?.cancel()
        typingState.value = active && watchers > 0
        if (typingState.value) typingExpiry = scope.launch { delay(7_000); typingState.value = false }
    }

    fun typing(active: Boolean) {
        inputExpiry?.cancel()
        if (active && watchers == 0) return
        if (active) inputExpiry = scope.launch { delay(3_000); typing(false) }
        val now = System.currentTimeMillis()
        if (active && now - lastTypingSent < 2_000) return
        if (!active && !userTyping) return
        if (active) lastTypingSent = now
        userTyping = active
        sendActivity(active)
    }

    private fun sendActivity(active: Boolean) {
        val generation = sessionGeneration.value
        scope.launch { operationMutex.withLock { withContext(Dispatchers.IO) {
            if (generation != sessionGeneration.value || storage.sessionToken == null) return@withContext
            try { api.activity(presenceId, watchers > 0, active && userTyping && watchers > 0) }
            catch (err: CancellationException) { throw err }
            catch (_: Exception) { /* Leases expire automatically; never interrupt messaging. */ }
        } } }
    }
    val sessionGeneration = MutableStateFlow(0)
    private val widgetState = MutableStateFlow(SovaWidget())
    val widget: StateFlow<SovaWidget> get() = widgetState
    private var widgetLoaded = false
    private var widgetLocale = ""
    private var nextWidgetAttemptAt = 0L

    private fun refreshWidget() {
        val locale = Locale.getDefault().toLanguageTag()
        if ((!widgetLoaded || widgetLocale != locale || widgetState.value.localization.status == "pending") && System.currentTimeMillis() >= nextWidgetAttemptAt) {
            nextWidgetAttemptAt = System.currentTimeMillis() + 15_000
            try {
                widgetState.value = api.widget(config.channelPublicId, locale)
                widgetLocale = locale
                widgetLoaded = true
            } catch (_: Exception) { /* Keep the current interface and retry without blocking the chat. */ }
        }
    }

    private val messagesState = MutableStateFlow<List<SovaMessage>>(emptyList())
    val messages: StateFlow<List<SovaMessage>> get() = messagesState

    private val statusState = MutableStateFlow("ai")
    val status: StateFlow<String> get() = statusState

    private val errorState = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> get() = errorState

    private val sendErrorState = MutableStateFlow<String?>(null)
    val sendError: StateFlow<String?> get() = sendErrorState
    // Один ID сохраняется при повторе того же сообщения после ошибки сети.
    private var pendingSend: Triple<String, List<String>, String>? = null
    private var nextSessionAttemptAt = 0L

    private var authToken: String? = null

    /** Создаёт сессию, если её ещё нет. */
    suspend fun ensureSession(): Boolean = mutex.withLock { ensureSessionLocked() }

    private suspend fun ensureSessionLocked(): Boolean = withContext(Dispatchers.IO) {
        if (storage.sessionToken != null) return@withContext true
        if (System.currentTimeMillis() < nextSessionAttemptAt) return@withContext false
        try {
            val session = api.createSession(
                channelPublicId = config.channelPublicId,
                visitorKey = storage.ensureVisitorKey(),
                authToken = authToken,
                languageHint = Locale.getDefault().language,
            )
            nextSessionAttemptAt = 0
            storage.sessionToken = session.sessionToken
            storage.visitorKey = session.visitorKey
            storage.conversationId = session.conversation.id.ifEmpty { null }
            widgetState.value = session.widget
            widgetLoaded = true
            widgetLocale = Locale.getDefault().toLanguageTag()
            errorState.value = null
            true
        } catch (err: SovaApiException) {
            nextSessionAttemptAt = System.currentTimeMillis() + maxOf(15_000, err.retryAfterMs ?: 0)
            errorState.value = err.message
            false
        } catch (err: CancellationException) { throw err
        } catch (err: Exception) {
            nextSessionAttemptAt = System.currentTimeMillis() + 15_000
            errorState.value = "Нет связи с сервером поддержки"
            false
        }
    }

    /** Полная загрузка истории (при открытии экрана). */
    suspend fun loadHistory(): Unit = operationMutex.withLock { loadHistoryLocked() }

    private suspend fun loadHistoryLocked(retryAuth: Boolean = true): Unit = withContext(Dispatchers.IO) {
        if (!ensureSession()) return@withContext
        refreshWidget()
        try {
            val history = api.history(0, widgetState.value.settings.locale, if (watchers > 0) presenceId else null)
            updateAgentTyping(history.agentTyping)
            messagesState.value = history.messages
            statusState.value = history.status
            storage.lastSeq = history.lastSeq
            storage.conversationId = history.conversationId
            recalcUnread()
            errorState.value = null
        } catch (err: SovaApiException) {
            if (err.isAuthError && retryAuth) {
                storage.sessionToken = null
                if (ensureSession()) loadHistoryLocked(retryAuth = false)
            } else {
                errorState.value = err.message
            }
        } catch (err: CancellationException) { throw err
        } catch (err: Exception) {
            errorState.value = "Не удалось загрузить историю"
        }
    }

    /** Добор новых сообщений (опрос, пока экран открыт). */
    suspend fun poll(): Unit = operationMutex.withLock { withContext(Dispatchers.IO) {
        if (storage.sessionToken == null) { loadHistoryLocked(); return@withContext }
        refreshWidget()
        try {
            val history = api.history(storage.lastSeq, widgetState.value.settings.locale, if (watchers > 0) presenceId else null)
            if (watchers > 0) flushReads()
            updateAgentTyping(history.agentTyping)
            if (history.messages.isNotEmpty()) {
                val merged = messagesState.value.toMutableList()
                for (message in history.messages) {
                    val index = merged.indexOfFirst {
                        it.id == message.id ||
                            (message.clientMsgId != null && it.clientMsgId == message.clientMsgId)
                    }
                    if (index >= 0) merged[index] = message else merged.add(message)
                }
                messagesState.value = merged.sortedBy { it.seq }
            }
            statusState.value = history.status
            if (history.lastSeq > storage.lastSeq) storage.lastSeq = history.lastSeq
            recalcUnread()
            errorState.value = null
        } catch (err: SovaApiException) {
            if (err.isAuthError) {
                storage.sessionToken = null
                ensureSession()
            } else errorState.value = err.message
        } catch (err: CancellationException) { throw err
        } catch (err: Exception) {
            errorState.value = "Нет связи. Повторим подключение автоматически."
        }
    } }

    /** Отправка сообщения. Возвращает false, если отправить не удалось. */
    suspend fun send(text: String, attachmentIds: List<String> = emptyList()): Boolean = operationMutex.withLock { withContext(Dispatchers.IO) {
        typing(false)
        if (text.isBlank() && attachmentIds.isEmpty()) return@withContext false
        sendErrorState.value = null
        if (!ensureSession()) {
            sendErrorState.value = errorState.value
            return@withContext false
        }
        val previous = pendingSend
        val clientMsgId = if (previous?.first == text && previous.second == attachmentIds) previous.third
            else UUID.randomUUID().toString()
        pendingSend = Triple(text, attachmentIds.toList(), clientMsgId)

        try {
            val response = api.send(
                clientMsgId = clientMsgId,
                text = text,
                attachmentIds = attachmentIds,
                languageHint = Locale.getDefault().language,
            )
            storage.conversationId = response.conversationId
            statusState.value = response.conversationStatus
            response.message?.let { confirmed ->
                val stored = confirmed.copy(clientMsgId = clientMsgId)
                messagesState.value = (messagesState.value.filterNot {
                    it.id == stored.id || it.clientMsgId == clientMsgId
                } + stored).sortedBy { it.seq }
            }
            // lastSeq продвигает только история: иначе можно пропустить ответ оператора.
            pendingSend = null
            sendErrorState.value = null
            true
        } catch (err: SovaApiException) {
            if (err.isAuthError) storage.sessionToken = null
            sendErrorState.value = err.message
            false
        } catch (err: CancellationException) { throw err
        } catch (err: Exception) {
            sendErrorState.value = "Сообщение не отправлено. Проверьте связь. Текст сохранён."
            false
        }
    } }

    suspend fun uploadMedia(fileName: String, mime: String, bytes: ByteArray): SovaAttachment? = operationMutex.withLock { withContext(Dispatchers.IO) {
        if (!ensureSession()) return@withContext null
        try { api.uploadImage(fileName, mime, bytes) } catch (err: CancellationException) { throw err } catch (err: Exception) {
            errorState.value = err.message ?: "Не удалось загрузить файл"
            null
        }
    } }

    suspend fun downloadMedia(id: String): ByteArray = operationMutex.withLock { withContext(Dispatchers.IO) { api.attachmentBytes(id) } }

    /** Подключение подтверждённого пользователя. */
    suspend fun identify(signedToken: String) {
        operationMutex.withLock { mutex.withLock {
            withContext(Dispatchers.IO) { if (storage.sessionToken != null) runCatching { api.activity(presenceId, false, false) } }
            inputExpiry?.cancel(); userTyping = false; lastTypingSent = 0; updateAgentTyping(false)
            authToken = signedToken
            clearReadReceipts()
            storage.clear()
            messagesState.value = emptyList()
            pendingSend = null
            sendErrorState.value = null
            errorState.value = null
            nextSessionAttemptAt = 0
            sessionGeneration.value++
            ensureSessionLocked()
        } }
        loadHistory()
    }

    /** Выход из аккаунта: отзыв сессии на сервере и очистка локальных данных. */
    suspend fun logout() = operationMutex.withLock { mutex.withLock {
        withContext(Dispatchers.IO) {
            if (storage.sessionToken != null) runCatching { api.activity(presenceId, false, false) }
            inputExpiry?.cancel(); userTyping = false; lastTypingSent = 0; updateAgentTyping(false)
            runCatching { api.logout() }
            authToken = null
            clearReadReceipts()
            storage.clear()
            messagesState.value = emptyList()
            pendingSend = null
            sendErrorState.value = null
            errorState.value = null
            nextSessionAttemptAt = 0
            sessionGeneration.value++
            statusState.value = "ai"
            onUnreadChanged(0)
        }
    } }

    /** Отмечает переписку прочитанной (экран открыт). */
    fun markRead() {
        storage.lastReadSeq = storage.lastSeq
        onUnreadChanged(0)
    }

    private fun recalcUnread() {
        val unread = messagesState.value.count {
            !it.isFromUser && it.seq > storage.lastReadSeq
        }
        onUnreadChanged(unread)
    }

    private fun nowIso(): String =
        DateTimeFormatter.ISO_INSTANT.format(Instant.now())

    /**
     * Периодический опрос новых сообщений, пока открыт экран чата.
     * На следующем этапе заменяется постоянным соединением Socket.IO —
     * остальной код при этом не меняется.
     */
    @Synchronized fun startWatching() {
        if (watchers == 0) { widgetLoaded = false; nextWidgetAttemptAt = 0L }
        watchers++
        if (pollingJob?.isActive == true) return
        pollingJob = scope.launch {
            loadHistory()
            if (watchers > 0) markRead()
            var failures = 0
            while (isActive) {
                if (errorState.value != null) failures = (failures + 1).coerceAtMost(4) else failures = 0
                val interval = config.pollIntervalMs.coerceAtLeast(2_000)
                delay(maxOf(api.retryDelayMs(), interval * (1L shl failures)))
                poll()
                if (watchers > 0) markRead()
            }
        }
    }

    @Synchronized fun stopWatching() {
        watchers = (watchers - 1).coerceAtLeast(0)
        if (watchers == 0) {
            pollingJob?.cancel(); pollingJob = null
            inputExpiry?.cancel(); userTyping = false; lastTypingSent = 0
            updateAgentTyping(false)
            sendActivity(false)
        }
    }
}
