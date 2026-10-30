package site.lempert.taleart.sdk.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow

/** How a group's ring is drawn (R9). */
enum class RingStyle(val key: String) { Gradient("gradient"), Solid("solid"), None("none") }

/** Which colour scheme the display draws: `Auto` follows the host's light or dark setting (theme handoff 4.3). */
enum class ColorScheme(val key: String) { Auto("auto"), Light("light"), Dark("dark") }

/**
 * A project's theme (R9), as `Theme` in the Web SDK, every field filled. Colours are `#rrggbb`;
 * `null` takes the host's value (title colour, font), the display's own (corner radius) or, for
 * [liveColor], the last ring colour.
 */
data class TaleartTheme(
    val ringStyle: RingStyle = RingStyle.Gradient,
    val ringColors: List<String> = listOf("#ea580c", "#db2777", "#7c3aed"),
    val seenRingColor: String = "#6b7280",
    /** dp, 1 to 4. */
    val ringWidth: Int = 2,
    /** dp, 0 to 32. */
    val cornerRadius: Int? = null,
    /** A CSS font list, such as `Georgia, serif`. */
    val fontFamily: String? = null,
    val titleColor: String? = null,
    /** `transparent` or `#rrggbb`. */
    val backgroundColor: String = "transparent",
    /** `#rrggbb`; the bar does not use it (the viewer and banner do). */
    val accentColor: String = "#ffffff",
    val colorScheme: ColorScheme = ColorScheme.Auto,
    /** `#rrggbb`; `null` takes the last ring colour. */
    val liveColor: String? = null,
    /** `#rrggbb`: a right quiz answer. */
    val successColor: String = "#047857",
    /** `#rrggbb`: a wrong quiz answer. */
    val errorColor: String = "#b91c1c",
) {
    companion object {
        /** TaleArt's default theme (`THEME_DEFAULTS` in the Web SDK, the contract's `DEFAULT_THEME`). */
        val DEFAULT = TaleartTheme()

        /**
         * The theme to render, as `readTheme` in the Web SDK: each field the Delivery API sent when it
         * passes the theme's rules, else the default. Never throws or logs.
         */
        fun read(raw: JsonElement?): TaleartTheme {
            val t = raw as? JsonObject ?: return DEFAULT
            val d = DEFAULT
            fun prim(key: String) = t[key] as? JsonPrimitive
            fun text(key: String) = prim(key)?.takeIf { it.isString }?.content
            fun isNull(key: String) = t[key] is JsonNull
            fun int(key: String, min: Int, max: Int) = prim(key)?.takeIf { !it.isString }?.let { p ->
                p.longOrNull ?: p.content.toDoubleOrNull()?.takeIf { it % 1.0 == 0.0 }?.toLong()
            }?.takeIf { it in min..max }?.toInt()
            val colors = (t["ringColors"] as? JsonArray)?.let { list ->
                val values = list.map { (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content }
                values.takeIf { it.size in 1..3 && it.all { c -> c != null && isThemeColor(c) } }?.filterNotNull()
            }
            return TaleartTheme(
                ringStyle = RingStyle.entries.firstOrNull { it.key == text("ringStyle") } ?: d.ringStyle,
                ringColors = colors ?: d.ringColors,
                seenRingColor = text("seenRingColor")?.takeIf(::isThemeColor) ?: d.seenRingColor,
                ringWidth = int("ringWidth", 1, 4) ?: d.ringWidth,
                cornerRadius = if (isNull("cornerRadius")) null else int("cornerRadius", 0, 32) ?: d.cornerRadius,
                fontFamily = if (isNull("fontFamily")) null
                else text("fontFamily")?.takeIf { it.length <= 200 && FONT_LIST.matches(it) } ?: d.fontFamily,
                titleColor = if (isNull("titleColor")) null else text("titleColor")?.takeIf(::isThemeColor) ?: d.titleColor,
                backgroundColor = text("backgroundColor")?.takeIf { it == "transparent" || isThemeColor(it) } ?: d.backgroundColor,
                accentColor = text("accentColor")?.takeIf(::isThemeColor) ?: d.accentColor,
                colorScheme = ColorScheme.entries.firstOrNull { it.key == text("colorScheme") } ?: d.colorScheme,
                liveColor = if (isNull("liveColor")) null else text("liveColor")?.takeIf(::isThemeColor) ?: d.liveColor,
                successColor = text("successColor")?.takeIf(::isThemeColor) ?: d.successColor,
                errorColor = text("errorColor")?.takeIf(::isThemeColor) ?: d.errorColor,
            )
        }
    }
}

private val COLOR = Regex("^#[0-9a-fA-F]{6}$")
private const val KEYWORDS = "inherit|initial|unset|revert|revert-layer|default"
private const val NAME = """(?:[A-Za-z][A-Za-z0-9 -]*|"[A-Za-z0-9 -]+"|'[A-Za-z0-9 -]+')"""

// The Web SDK's font-list rule: names or quoted names, no CSS-wide keywords, no reserved project-font names.
private val FONT_LIST = Regex(
    """^(?!.*(?:^|[\s,"'])(?:$KEYWORDS)(?=$|[\s,"']))(?!.*(?:^|[\s,"'])taleart-font-)\s*$NAME\s*(?:,\s*$NAME\s*)*$""",
    RegexOption.IGNORE_CASE,
)

internal fun isThemeColor(value: String): Boolean = COLOR.matches(value)

/** `#rrggbb` or `#rrggbbaa` as a colour, else null. */
internal fun parseHexColor(value: String?): Color? {
    if (value == null || !Regex("^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$").matches(value)) return null
    val rgb = value.substring(1, 7).toLong(16)
    val alpha = if (value.length == 9) value.substring(7, 9).toLong(16) else 0xFF
    return Color(((alpha shl 24) or rgb).toInt())
}

// The two neutral anchors of the colour schemes, the same as the Web SDK's (`SCHEME` in theme.ts): a
// card's ground and its ink, light and dark. Every neutral the SDK draws comes from these.
internal val CardLight = Color(0xFFFFFFFF)
internal val InkLight = Color(0xFF111827)
internal val CardDark = Color(0xFF111827)
internal val InkDark = Color(0xFFFFFFFF)

/**
 * The colours a theme draws with, derived as the Web SDK's `--ta-*` tokens (handoff 4.2): the muted
 * ink at 65 %, the surface (the background, else the title at 6 %), white or near-black on the accent
 * by contrast, the live, success and error colours, and the scheme's card ground and ink.
 */
internal class ThemeColors(
    /** The title colour: the theme's, else the host's. */
    val title: Color,
    /** `--ta-muted`: the title at 65 %. */
    val muted: Color,
    /** `--ta-surface`: the background, else the title at 6 %. */
    val surface: Color,
    /** `--ta-accent`. */
    val accent: Color,
    /** `--ta-on-accent`: white or near-black, whichever contrasts more with the accent. */
    val onAccent: Color,
    /** `--ta-live`: the live colour, else the last ring colour. */
    val live: Color,
    /** `--ta-success`: the colour itself, for a light card. */
    val success: Color,
    /** `--ta-error`: the colour itself, for a light card. */
    val error: Color,
    /** `--ta-success-ink`: the mark on the resolved scheme's card (lightened on dark until 4.5:1). */
    val successInk: Color,
    /** `--ta-error-ink`: the mark on the resolved scheme's card. */
    val errorInk: Color,
    /** `--ta-success-on-dark`: the mark on the dark card, at 4.5:1 or more. */
    val successOnDark: Color,
    /** `--ta-error-on-dark`: the mark on the dark card, at 4.5:1 or more. */
    val errorOnDark: Color,
    /** `--ta-gap`: the background, else the card ground. */
    val gap: Color,
    /** The resolved colour scheme. */
    val dark: Boolean,
    /** `--ta-paper`: the card ground of the resolved scheme. */
    val paper: Color,
    /** `--ta-ink`: the ink of the resolved scheme. */
    val ink: Color,
)

/**
 * The palette of this theme. [hostTitle] is the host's title colour (used when the theme sets none),
 * [systemDark] whether the host's light or dark setting is dark: `Auto` follows it, `Light` and `Dark` force.
 */
internal fun TaleartTheme.colors(hostTitle: Color, systemDark: Boolean): ThemeColors {
    val dark = when (colorScheme) {
        ColorScheme.Light -> false
        ColorScheme.Dark -> true
        ColorScheme.Auto -> systemDark
    }
    val paper = if (dark) CardDark else CardLight
    val ink = if (dark) InkDark else InkLight
    val title = parseHexColor(titleColor) ?: hostTitle.takeUnless { it == Color.Unspecified } ?: ink
    val accentColor = parseHexColor(accentColor) ?: InkDark
    val background = parseHexColor(backgroundColor)
    val success = parseHexColor(successColor) ?: parseHexColor("#047857")!!
    val error = parseHexColor(errorColor) ?: parseHexColor("#b91c1c")!!
    val successOnDark = readableOn(success, CardDark)
    val errorOnDark = readableOn(error, CardDark)
    return ThemeColors(
        title = title,
        muted = title.copy(alpha = 0.65f),
        surface = background ?: title.copy(alpha = 0.06f),
        accent = accentColor,
        onAccent = onAccentColor(accentColor),
        live = parseHexColor(liveColor) ?: parseHexColor(ringColors.last()) ?: accentColor,
        success = success,
        successInk = if (dark) successOnDark else success,
        error = error,
        errorInk = if (dark) errorOnDark else error,
        successOnDark = successOnDark,
        errorOnDark = errorOnDark,
        gap = background ?: paper,
        dark = dark,
        paper = paper,
        ink = ink,
    )
}

/** White or near-black, whichever has the higher WCAG contrast with [accent]. */
internal fun onAccentColor(accent: Color): Color {
    val luminance = relativeLuminance(accent)
    fun contrast(other: Double) = (max(luminance, other) + 0.05) / (min(luminance, other) + 0.05)
    val white = Color(0xFFFFFFFF)
    return if (contrast(relativeLuminance(white)) >= contrast(relativeLuminance(InkLight))) white else InkLight
}

/**
 * The least lightening of [color] toward white that reads at 4.5:1 on [ground] (the colour itself when it
 * already does), as the Web SDK's `readableOn`.
 */
internal fun readableOn(color: Color, ground: Color): Color {
    fun contrast(other: Color): Double {
        val a = relativeLuminance(other)
        val b = relativeLuminance(ground)
        return (max(a, b) + 0.05) / (min(a, b) + 0.05)
    }
    if (contrast(color) >= 4.5) return color
    for (step in 1..100) {
        val mixed = lerp(color, Color.White, step / 100f)
        if (contrast(mixed) >= 4.5) return mixed
    }
    return Color.White
}

/** The WCAG relative luminance of a colour, as the Web SDK's `relativeLuminance`. */
internal fun relativeLuminance(color: Color): Double {
    fun channel(v: Float): Double {
        val c = v.toDouble()
        return if (c <= 0.03928) c / 12.92 else ((c + 0.055) / 1.055).pow(2.4)
    }
    return 0.2126 * channel(color.red) + 0.7152 * channel(color.green) + 0.0722 * channel(color.blue)
}

/** The theme the display draws with, for the components inside it (the bar, the banner, the viewer and the zone). */
internal val LocalTaleartTheme = compositionLocalOf { TaleartTheme.DEFAULT }

/** The palette of the theme in [LocalTaleartTheme], with the host's title colour and its light or dark setting. */
@Composable
internal fun rememberThemeColors(hostTitle: Color = Color.Unspecified): ThemeColors {
    val theme = LocalTaleartTheme.current
    val systemDark = rememberPrefersDarkScheme()
    return remember(theme, hostTitle, systemDark) { theme.colors(hostTitle, systemDark) }
}

/** Provides [theme] to the components inside, as the palette and colour scheme read it. */
@Composable
internal fun ProvideTaleartTheme(theme: TaleartTheme, content: @Composable () -> Unit) {
    CompositionLocalProvider(LocalTaleartTheme provides theme, content = content)
}
