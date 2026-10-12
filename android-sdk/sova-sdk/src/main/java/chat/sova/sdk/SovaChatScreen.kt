package chat.sova.sdk

import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.Saver
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalWindowInfo
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.distinctUntilChanged
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.*
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/** Ready-to-embed chat. Network, sessions, media and retry state belong to the SDK. */
@Composable
fun SovaChatScreen(
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
    appearance: SovaChatAppearance = Sova.requireRepository().config.appearance,
) {
    val dark = when (appearance.themeMode) {
        SovaThemeMode.SYSTEM -> isSystemInDarkTheme()
        SovaThemeMode.DARK -> true
        SovaThemeMode.LIGHT -> false
    }
    val colors = appearance.colors ?: if (dark) SovaChatColors.dark() else SovaChatColors()
    val scheme = (if (dark) darkColorScheme() else lightColorScheme()).copy(
        background = colors.background, surface = colors.composer, onSurface = colors.incomingText,
        primary = colors.sendButton, onPrimary = colors.sendIcon,
    )
    MaterialTheme(colorScheme = scheme, typography = MaterialTheme.typography) {
        ChatScreen(Sova.requireRepository(), onBack, modifier, appearance, colors)
    }
}

/** Compatibility entry point for existing host Fragments. */
@Composable
fun SovaChat(onBack: () -> Unit) = SovaChatScreen(onBack)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ChatScreen(repository: SovaRepository, onBack: () -> Unit, modifier: Modifier,
                       appearance: SovaChatAppearance, colors: SovaChatColors) {
    val messages by repository.messages.collectAsStateWithLifecycle()
    val widget by repository.widget.collectAsStateWithLifecycle()
    val localized = appearance.useChannelTexts && widget.strings.isNotEmpty()
    fun label(key: String, fallback: String) = if (localized) widget.text(key, fallback) else fallback
    val error by repository.error.collectAsStateWithLifecycle()
    val sendError by repository.sendError.collectAsStateWithLifecycle()
    val generation by repository.sessionGeneration.collectAsStateWithLifecycle()
    val agentTyping by repository.agentTyping.collectAsStateWithLifecycle()
    var input by rememberSaveable(generation) { mutableStateOf("") }
    val listState = rememberLazyListState()
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var pending by rememberSaveable(generation, stateSaver = Saver<SovaAttachment?, List<String>>(
        save = { it?.let { a -> listOf(a.id, a.fileName, a.mime, a.sizeBytes.toString(), a.url) } ?: emptyList() },
        restore = { if (it.size == 5) SovaAttachment(it[0], it[1], it[2], it[3].toLong(), it[4]) else null },
    )) { mutableStateOf<SovaAttachment?>(null) }
    var localError by remember(generation) { mutableStateOf<String?>(null) }
    var uploading by remember { mutableStateOf(false) }
    var sending by remember { mutableStateOf(false) }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) scope.launch {
            val uploadGeneration = repository.sessionGeneration.value
            uploading = true
            try {
                val mime = context.contentResolver.getType(uri) ?: "application/octet-stream"
                val media = withContext(Dispatchers.IO) {
                    val name = context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
                        if (it.moveToFirst()) it.getString(0) else null
                    } ?: "attachment"
                    val bytes = context.contentResolver.openInputStream(uri)?.use { stream ->
                        val out = java.io.ByteArrayOutputStream()
                        val chunk = ByteArray(8192)
                        while (true) {
                            ensureActive()
                            val count = stream.read(chunk)
                            if (count < 0) break
                            require(out.size() + count <= 32 * 1024 * 1024) { "Файл больше 32 МБ" }
                            out.write(chunk, 0, count)
                        }
                        out.toByteArray()
                    } ?: error("Не удалось открыть файл")
                    name to bytes
                }
                if (uploadGeneration == repository.sessionGeneration.value) {
                    val attachment = repository.uploadMedia(media.first, mime, media.second)
                    if (uploadGeneration == repository.sessionGeneration.value) pending = attachment
                    localError = null
                }
            } catch (err: CancellationException) { throw err }
            catch (err: Exception) { localError = err.message ?: "Не удалось открыть файл" }
            finally { uploading = false }
        }
    }
    val owner = LocalLifecycleOwner.current
    val windowFocused = LocalWindowInfo.current.isWindowFocused
    LaunchedEffect(repository, owner, windowFocused, generation) {
        if (!windowFocused) return@LaunchedEffect
        owner.lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            snapshotFlow {
                val layout = listState.layoutInfo
                layout.visibleItemsInfo.filter { it.offset + it.size <= layout.viewportEndOffset && it.offset + it.size > layout.viewportStartOffset }
                    .mapNotNull { it.key as? String }
            }.distinctUntilChanged().collectLatest { ids ->
                delay(750)
                repository.markVisibleRead(ids)
            }
        }
    }
    LaunchedEffect(repository, owner) {
        owner.lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            repository.startWatching()
            try { awaitCancellation() } finally { repository.stopWatching() }
        }
    }
    LaunchedEffect(messages.lastOrNull()?.id, owner) {
        if (messages.isNotEmpty()) listState.animateScrollToItem(messages.size - 1)
        if (owner.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) repository.markRead()
    }
    Scaffold(modifier = modifier, containerColor = colors.background,
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        topBar = { if (appearance.showHeader) TopAppBar(
            title = { Column {
                Text(if (localized) widget.settings.title else appearance.title)
                if (localized && widget.settings.subtitle.isNotBlank()) Text(widget.settings.subtitle, style = MaterialTheme.typography.bodySmall)
            } },
            navigationIcon = { IconButton(onClick = onBack) { Icon(painterResource(R.drawable.sova_back), label("close", "Назад")) } },
            colors = TopAppBarDefaults.topAppBarColors(containerColor = colors.background),
        ) },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).then(if (appearance.handleImeInsets) Modifier.imePadding() else Modifier)) {
            if (messages.isEmpty()) {
                Column(Modifier.weight(1f).fillMaxWidth().padding(32.dp), verticalArrangement = Arrangement.Center,
                    horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(if (localized) widget.settings.title else appearance.emptyTitle, style = MaterialTheme.typography.titleLarge)
                    Spacer(Modifier.height(8.dp))
                    Text(if (localized) widget.settings.greeting else appearance.emptyMessage, color = colors.mutedText, style = MaterialTheme.typography.bodyMedium)
                }
            } else LazyColumn(state = listState, modifier = Modifier.weight(1f).fillMaxWidth(),
                contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                items(messages, key = { it.id }) { message -> MessageRow(message, repository, colors) { localError = it } }
            }
            if (agentTyping) Text(label("typing", "Operator is typing…"), Modifier.padding(horizontal = 16.dp, vertical = 4.dp), color = colors.mutedText, style = MaterialTheme.typography.bodySmall)
            (localError ?: sendError ?: error)?.let { message ->
                Surface(color = MaterialTheme.colorScheme.errorContainer, modifier = Modifier.fillMaxWidth()) {
                    Row(Modifier.padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(if (localized) label(if (sendError != null) "failed" else "offline", message) else message, Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
                        TextButton(enabled = !sending && !uploading, onClick = {
                            localError = null
                            scope.launch { repository.loadHistory() }
                        }) { Text(label("retry", "Проверить связь")) }
                    }
                }
            }
            pending?.let { file -> TextButton(enabled = !sending, onClick = { pending = null }) { Text("📎 ${file.fileName} ×") } }
            HorizontalDivider(color = colors.border)
            Column(Modifier.fillMaxWidth().background(colors.composer)) {
                Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    if (widget.settings.allowAttachments) IconButton(enabled = !uploading && !sending, onClick = {
                        picker.launch(arrayOf("image/png", "image/jpeg", "image/webp", "image/gif", "video/mp4", "video/webm"))
                    }, modifier = Modifier.size(40.dp).clip(RoundedCornerShape(12.dp)).background(colors.attachmentButton)) {
                        if (uploading) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                        else Icon(painterResource(R.drawable.sova_attach), label("attach", "Прикрепить фото или видео"), tint = colors.mutedText)
                    }
                    Surface(modifier = Modifier.weight(1f), color = colors.input, shape = RoundedCornerShape(10.dp), border = BorderStroke(1.dp, colors.border)) {
                        BasicTextField(value = input, onValueChange = { input = it; repository.typing(it.isNotBlank()) }, enabled = !sending,
                            modifier = Modifier.fillMaxWidth().heightIn(min = 40.dp).padding(horizontal = 12.dp, vertical = 10.dp),
                            maxLines = 5, textStyle = MaterialTheme.typography.bodyMedium.copy(color = colors.incomingText),
                            decorationBox = { inner -> Box { if (input.isEmpty()) Text(if (localized) widget.text("inputPlaceholder", appearance.placeholder) else appearance.placeholder, color = colors.mutedText, fontSize = 14.sp); inner() } })
                    }
                    val canSend = !uploading && !sending && (input.isNotBlank() || pending != null)
                    IconButton(enabled = canSend, modifier = Modifier.size(40.dp).clip(RoundedCornerShape(12.dp))
                        .background(colors.sendButton.copy(alpha = if (canSend) 1f else .5f)), onClick = {
                        val text = input.trim()
                        val file = pending
                        sending = true
                        scope.launch {
                            try {
                                if (repository.send(text, listOfNotNull(file?.id))) { input = ""; pending = null }
                            } finally { sending = false }
                        }
                    }) {
                        if (sending) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = colors.sendIcon)
                        else Icon(painterResource(R.drawable.sova_send), if (sendError == null) label("send", "Отправить") else label("retry", "Повторить отправку"), tint = colors.sendIcon)
                    }
                }
                if (appearance.showBranding) Text(label("poweredBy", "Powered by Sova"), Modifier.align(Alignment.CenterHorizontally).padding(bottom = 8.dp), fontSize = 10.sp, color = colors.mutedText)
            }
        }
    }
}

