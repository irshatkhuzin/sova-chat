package chat.sova.sdk
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
/** Standalone host for the same screen embedded in a Fragment. */
class SovaChatActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { SovaChatScreen(onBack = { finish() }) }
    }
}
