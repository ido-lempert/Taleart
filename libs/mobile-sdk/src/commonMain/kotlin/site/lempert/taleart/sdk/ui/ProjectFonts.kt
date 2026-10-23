package site.lempert.taleart.sdk.ui

import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.text.font.FontFamily
import io.ktor.client.HttpClient
import io.ktor.client.request.prepareGet
import io.ktor.client.statement.bodyAsChannel
import io.ktor.http.contentLength
import io.ktor.http.isSuccess
import io.ktor.utils.io.readRemaining
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.io.readByteArray
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
 * True when this platform's font loader reads WOFF2, the only format a project font has (AD-15):
 * Skia on iOS does; Android's `Typeface` does not (it reads TrueType and OpenType only), so on
 * Android a project font's text always shows its fallback stack and nothing is downloaded.
 */
internal expect val platformReadsWoff2: Boolean

/**
 * Makes a font family of one face from a project font's checked WOFF2 bytes, or null when the
 * platform cannot read them. [id] is a checked font id (a UUID).
 */
internal expect fun platformFontFamily(id: String, bytes: ByteArray, weight: Int, italic: Boolean): FontFamily?

/** The client that fetches project fonts, when not the SDK's own: tests provide one on a fake server. */
internal val LocalFontHttpClient = staticCompositionLocalOf<HttpClient?> { null }

private val FONT_ID = Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")

/** True for a project font's id: a UUID (`isFontId`). */
internal fun isFontId(value: String): Boolean = FONT_ID.matches(value)

/**
 * The project fonts (epic Tale Studio R18) a tale's text uses, loaded as the viewer shows that tale,
 * as `loadTaleFonts` and `loadProjectFont` do on the web: the faces load in parallel, each once,
 * from its public URL (no credentials), refused when it declares or sends more than
 * [MAX_FONT_BYTES] (at most that much plus one byte is read) or is not WOFF2 ([isWoff2]), and made
 * a font family under its id; its text, drawn in its fallback stack until then, recomposes with it.
 * A face that fails or takes over [FONT_LOAD_TIMEOUT_MS] is dropped and its fallback stays; it is
 * tried again after [FONT_RETRY_AFTER_MS]. A font whose id is not a UUID is never fetched. Where
 * the platform cannot read WOFF2 ([platformReadsWoff2]), nothing is fetched and one line says so.
 */
internal class ProjectFontLoader(
    private val timeSource: TimeSource = TimeSource.Monotonic,
    private val readsWoff2: Boolean = platformReadsWoff2,
    private val make: (String, ByteArray, Int, Boolean) -> FontFamily? = ::platformFontFamily,
) {
    private val families = mutableStateMapOf<String, FontFamily>()
    private val loading = mutableSetOf<String>()
    private val failures = mutableMapOf<String, TimeMark>()
    private var toldUnreadable = false
    private val client: HttpClient by lazy { platformHttpClient() }

    /** The family of the project font [fontId] once loaded, else null (its text draws in the fallback). */
    fun family(fontId: String): FontFamily? = families[fontId.lowercase()]

    /** Why the last face that failed was dropped; for tests and the log. */
    var lastFailure: String? = null
        private set

    /** Loads the faces of [fonts] that are not loaded, loading or recently failed; returns when each has loaded or failed. */
    suspend fun load(fonts: List<DeliveryFont>, http: HttpClient? = null) {
        if (!readsWoff2) {
            if (fonts.isNotEmpty() && !toldUnreadable) {
                toldUnreadable = true
                println("TaleArt: project fonts are not used on this platform, which cannot read WOFF2; their text shows its fallback font")
            }
            return
        }
        val todo = fonts.mapNotNull { font ->
            val id = font.id.lowercase()
            when {
                !isFontId(id) || mediaUrl(font.url) == null -> null
                id in families || id in loading -> null
                failures[id]?.let { it.elapsedNow().inWholeMilliseconds < FONT_RETRY_AFTER_MS } == true -> null
                else -> font.also { loading += id }
            }
        }
        if (todo.isEmpty()) return
        coroutineScope { todo.map { async { loadOne(it, http ?: client) } }.awaitAll() }
    }

    private suspend fun loadOne(font: DeliveryFont, http: HttpClient) {
        val id = font.id.lowercase()
        var why = "it did not load within $FONT_LOAD_TIMEOUT_MS ms"
        val family = try {
            withTimeoutOrNull(FONT_LOAD_TIMEOUT_MS) {
                val bytes = http.prepareGet(font.url).execute { response ->
                    when {
                        !response.status.isSuccess() -> {
                            why = "its file answered ${response.status.value}"
                            null
                        }
                        (response.contentLength() ?: 0L) > MAX_FONT_BYTES -> {
                            why = "its file declares more than $MAX_FONT_BYTES bytes"
                            null
                        }
                        // Read at most one byte more than allowed: enough to tell the file is too large.
                        else -> response.bodyAsChannel().readRemaining(MAX_FONT_BYTES + 1L).readByteArray()
                    }
                } ?: return@withTimeoutOrNull null
                if (bytes.size > MAX_FONT_BYTES || !isWoff2(bytes)) {
                    why = "its file is not WOFF2 of at most $MAX_FONT_BYTES bytes"
                    return@withTimeoutOrNull null
                }
                why = "the platform could not read it"
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
            failures[id] = timeSource.markNow()
            lastFailure = why
            println("TaleArt: project font $id is not used: $why; its text shows its fallback font")
        }
    }
}

/** The SDK's project fonts, shared by every viewer of the process. */
internal val ProjectFonts = ProjectFontLoader()
