package site.lempert.taleart.sdk.ui

import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.text.font.FontFamily
import io.ktor.client.HttpClient
import io.ktor.client.request.get
import io.ktor.client.statement.bodyAsBytes
import io.ktor.http.isSuccess
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.time.TimeMark
import kotlin.time.TimeSource
import site.lempert.taleart.sdk.delivery.DeliveryFont
import site.lempert.taleart.sdk.delivery.platformHttpClient

/** A project font's file is at most this many bytes (`MAX_FONT_BYTES`). */
const val MAX_FONT_BYTES = 500 * 1024

/** A face that is not ready this soon is dropped, and its text keeps its fallback (`FONT_LOAD_TIMEOUT_MS`). */
const val FONT_LOAD_TIMEOUT_MS = 3_000L

/** A face that failed is not fetched again for this long (`FONT_RETRY_AFTER_MS`). */
const val FONT_RETRY_AFTER_MS = 60_000L

/**
 * Makes a font family of one face from a project font's WOFF2 bytes, or null when the platform
 * cannot read them: Skia on iOS (`Font(identity, bytes)`), `Typeface` from a file on Android.
 */
internal expect fun platformFontFamily(id: String, bytes: ByteArray, weight: Int, italic: Boolean): FontFamily?

/** The client that fetches project fonts, when not the SDK's own: tests provide one on a fake server. */
internal val LocalFontHttpClient = staticCompositionLocalOf<HttpClient?> { null }

/** True when [bytes] start as a WOFF2 file does (`wOF2`), the only format a project font has (AD-15). */
internal fun isWoff2(bytes: ByteArray): Boolean =
    bytes.size >= 48 && bytes[0] == 'w'.code.toByte() && bytes[1] == 'O'.code.toByte() &&
        bytes[2] == 'F'.code.toByte() && bytes[3] == '2'.code.toByte()

/**
 * The project fonts (epic Tale Studio R18) a tale's text uses, loaded as the viewer shows that tale,
 * as `loadTaleFonts` and `loadProjectFont` do on the web: each face is fetched once from its public
 * URL (no credentials), checked to be WOFF2 of at most [MAX_FONT_BYTES], and made a font family
 * under its id; its text, drawn in its fallback stack until then, recomposes with it. A face that
 * fails or takes over [FONT_LOAD_TIMEOUT_MS] is dropped and its fallback stays; it is tried again
 * after [FONT_RETRY_AFTER_MS].
 */
internal object ProjectFonts {
    private val families = mutableStateMapOf<String, FontFamily>()
    private val loading = mutableSetOf<String>()
    private val failures = mutableMapOf<String, TimeMark>()
    private val client: HttpClient by lazy { platformHttpClient() }

    /** The family of the project font [fontId] once loaded, else null (its text draws in the fallback). */
    fun family(fontId: String): FontFamily? = families[fontId.lowercase()]

    /** Loads the faces of [fonts] that are not loaded or loading; returns when each has loaded or failed. */
    suspend fun load(
        fonts: List<DeliveryFont>,
        http: HttpClient? = null,
        make: (String, ByteArray, Int, Boolean) -> FontFamily? = ::platformFontFamily,
    ) {
        for (font in fonts) {
            val id = font.id.lowercase()
            if (id.isEmpty() || mediaUrl(font.url) == null) continue
            if (id in families || id in loading) continue
            val failed = failures[id]
            if (failed != null && failed.elapsedNow().inWholeMilliseconds < FONT_RETRY_AFTER_MS) continue
            loading += id
            var why = "it did not load within $FONT_LOAD_TIMEOUT_MS ms"
            val family = try {
                withTimeoutOrNull(FONT_LOAD_TIMEOUT_MS) {
                    val response = (http ?: client).get(font.url)
                    if (!response.status.isSuccess()) {
                        why = "its file answered ${response.status.value}"
                        return@withTimeoutOrNull null
                    }
                    val bytes = response.bodyAsBytes()
                    if (bytes.size > MAX_FONT_BYTES || !isWoff2(bytes)) {
                        why = "its file is not WOFF2 of at most $MAX_FONT_BYTES bytes"
                        return@withTimeoutOrNull null
                    }
                    why = "this platform cannot read WOFF2"
                    make(id, bytes, font.weight.coerceIn(1, 1000), font.style == "italic")
                }
            } catch (e: CancellationException) {
                loading -= id
                throw e
            } catch (e: Throwable) {
                why = "it could not be fetched (${e::class.simpleName})"
                null
            }
            loading -= id
            if (family != null) {
                families[id] = family
                failures -= id
            } else {
                failures[id] = TimeSource.Monotonic.markNow()
                // One line per failure, as the Web SDK warns: the text keeps its fallback stack.
                println("TaleArt: project font $id is not used: $why; its text shows its fallback font")
            }
        }
    }

    /** Forgets every face (for tests). */
    fun clear() {
        families.clear()
        loading.clear()
        failures.clear()
    }
}
