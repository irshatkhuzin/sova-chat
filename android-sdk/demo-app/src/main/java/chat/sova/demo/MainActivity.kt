package chat.sova.demo

import android.app.Application
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.collectAsState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import chat.sova.sdk.Sova
import chat.sova.sdk.SovaConfig

/**
 * Демонстрационное приложение: показывает минимальную интеграцию SDK.
 * Замените serverUrl и channelPublicId на свои значения из панели.
 */
class DemoApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        Sova.init(
            context = this,
            config = SovaConfig(
                serverUrl = "http://10.0.2.2:4000", // 10.0.2.2 — localhost хоста для эмулятора
                channelPublicId = "PASTE_PUBLIC_CHANNEL_ID",
            ),
        )
    }
}

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                var token by remember { mutableStateOf("") }
                val unread by Sova.unread.collectAsState()

                Column(
                    modifier = Modifier.fillMaxSize().padding(24.dp),
                    verticalArrangement = Arrangement.spacedBy(14.dp, Alignment.CenterVertically),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text("Демо-приложение Sova", style = MaterialTheme.typography.headlineSmall)
                    Text("Непрочитанных: $unread")

                    Button(onClick = { Sova.openChat(this@MainActivity) }) {
                        Text("Открыть поддержку")
                    }
                    Button(onClick = { startActivity(android.content.Intent(this@MainActivity, EmbeddedChatActivity::class.java)) }) {
                        Text("Чат внутри Fragment")
                    }

                    OutlinedTextField(
                        value = token,
                        onValueChange = { token = it },
                        label = { Text("Подписанный токен пользователя") },
                    )
                    Button(
                        onClick = { Sova.identify(token.trim()) },
                        enabled = token.isNotBlank(),
                    ) {
                        Text("Войти как пользователь")
                    }

                    Button(onClick = { Sova.logout() }) {
                        Text("Выйти из аккаунта")
                    }
                }
            }
        }
    }
}
