package chat.sova.sdk
import android.graphics.BitmapFactory
import android.widget.ImageView
import android.widget.VideoView
import android.widget.MediaController
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import kotlinx.coroutines.launch
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
@Composable
internal fun AttachmentPreview(attachment: SovaAttachment, repository: SovaRepository) {
    val widget by repository.widget.collectAsState()
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var file by remember { mutableStateOf<File?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(false) }
    DisposableEffect(file) { val saved = file; onDispose { saved?.delete() } }
    TextButton(enabled = !loading, onClick = {
        scope.launch {
            loading = true
            try {
                val bytes = repository.downloadMedia(attachment.id)
                file = withContext(Dispatchers.IO) { File.createTempFile("sova-", if (attachment.mime == "video/webm") ".webm" else if (attachment.mime.startsWith("video/")) ".mp4" else ".image", context.cacheDir).apply { writeBytes(bytes) } }
                error = null
            } catch (err: kotlinx.coroutines.CancellationException) { throw err } catch (err: Exception) { error = err.message ?: "Вложение недоступно" }
            finally { loading = false }
        }
    }) { Text(if (loading) "…" else "📎 " + attachment.fileName) }
    error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
    file?.let { saved ->
        AlertDialog(onDismissRequest = { file = null }, confirmButton = { TextButton(onClick = { file = null }) { Text(widget.text("close", "Закрыть")) } }, text = {
            if (attachment.mime.startsWith("video/")) {
                AndroidView(factory = { ctx -> VideoView(ctx).apply { setMediaController(MediaController(ctx).also { it.setAnchorView(this) }); setVideoPath(saved.absolutePath); setOnPreparedListener { start() } } }, modifier = Modifier.fillMaxWidth().padding(8.dp))
            } else {
                AndroidView(factory = { ctx -> ImageView(ctx).apply { adjustViewBounds = true; val opts = BitmapFactory.Options().apply { inJustDecodeBounds = true }; BitmapFactory.decodeFile(saved.absolutePath, opts); opts.inSampleSize = maxOf(1, maxOf(opts.outWidth, opts.outHeight) / 1600); opts.inJustDecodeBounds = false; setImageBitmap(BitmapFactory.decodeFile(saved.absolutePath, opts)) } }, modifier = Modifier.fillMaxWidth())
            }
        })
    }
}
