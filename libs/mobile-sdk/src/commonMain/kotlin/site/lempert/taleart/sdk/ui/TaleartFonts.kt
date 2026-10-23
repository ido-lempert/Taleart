package site.lempert.taleart.sdk.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.text.font.FontFamily

/**
 * The fonts the SDK draws content in by family name (story 9.8, owner decision 2026-10-23).
 *
 * The host app installs its fonts itself, separately from the SDK, and the family name comes from
 * the content: a tale document's text font list, a project font's family (fonts uploaded to the
 * project are never downloaded on mobile), the project theme's `fontFamily` (the bar's titles, the
 * viewer's group name and the document's theme-font text). A name resolves, in this order, to:
 * 1. a family [register]ed under it here (it wins over a generic family of the same name too);
 * 2. a font the app ships:
 *    - Android: `res/font/<name>`, the name in lower case with each space `_` and each hyphen `__`
 *      (`Brand Sans` is `res/font/brand_sans.ttf`, `Brand-Sans` is `brand__sans.ttf`; a name with
 *      other characters than ASCII letters, digits, spaces and hyphens has no resource name); else
 *      `assets/fonts/<name>.ttf` or `.otf`, the file named as the family in any case (Unicode
 *      allowed) or by its resource name. Only when the bare name has no font, its faces by suffix:
 *      `<name>_regular`, `_italic`, `_medium`, `_semibold`, `_bold`, `_bold_italic` (resources), and
 *      `<Name>-Regular`, `-Italic`, `-Medium`, `-SemiBold`, `-Bold`, `-BoldItalic` (assets, as
 *      Google Fonts names its files). A host that shrinks resources keeps its `@font` resources
 *      (`tools:keep` naming each `@font` resource, or all of them by wildcard, in `res/raw/keep.xml`): the SDK reaches them by name only.
 *    - iOS: a font the app registered in `UIAppFonts` (or otherwise inside its main bundle), by its
 *      family name in any case, with the family's faces. Fonts iOS itself has are not used, nor
 *      font collections (`.ttc`, `.otc`) or files over [MAX_HOST_FONT_BYTES].
 *
 * A font list is read as a browser reads `font-family`: comma-separated, a quoted name may hold
 * commas, names compared case-insensitively with each run of spaces one space; the first entry
 * available wins. An unquoted generic name (`serif`, `sans-serif`, `monospace`, `cursive`,
 * `system-ui`, `ui-serif`, `ui-sans-serif`, `ui-monospace`, `ui-rounded`) is always available; a
 * quoted one is a family name, as in CSS. When nothing in the list is available, the text's own
 * fallback applies.
 *
 * Call it from the main thread. A registration made while content shows redraws it.
 */
object TaleartFonts {
    private val registered = mutableStateMapOf<String, FontFamily>()

    /**
     * Draws content that names [name] (in any case, quoted or not) in [family]; it takes priority
     * over a font the app ships under the same name, and over a generic family of that name.
     * Registering a name again replaces its family.
     */
    fun register(name: String, family: FontFamily) {
        val key = fontKey(name)
        require(key.isNotEmpty()) { "A font name has at least one letter or digit" }
        registered[key] = family
    }

    /** Forgets the family registered under [name]; a font the app ships under it applies again. */
    fun unregister(name: String) {
        registered.remove(fontKey(name))
    }

    /** The family registered under [name], or null. */
    internal fun registered(name: String): FontFamily? = registered[fontKey(name)]

    /** Forgets every registration: for tests. */
    internal fun clear() = registered.clear()
}

/** A font file the host may ship is at most this large: a larger one is not read (iOS). */
const val MAX_HOST_FONT_BYTES = 10 * 1024 * 1024

/** Finds a font the host app ships by its family name; null when it has none. */
internal fun interface HostFontLookup {
    fun find(name: String): FontFamily?

    companion object {
        /** Finds nothing: generic families and registrations only. */
        val None = HostFontLookup { null }
    }
}

/** The host fonts to use, when not the platform's own: tests provide one. */
internal val LocalHostFonts = staticCompositionLocalOf<HostFontLookup?> { null }

/** The platform's lookup of the fonts the app ships (res/font and assets/fonts, or the app bundle's). */
@Composable
internal expect fun rememberPlatformHostFonts(): HostFontLookup

/** The host fonts of this composition: [LocalHostFonts], else the platform's. */
@Composable
internal fun hostFonts(): HostFontLookup = LocalHostFonts.current ?: rememberPlatformHostFonts()

/** The family of a CSS font list in this composition ([fontFamilyOf]), or null; the list is parsed once. */
@Composable
internal fun rememberFontFamily(list: String?): FontFamily? {
    val names = remember(list) { list?.let(::fontListEntries) }
    return names?.let { fontFamilyOf(it, hostFonts()) }
}

