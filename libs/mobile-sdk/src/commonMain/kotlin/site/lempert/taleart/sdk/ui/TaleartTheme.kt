package site.lempert.taleart.sdk.ui

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.longOrNull

/** How a group's ring is drawn (R9). */
enum class RingStyle(val key: String) { Gradient("gradient"), Solid("solid"), None("none") }

/**
 * A project's theme (R9), as `Theme` in the Web SDK, every field filled. Colours are `#rrggbb`;
 * `null` takes the host's value (title colour, font) or the display's own (corner radius).
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

/**
 * The first family of a CSS font list the platform can draw by name: the generic families
 * (`serif`, `sans-serif`, `monospace`, `cursive`, `system-ui`). Other names are skipped, as a
 * browser skips fonts it does not have; null when none is left (the host's font applies).
 */
internal fun fontFamilyOf(list: String?): FontFamily? {
    if (list == null) return null
    for (raw in list.split(',')) {
        when (raw.trim().trim('"', '\'').trim().lowercase()) {
            "serif" -> return FontFamily.Serif
            "sans-serif" -> return FontFamily.SansSerif
            "monospace" -> return FontFamily.Monospace
            "cursive" -> return FontFamily.Cursive
            "system-ui" -> return FontFamily.Default
        }
    }
    return null
}
