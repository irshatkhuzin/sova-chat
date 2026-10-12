package chat.sova.sdk

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import java.net.URI

internal data class SovaTextLink(val start: Int, val end: Int, val url: String)
internal data class SovaLinkedText(val text: String, val links: List<SovaTextLink>)
internal fun validWebUrl(value: String): Boolean = runCatching {
    val uri = URI(value)
    uri.scheme?.lowercase() in setOf("http", "https") && !uri.host.isNullOrBlank() && uri.userInfo == null
}.getOrDefault(false)
internal fun isPlayStoreLink(value: String): Boolean = validWebUrl(value) && URI(value).host.equals("play.google.com", ignoreCase = true)

/** Plain and Markdown web links. Never executes file:, intent: or javascript:. */
internal fun parseSovaLinks(source: String): SovaLinkedText {
    val pattern = Regex("\\[([^\\]]+)]\\((https?://[^\\s)]+)\\)|(https?://[^\\s<>]+)", RegexOption.IGNORE_CASE)
    val text = StringBuilder()
    val links = mutableListOf<SovaTextLink>()
    var position = 0
    for (match in pattern.findAll(source)) {
        text.append(source.substring(position, match.range.first))
        val markdown = match.groups[2] != null
        val raw = if (markdown) match.groupValues[2] else match.value
        var url = raw.trimEnd('.', ',', ';', ':', '!', '?', '"', '\'')
        while (url.endsWith(")") && url.count { it == ')' } > url.count { it == '(' }) url = url.dropLast(1)
        if (validWebUrl(url)) {
            val label = if (markdown) match.groupValues[1] else url
            val start = text.length
            text.append(label)
            links += SovaTextLink(start, text.length, url)
            if (!markdown) text.append(raw.substring(url.length))
        } else text.append(match.value)
        position = match.range.last + 1
    }
    text.append(source.substring(position))
    return SovaLinkedText(text.toString(), links)
}

internal fun openSovaLink(context: Context, url: String): Boolean {
    if (!validWebUrl(url)) return false
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    if (isPlayStoreLink(url)) {
        try { context.startActivity(Intent(intent).setPackage("com.android.vending")); return true }
        catch (_: ActivityNotFoundException) { }
        catch (_: SecurityException) { }
    }
    return try { context.startActivity(intent); true }
    catch (_: ActivityNotFoundException) { false }
    catch (_: SecurityException) { false }
}
