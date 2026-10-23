package site.lempert.taleart.sdk.ui

import androidx.compose.ui.text.font.FontFamily

// Android's Typeface reads TrueType and OpenType only: `Typeface.Builder(file).build()` gives null
// for WOFF2 (checked on an API 37 emulator, story 9.5). A project font's text shows its fallback
// stack, and its file is never downloaded. Drawing project fonts on Android needs a WOFF2 decoder
// (Brotli and the glyf/loca transforms) turning the bytes into TrueType first.
internal actual val platformReadsWoff2: Boolean = false

internal actual fun platformFontFamily(id: String, bytes: ByteArray, weight: Int, italic: Boolean): FontFamily? = null
