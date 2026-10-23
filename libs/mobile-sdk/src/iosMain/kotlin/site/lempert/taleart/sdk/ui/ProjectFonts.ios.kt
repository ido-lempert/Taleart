package site.lempert.taleart.sdk.ui

import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.platform.Font
import org.jetbrains.skia.Data
import org.jetbrains.skia.FontMgr

// Skia reads the bytes (`Font(identity, data)`); a face it cannot read gives no family, and its
// text keeps its fallback.
internal actual fun platformFontFamily(id: String, bytes: ByteArray, weight: Int, italic: Boolean): FontFamily? {
    val typeface = runCatching { FontMgr.default.makeFromData(Data.makeFromBytes(bytes)) }.getOrNull() ?: return null
    typeface.close()
    return FontFamily(
        Font(
            identity = "taleart-font-$id",
            data = bytes,
            weight = FontWeight(weight),
            style = if (italic) FontStyle.Italic else FontStyle.Normal,
        ),
    )
}
