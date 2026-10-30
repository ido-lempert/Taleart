package site.lempert.taleart.sdk.ui

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.longOrNull

/** The display type the bar renders (AD-5), as `BAR_FRAME_TYPE` in the Web SDK. */
const val BAR_FRAME_TYPE = "bar"

/**
 * How each tale group is drawn (`layout` in bar.schema.json): [Ring] the cover in a gradient ring, the default;
 * [Chip] a round cover beside its title in a pill; [Poster] a tall card with the title over the cover; [Stack]
 * the groups overlapping in one collapsed button.
 */
enum class BarLayout(val key: String) { Ring("ring"), Chip("chip"), Poster("poster"), Stack("stack") }

/** How a bar cover is cut: `circle` or `rounded-square`. */
enum class BarShape(val key: String) { Circle("circle"), RoundedSquare("rounded-square") }

/** How large each cover is, with its edge in dp (`BAR_SIZE_PX` in the Web SDK: 48, 64, 80). */
enum class BarSize(val key: String, val edgeDp: Int) { Small("small", 48), Medium("medium", 64), Large("large", 80) }

/** Where the items sit when they do not fill the row: `start` or `center`. */
enum class BarAlignment(val key: String) { Start("start"), Center("center") }

/**
 * The bar display's settings (web zones R2), as libs/contract/frame-types/bar.schema.json defines
 * them; the defaults are the schema's (`BAR_DEFAULTS` in the Web SDK).
 */
data class BarSettings(
    val shape: BarShape = BarShape.Circle,
    val size: BarSize = BarSize.Medium,
    val showTitles: Boolean = true,
    val alignment: BarAlignment = BarAlignment.Start,
    /** Space between items in dp, from [GAP_MIN] to [GAP_MAX]. */
    val gap: Int = 12,
    /** How each group is drawn; the others' settings it ignores are listed in bar.schema.json. */
    val layout: BarLayout = BarLayout.Ring,
) {
    companion object {
        const val GAP_MIN = 4
        const val GAP_MAX = 24

        /**
         * The settings to render, as `readBarSettings` in the Web SDK: each field the Delivery API
         * sent when it is valid, else its default. Never throws.
         */
        fun read(raw: JsonElement?): BarSettings {
            val s = raw as? JsonObject ?: JsonObject(emptyMap())
            fun text(key: String) = (s[key] as? JsonPrimitive)?.takeIf { it.isString }?.content
            val defaults = BarSettings()
            val gap = (s["gap"] as? JsonPrimitive)?.takeIf { !it.isString }?.let { p ->
                p.longOrNull ?: p.content.toDoubleOrNull()?.takeIf { it % 1.0 == 0.0 }?.toLong()
            }
            return BarSettings(
                layout = BarLayout.entries.firstOrNull { it.key == text("layout") } ?: defaults.layout,
                shape = BarShape.entries.firstOrNull { it.key == text("shape") } ?: defaults.shape,
                size = BarSize.entries.firstOrNull { it.key == text("size") } ?: defaults.size,
                showTitles = (s["showTitles"] as? JsonPrimitive)?.takeIf { !it.isString }?.booleanOrNull ?: defaults.showTitles,
                alignment = BarAlignment.entries.firstOrNull { it.key == text("alignment") } ?: defaults.alignment,
                gap = gap?.takeIf { it in GAP_MIN..GAP_MAX }?.toInt() ?: defaults.gap,
            )
        }
    }
}
