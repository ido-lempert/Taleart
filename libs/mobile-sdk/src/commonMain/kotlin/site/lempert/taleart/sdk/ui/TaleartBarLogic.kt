package site.lempert.taleart.sdk.ui

import androidx.compose.ui.graphics.Color
import kotlin.math.max
import kotlin.math.min

// The bar layouts' rules that do not draw anything: how many covers a stack shows, which group a stack opens,
// how large each layout's cover is, what the skeleton is made of. Kept apart from the drawing so they can be
// tested on their own.

/** The most covers a stack draws; the groups past them are counted in its '+N' bubble. */
internal const val STACK_VISIBLE_COVERS = 4

/** Most tale segments a poster draws at its top (one per tale, up to this many). */
internal const val POSTER_MAX_SEGMENTS = 8

/** A poster card's width and height in dp: 3:5, a portrait card. */
internal const val POSTER_WIDTH_DP = 120
internal const val POSTER_HEIGHT_DP = 200

/** How many groups a stack draws as covers. */
internal fun stackVisibleCount(groups: Int): Int = min(max(groups, 0), STACK_VISIBLE_COVERS)

/** The groups a stack folds into its '+N' bubble. */
internal fun stackOverflow(groups: Int): Int = max(0, groups - STACK_VISIBLE_COVERS)

/** The index of the first group not in [seen], in the delivered order; null when all are seen. */
internal fun firstUnseenIndex(ids: List<String>, seen: Set<String>): Int? =
    ids.indexOfFirst { it !in seen }.takeIf { it >= 0 }

/** The group a stack opens: the first unseen one, else the first one. Null for no group. */
internal fun stackOpenIndex(ids: List<String>, seen: Set<String>): Int? =
    if (ids.isEmpty()) null else firstUnseenIndex(ids, seen) ?: 0

/** How many tale segments a poster draws for a group of [tales] tales. */
internal fun posterSegmentCount(tales: Int): Int = min(max(tales, 0), POSTER_MAX_SEGMENTS)

/** The edge in dp of a chip's round cover: 28, 32 or 40 for small, medium or large. */
internal fun chipCoverDp(size: BarSize): Int = when (size) {
    BarSize.Small -> 28
    BarSize.Medium -> 32
    BarSize.Large -> 40
}

/** The edge in dp of each cover in a stack: 40, 48 or 56 for small, medium or large. */
internal fun stackCoverDp(size: BarSize): Int = when (size) {
    BarSize.Small -> 40
    BarSize.Medium -> 48
    BarSize.Large -> 56
}

/** How many placeholders a layout's skeleton draws while its zone loads (covers, pills or cards). */
internal fun skeletonCount(layout: BarLayout): Int = when (layout) {
    BarLayout.Ring -> 4
    BarLayout.Chip -> 3
    BarLayout.Poster -> 3
    BarLayout.Stack -> 3
}

/** The colours a sweep brush of the ring is made of: up to three, then the first again so the turn closes. */
internal fun ringSweepColors(colors: List<Color>): List<Color> =
    if (colors.size <= 1) colors else colors.take(3) + colors.first()

/**
 * The colour of a chip's unseen dot: the theme's accent when it stands out (3:1 or more) on the card, else the
 * theme's live colour, so the dot is seen on a white accent too.
 */
internal fun accentDotColor(accent: Color, ground: Color, live: Color): Color {
    fun contrast(other: Color): Double {
        val a = relativeLuminance(other)
        val b = relativeLuminance(ground)
        return (max(a, b) + 0.05) / (min(a, b) + 0.05)
    }
    return if (contrast(accent) >= 3.0) accent else live
}

/**
 * The settings a zone's bar was last drawn with, by the zone's key, in memory only (the SDK keeps no zone between
 * launches). A loading bar draws its skeleton in that footprint, so a zone that was on screen before shows no
 * layout shift while it reads again; the first read of a zone has no settings and draws the default footprint.
 */
internal object LastBarSettings {
    private val byZone = mutableMapOf<String, BarSettings>()

    fun remember(zoneKey: String, settings: BarSettings) {
        if (zoneKey.isNotEmpty()) byZone[zoneKey] = settings
    }

    fun of(zoneKey: String): BarSettings? = byZone[zoneKey]
}
