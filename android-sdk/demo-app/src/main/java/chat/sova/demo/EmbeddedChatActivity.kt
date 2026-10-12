package chat.sova.demo

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.fragment.app.Fragment
import androidx.fragment.app.FragmentActivity
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.ViewCompositionStrategy
import chat.sova.sdk.SovaChatScreen
import chat.sova.sdk.SovaChatAppearance

class EmbeddedChatActivity : FragmentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val container = FrameLayout(this).apply { id = android.R.id.content }
        setContentView(container)
        if (savedInstanceState == null) supportFragmentManager.beginTransaction()
            .replace(android.R.id.content, SupportChatFragment()).commit()
    }
}

class SupportChatFragment : Fragment() {
    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View =
        ComposeView(requireContext()).apply {
            setViewCompositionStrategy(ViewCompositionStrategy.DisposeOnViewTreeLifecycleDestroyed)
            setContent {
                SovaChatScreen(onBack = { requireActivity().onBackPressedDispatcher.onBackPressed() },
                    appearance = SovaChatAppearance(title = "Поддержка приложения"))
            }
        }
}
