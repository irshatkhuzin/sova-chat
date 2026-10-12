package chat.sova.sdk
import androidx.compose.ui.graphics.Color

enum class SovaThemeMode { SYSTEM, LIGHT, DARK }

/** Widget palette; override individual colours with copy(). */
data class SovaChatColors(
    val background: Color = Color(0xFFF5F6F8),
    val incomingBubble: Color = Color.White,
    val incomingText: Color = Color(0xFF152541),
    val outgoingBubble: Color = Color(0xFF303149),
    val outgoingText: Color = Color.White,
    val border: Color = Color(0xFFDDE2EB),
    val mutedText: Color = Color(0xFF8592A8),
    val composer: Color = Color.White,
    val input: Color = Color.White,
    val attachmentButton: Color = Color(0xFFF0F2F6),
    val sendButton: Color = Color(0xFF303149),
    val sendIcon: Color = Color.White,
    val link: Color = Color(0xFF123F79),
    val outgoingLink: Color = Color.White,
) {
    companion object {
        fun dark() = SovaChatColors(
            background = Color(0xFF15171E), incomingBubble = Color(0xFF232631),
            incomingText = Color(0xFFE8ECF5), outgoingBubble = Color(0xFF44476B),
            border = Color(0xFF383D4C), mutedText = Color(0xFFA0ABC1),
            composer = Color(0xFF1D2029), input = Color(0xFF252936),
            attachmentButton = Color(0xFF303544), sendButton = Color(0xFF555B88), link = Color(0xFFA7C9FF),
        )
    }
}

data class SovaChatAppearance(
    val title: String = "Поддержка",
    val placeholder: String = "Напишите сообщение…",
    val emptyTitle: String = "Чем можем помочь?",
    val emptyMessage: String = "Напишите вопрос. При необходимости приложите скриншот.",
    /** Use channel texts and locale from the server. Set false for host-supplied texts. */
    val useChannelTexts: Boolean = true,
    val showHeader: Boolean = true,
    val showBranding: Boolean = true,
    val themeMode: SovaThemeMode = SovaThemeMode.SYSTEM,
    val colors: SovaChatColors? = null,
    /** Disable when the host already handles keyboard insets. */
    val handleImeInsets: Boolean = true,
)
