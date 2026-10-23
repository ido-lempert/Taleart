package site.lempert.taleart.sdk.ui

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.longOrNull

/** The display type the banner renders (AD-5), as `BANNER_FRAME_TYPE` in the Web SDK. */
const val BANNER_FRAME_TYPE = "banner"

/** The banner's width to height, as the schema lists them (`BANNER_RATIOS` in the Web SDK). */
enum class BannerAspectRatio(val key: String, val widthOverHeight: Float) {
    Wide("16:9", 16f / 9f),
    Strip("3:1", 3f),
    Square("1:1", 1f),
}

/**
 * The banner display's settings (web zones R3), as libs/contract/frame-types/banner.schema.json
 * defines them; the defaults are the schema's (`BANNER_DEFAULTS` in the Web SDK).
 */
data class BannerSettings(
    val aspectRatio: BannerAspectRatio = BannerAspectRatio.Wide,
    /** Move to the next slide by itself; stops when the person interacts or prefers reduced motion. */
    val autoplay: Boolean = true,
    /** Seconds each slide shows while autoplaying, from [INTERVAL_MIN] to [INTERVAL_MAX]. */
    val intervalSeconds: Int = 5,
    /** A dot per slide to jump to it. */
    val showDots: Boolean = true,
    /** After the last slide, go back to the first. */
    val loop: Boolean = true,
) {
    companion object {
        const val INTERVAL_MIN = 3
        const val INTERVAL_MAX = 15

        /**
         * The settings to render, as `readBannerSettings` in the Web SDK: each field the Delivery API
         * sent when it is valid, else its default. Never throws or logs.
         */
        fun read(raw: JsonElement?): BannerSettings {
            val s = raw as? JsonObject ?: JsonObject(emptyMap())
            val defaults = BannerSettings()
            fun bool(key: String) = (s[key] as? JsonPrimitive)?.takeIf { !it.isString }?.booleanOrNull
            val ratio = (s["aspectRatio"] as? JsonPrimitive)?.takeIf { it.isString }?.content
            // An integer, as JavaScript's Number.isInteger reads it: 5 and 5.0 are, 5.5 and "5" are not.
            val interval = (s["intervalSeconds"] as? JsonPrimitive)?.takeIf { !it.isString }?.let { p ->
                p.longOrNull ?: p.content.toDoubleOrNull()?.takeIf { it % 1.0 == 0.0 }?.toLong()
            }
            return BannerSettings(
                aspectRatio = BannerAspectRatio.entries.firstOrNull { it.key == ratio } ?: defaults.aspectRatio,
                autoplay = bool("autoplay") ?: defaults.autoplay,
                intervalSeconds = interval?.takeIf { it in INTERVAL_MIN..INTERVAL_MAX }?.toInt() ?: defaults.intervalSeconds,
                showDots = bool("showDots") ?: defaults.showDots,
                loop = bool("loop") ?: defaults.loop,
            )
        }
    }
}
