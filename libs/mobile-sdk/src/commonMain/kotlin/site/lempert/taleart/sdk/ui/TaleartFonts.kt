package site.lempert.taleart.sdk.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.text.font.FontFamily

/**
 * The fonts the SDK draws content in by family name (story 9.8, owner decision 2026-10-23).
 *
 * The host app installs its fonts itself, separately from the SDK, and the family name comes from
 * the content: a tale document's text font list, the project theme's `fontFamily` (the bar's titles,
 * the viewer's group name and the document's theme-font text). The SDK never downloads a font. A
 * name resolves, in this order, to:
 * 1. a family [register]ed under it here;
 * 2. a font the app ships: on Android `res/font/<name>` (the name in lower case, each run of other
 *    characters than letters and digits one `_`, so `Brand Sans` is `res/font/brand_sans.ttf`) or
 *    `assets/fonts/<name>.ttf` / `.otf` (matched the same way); on iOS a font the app registered
 *    (`UIAppFonts` in Info.plist), or any font iOS has, by its family name.
 *
 * A font list is read as a browser reads `font-family`: names case-insensitive, quotes trimmed,
 * the first entry available wins, a generic family (`serif`, `sans-serif`, `monospace`, `cursive`,
 * `system-ui`) is always available, and when nothing in the list is, the text's own fallback.
 * Faces of one family by weight: `<name>_bold`, `<name>_italic`, `<name>_bold_italic`, `<name>_medium`,
 * `<name>_semibold` beside `<name>` or `<name>_regular` on Android; the family's faces on iOS.
 *
 * Call it from the main thread. A registration made while content shows redraws it.
 */
object TaleartFonts {
    private val registered = mutableStateMapOf<String, FontFamily>()

    /**
     * Draws content that names [name] (in any case, quoted or not) in [family]; it takes priority
     * over a font the app ships under the same name. Registering a name again replaces its family.
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

/** The platform's lookup of the fonts the app ships (res/font and assets/fonts, or iOS's fonts). */
@Composable
internal expect fun rememberPlatformHostFonts(): HostFontLookup

/** The host fonts of this composition: [LocalHostFonts], else the platform's. */
@Composable
internal fun hostFonts(): HostFontLookup = LocalHostFonts.current ?: rememberPlatformHostFonts()

/** The family of a CSS font list in this composition ([fontFamilyOf]), or null. */
@Composable
internal fun rememberFontFamily(list: String?): FontFamily? = fontFamilyOf(list, hostFonts())

/**
 * The names of a CSS font list in order, each with its quotes and the spaces around it trimmed and
 * each run of spaces inside it one space; empty entries are left out.
 */
internal fun fontListNames(list: String): List<String> = list.split(',')
    .map { it.trim().trim('"', '\'').trim().replace(SPACES, " ") }
    .filter { it.isNotEmpty() }

/** A family name as it is compared: in lower case, quotes trimmed, each run of spaces one space. */
internal fun fontKey(name: String): String = name.trim().trim('"', '\'').trim().replace(SPACES, " ").lowercase()

/**
 * A family name as an Android resource or file name is matched: in lower case, each run of other
 * characters than letters and digits one `_`, none at either end (`Brand Sans` and `brand-sans`
 * are `brand_sans`). Null when nothing is left.
 */
internal fun fontResourceName(name: String): String? =
    name.lowercase().replace(NOT_NAME, "_").trim('_').takeIf { it.isNotEmpty() }

private val SPACES = Regex("\\s+")
private val NOT_NAME = Regex("[^a-z0-9]+")

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
 * The family a CSS font list draws in, as a browser picks it: the first entry that is a generic
 * family, a [TaleartFonts] registration or a font [host] finds. Null when none is (the caller's
 * fallback applies: the text's fallback stack, the host's title font).
 */
internal fun fontFamilyOf(list: String?, host: HostFontLookup = HostFontLookup.None): FontFamily? {
    if (list == null) return null
    for (name in fontListNames(list)) {
        genericFamily(name)?.let { return it }
        TaleartFonts.registered(name)?.let { return it }
        runCatching { host.find(name) }.getOrNull()?.let { return it }
    }
    return null
}

/** A face's weight from the suffix of a font file or resource name (`_bold`, `_semibold`…), with its italic; null for no suffix. */
internal data class FaceSuffix(val suffix: String, val weight: Int, val italic: Boolean)

/** The face suffixes a host font's files may carry, beside the bare name (regular). */
internal val FACE_SUFFIXES = listOf(
    FaceSuffix("", 400, false),
    FaceSuffix("_regular", 400, false),
    FaceSuffix("_italic", 400, true),
    FaceSuffix("_medium", 500, false),
    FaceSuffix("_semibold", 600, false),
    FaceSuffix("_bold", 700, false),
    FaceSuffix("_bold_italic", 700, true),
    FaceSuffix("_bolditalic", 700, true),
)
