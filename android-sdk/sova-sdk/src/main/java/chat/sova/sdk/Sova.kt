package chat.sova.sdk

import android.app.Activity
import android.content.Context
import android.content.Intent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.cancel

/**
 * Публичная точка входа SDK.
 *
 * Жизненный цикл: [init] один раз в Application, затем [openChat] из любого места.
 * Личность пользователя подтверждается через [identify] токеном, подписанным вашим сервером.
 */
object Sova {

    @Volatile
    private var repository: SovaRepository? = null

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val unreadState = MutableStateFlow(0)
    private var repositoryScope: CoroutineScope? = null

    /** Количество непрочитанных сообщений (для бейджа). */
    val unread: StateFlow<Int> get() = unreadState

    /**
     * Инициализация SDK. Безопасно вызывать несколько раз — повторные вызовы игнорируются,
     * если конфигурация не изменилась.
     */
    @JvmStatic
    fun init(context: Context, config: SovaConfig) {
        val current = repository
        if (current != null && current.config == config) return

        repositoryScope?.cancel()
        val nextScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        repositoryScope = nextScope
        unreadState.value = 0
        val storage = SovaStorage(context.applicationContext, config.channelPublicId)
        val api = SovaApi(config.serverUrl, storage)
        val nextRepository = SovaRepository(config, api, storage, nextScope) { count ->
            unreadState.value = count
        }
        repository = nextRepository
        nextScope.launch { nextRepository.ensureSession() }
    }

    /** Открывает экран чата. */
    @JvmStatic
    fun openChat(activity: Activity) {
        requireRepository()
        activity.startActivity(Intent(activity, SovaChatActivity::class.java))
    }

    /**
     * Подключает подтверждённого пользователя.
     * @param signedToken токен, подписанный вашим сервером секретом канала.
     */
    @JvmStatic
    fun identify(signedToken: String) {
        val repo = requireRepository()
        repositoryScope?.launch { repo.identify(signedToken) }
    }

    /** Выход из аккаунта: сессия отзывается, локальные данные очищаются. */
    @JvmStatic
    fun logout() {
        val repo = requireRepository()
        repositoryScope?.launch { repo.logout() }
    }

    /** Текущее число непрочитанных сообщений. */
    @JvmStatic
    fun unreadCount(): Int = unreadState.value

    /** Подписка на изменение счётчика непрочитанных. */
    @JvmStatic
    fun observeUnread(listener: (Int) -> Unit) {
        scope.launch {
            unreadState.collect { listener(it) }
        }
    }

    internal fun requireRepository(): SovaRepository =
        repository ?: error("Sova.init(context, config) должен быть вызван до работы с чатом")
}

/**
 * Параметры подключения.
 *
 * @param serverUrl адрес сервера Sova, например https://chat.example.com
 * @param channelPublicId публичный идентификатор канала типа `android` (не секрет)
 * @param pollIntervalMs период опроса новых сообщений, пока экран чата открыт
 */
data class SovaConfig(
    val serverUrl: String,
    val channelPublicId: String,
    val pollIntervalMs: Long = 4_000L,
    val appearance: SovaChatAppearance = SovaChatAppearance(),
)
