package site.lempert.taleart.sdk.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context

// The application context the viewer hands over while it is on screen (see FullScreenViewer): the
// clipboard service needs a context, and a promo code is copied from the viewer only.
internal object AndroidClipboardApplication {
    @Volatile
    var context: Context? = null
}

// The system clipboard as a plain-text clip; false without a context or when the system refuses it.
internal actual fun copyToClipboard(text: String): Boolean {
    val context = AndroidClipboardApplication.context ?: return false
    return runCatching {
        val manager = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        manager.setPrimaryClip(ClipData.newPlainText("TaleArt", text))
        true
    }.getOrDefault(false)
}
