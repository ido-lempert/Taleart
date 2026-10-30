package site.lempert.taleart.sdk.ui

import kotlin.math.abs
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sign

/** One loop of the strip's marquee, in milliseconds: it scrolls at a fixed speed. */
const val STRIP_LOOP_MS = 18_000L

/**
 * A slide's place relative to the shown one, in slides: 0 for the shown slide, 1 for the next, -1 for
 * the previous. With [loop] the offset wraps round the ends so the slides beside the shown one are
 * the nearest ones, in the range -count/2 to count/2. [position] is the track's position (fractional
 * while a slide moves).
 */
internal fun bannerRelative(n: Int, position: Float, count: Int, loop: Boolean): Float {
    val d = n - position
    if (!loop || count <= 1) return d
    val half = count / 2f
    var wrapped = d
    while (wrapped > half) wrapped -= count
    while (wrapped < -half) wrapped += count
    return wrapped
}

/**
 * A slide's look at [scale], [rotation] (degrees, away from the shown slide: the sign is the slide's
 * side), [alpha] and [shift] (a fraction of the card's width, the same side as the rotation).
 */
internal class BannerLook(val scale: Float, val rotation: Float, val alpha: Float, val shift: Float = 0f)

// A value at distance 0, 1 and 2 slides, straight between them (beyond 2 it stays at the far value).
private fun piecewise(distance: Float, near: Float, middle: Float, far: Float): Float {
    val a = min(abs(distance), 2f)
    return if (a <= 1f) near + (middle - near) * a else middle + (far - middle) * (a - 1f)
}

/** Cover flow: the shown slide in front, its neighbours smaller, turned and faded, as the Web SDK's coverflow. */
internal fun coverflowLook(distance: Float): BannerLook = BannerLook(
    scale = piecewise(distance, 1f, 0.74f, 0.56f),
    rotation = piecewise(distance, 0f, 32f, 32f),
    alpha = piecewise(distance, 1f, 0.75f, 0.25f),
)

/** Peek: the neighbours a little smaller and dimmer than the shown slide. */
internal fun peekLook(distance: Float): BannerLook = BannerLook(
    scale = piecewise(distance, 1f, 0.92f, 0.92f),
    rotation = 0f,
    alpha = piecewise(distance, 1f, 0.6f, 0.6f),
)

/** Deck: the cards fanned out behind the front one, each further one turned and shifted more. */
internal fun deckLook(distance: Float): BannerLook = BannerLook(
    scale = piecewise(distance, 1f, 0.94f, 0.88f),
    rotation = piecewise(distance, 0f, 14f, 20f),
    alpha = 1f,
    shift = piecewise(distance, 0f, 0.16f, 0.32f),
)

/** The sign of a slide's side as a rotation or shift factor: -1 before the shown slide, 1 after it, 0 at it. */
internal fun sideOf(distance: Float): Float = sign(distance)

/**
 * How far the strip's marquee has moved after [elapsedNanos] of motion, in pixels, for a copy of the
 * items [copyWidthPx] wide. The offset is always toward the start of the line, negative: the layout
 * places it relative to the direction, so it runs left in left to right and right in right to left.
 * Each loop of [STRIP_LOOP_MS] brings it back where it began.
 */
internal fun stripOffsetPx(elapsedNanos: Long, copyWidthPx: Int): Int {
    if (copyWidthPx <= 0 || elapsedNanos <= 0L) return 0
    val period = STRIP_LOOP_MS * 1_000_000L
    val fraction = (elapsedNanos % period).toDouble() / period
    return -(fraction * copyWidthPx).roundToInt()
}

/** The key a sticky banner's dismissal is remembered under: the slides it shows, in order. */
internal fun stickyKey(groupIds: List<String>): String = groupIds.joinToString(",")

/** The width of a dot's pill: the shown slide's is longer. */
internal fun dotPillDp(current: Boolean): Int = if (current) DOT_CURRENT_DP else DOT_IDLE_DP

internal const val DOT_IDLE_DP = 8
internal const val DOT_CURRENT_DP = 20
