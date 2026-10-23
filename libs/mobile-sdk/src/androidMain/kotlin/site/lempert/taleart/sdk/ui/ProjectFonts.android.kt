package site.lempert.taleart.sdk.ui

import android.graphics.Typeface
import android.os.Build
import androidx.compose.ui.text.font.FontFamily
import java.io.File

// Android reads a font from a file: the bytes go to a temporary file, which is deleted once read.
// A face Android cannot read gives no family, and its text keeps its fallback.
internal actual fun platformFontFamily(id: String, bytes: ByteArray, weight: Int, italic: Boolean): FontFamily? {
    val file = File.createTempFile("taleart-font-$id", ".woff2")
    return try {
        file.writeBytes(bytes)
        val typeface = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Typeface.Builder(file).setWeight(weight).setItalic(italic).build()
        } else {
            Typeface.createFromFile(file)
        }
        if (typeface == null || typeface == Typeface.DEFAULT) null else FontFamily(androidx.compose.ui.text.font.Typeface(typeface))
    } catch (_: RuntimeException) {
        null
    } finally {
        file.delete()
    }
}