@Composable
internal fun MessageRow(message: SovaMessage, repository: SovaRepository, colors: SovaChatColors, onError: (String) -> Unit) {
    val context = LocalContext.current
    val user = message.isFromUser
    val parsed = remember(message.text) { parseSovaLinks(message.text) }
    val reportError by rememberUpdatedState(onError)
    val annotated = remember(parsed, colors, user) { buildAnnotatedString {
        append(parsed.text)
        parsed.links.forEach { link -> addLink(LinkAnnotation.Clickable(
            tag = link.url,
            styles = TextLinkStyles(style = SpanStyle(color = if (user) colors.outgoingLink else colors.link, textDecoration = TextDecoration.Underline)),
            linkInteractionListener = { if (!openSovaLink(context, link.url)) reportError("На устройстве нет приложения для открытия этой ссылки.") },
        ), link.start, link.end) }
    } }
    val time = remember(message.createdAt) { runCatching { DateTimeFormatter.ofPattern("HH:mm").withZone(ZoneId.systemDefault()).format(Instant.parse(message.createdAt)) }.getOrDefault("") }
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        Column(Modifier.align(if (user) Alignment.CenterEnd else Alignment.CenterStart).widthIn(max = minOf(420.dp, maxWidth * .86f)),
            horizontalAlignment = if (user) Alignment.End else Alignment.Start) {
            Surface(shape = RoundedCornerShape(16.dp), color = if (user) colors.outgoingBubble else colors.incomingBubble,
                border = if (user) null else BorderStroke(1.dp, colors.border)) {
                Column(Modifier.padding(horizontal = 13.dp, vertical = 10.dp)) {
                    if (message.text.isNotEmpty()) Text(text = annotated,
                        style = MaterialTheme.typography.bodyMedium.copy(color = if (user) colors.outgoingText else colors.incomingText, lineHeight = 21.sp))
                    message.attachments.forEach { key(it.id) { AttachmentPreview(it, repository) } }
                }
            }
            if (time.isNotBlank()) Text(time, fontSize = 10.sp, color = colors.mutedText, modifier = Modifier.padding(top = 3.dp))
        }
    }
}