/** The family of one family name (a project font's), never a generic family, or null. */
@Composable
internal fun rememberNamedFontFamily(name: String?): FontFamily? =
    name?.takeIf { fontKey(it).isNotEmpty() }?.let { fontFamilyOf(listOf(FontListEntry(it, quoted = true)), hostFonts()) }

/** One name of a font list: its text without quotes, and whether it was quoted. */
internal data class FontListEntry(val name: String, val quoted: Boolean)

/**
 * The names of a CSS font list in order, as a browser splits `font-family`: at commas outside
 * quotes, each name trimmed and without its quotes, each run of spaces one space; empty names are
 * left out, and an unclosed quote runs to the end.
 */
internal fun fontListEntries(list: String): List<FontListEntry> {
    val entries = mutableListOf<FontListEntry>()
    val current = StringBuilder()
    var quote: Char? = null
    var quoted = false
    fun flush() {
        val name = current.toString().trim().replace(SPACES, " ")
        if (name.isNotEmpty()) entries += FontListEntry(name, quoted)
        current.clear()
        quoted = false
    }
    for (c in list) {
        when {
            quote != null && c == quote -> quote = null
            quote != null -> current.append(c)
            c == '"' || c == '\'' -> {
                quote = c
                quoted = true
            }
            c == ',' -> flush()
            else -> current.append(c)
        }
    }
    flush()
    return entries
}

/** The names of a CSS font list ([fontListEntries]), without whether they were quoted. */
internal fun fontListNames(list: String): List<String> = fontListEntries(list).map { it.name }

/** A family name as it is compared: in lower case, quotes trimmed, each run of spaces one space. */
internal fun fontKey(name: String): String = name.trim().trim('"', '\'').trim().replace(SPACES, " ").lowercase()

/**
 * A family name as an Android resource name: in lower case, each space `_` and each hyphen `__`,
 * so distinct names stay distinct (`Brand Sans` is `brand_sans`, `Brand-Sans` is `brand__sans`).
 * Null for a name a resource cannot carry: anything but ASCII letters, digits, spaces and hyphens,
 * or not starting with a letter.
 */
internal fun fontResourceName(name: String): String? {
    val n = name.trim().replace(SPACES, " ").lowercase()
    if (!RESOURCE_FAMILY.matches(n)) return null
    return n.replace("-", "__").replace(" ", "_")
}

private val SPACES = Regex("\\s+")
private val RESOURCE_FAMILY = Regex("^[a-z][a-z0-9 -]*$")

/**
 * The generic family a CSS generic name draws in natively: the platform's closest family. The web's
 * `ui-*` names and `system-ui` are the system font, as on the platform's browsers.
 */
internal fun genericFamily(name: String): FontFamily? = when (fontKey(name)) {
    "serif", "ui-serif" -> FontFamily.Serif
    "sans-serif", "ui-sans-serif" -> FontFamily.SansSerif
    "monospace", "ui-monospace" -> FontFamily.Monospace
    "cursive" -> FontFamily.Cursive
    "system-ui", "ui-rounded" -> FontFamily.Default
    else -> null
}

/**
 * The family a CSS font list draws in, as a browser picks it: the first entry that is a
 * [TaleartFonts] registration, an unquoted generic family or a font [host] finds. Null when none
 * is (the caller's fallback applies: the text's fallback stack, the host's title font).
 */
internal fun fontFamilyOf(list: String?, host: HostFontLookup = HostFontLookup.None): FontFamily? =
    list?.let { fontFamilyOf(fontListEntries(it), host) }

internal fun fontFamilyOf(entries: List<FontListEntry>, host: HostFontLookup): FontFamily? {
    for (entry in entries) {
        TaleartFonts.registered(entry.name)?.let { return it }
        if (!entry.quoted) genericFamily(entry.name)?.let { return it }
        runCatching { host.find(entry.name) }.getOrNull()?.let { return it }
    }
    return null
}

/** A face of a family by the suffix of its file or resource name, with its weight and italic. */
internal data class FaceSuffix(val resource: String, val asset: String, val weight: Int, val italic: Boolean)

/** The faces a host font's files may carry by suffix, tried only when the bare name has no font. */
internal val FACE_SUFFIXES = listOf(
    FaceSuffix("_regular", "-regular", 400, false),
    FaceSuffix("_italic", "-italic", 400, true),
    FaceSuffix("_medium", "-medium", 500, false),
    FaceSuffix("_semibold", "-semibold", 600, false),
    FaceSuffix("_bold", "-bold", 700, false),
    FaceSuffix("_bold_italic", "-bolditalic", 700, true),
)
