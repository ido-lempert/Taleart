package site.lempert.taleart.sdk.ui

import androidx.compose.ui.Alignment
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraintsScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex
import kotlin.math.abs
import kotlin.math.min
import kotlin.math.roundToInt

// The gap between the shown card and the peeking ones, in dp.
private const val PEEK_GAP_DP = 12

// Beyond this many slides away a card is not drawn: it is off the viewport, or behind the fan's last card.
private const val MAX_DRAWN_DISTANCE = 2.5f

/**
 * Coverflow: the shown slide in front, at 60% of the viewport's width; its neighbours overlap it, turned
 * away at the sides and smaller, the far ones behind. In right to left the line runs the other way, so
 * the turn and the offsets mirror. A neighbour's tap shows it.
 */
@Composable
internal fun BoxWithConstraintsScope.CoverflowTrack(playback: BannerPlayback, view: BannerViewContext, aspect: Float) {
    val density = LocalDensity.current
    val cardWidth = maxWidth * 0.6f
    val cardHeight = cardWidth / aspect
    val cardPx = with(density) { cardWidth.toPx() }
    val mirror = if (view.rtl) -1f else 1f
    Box(Modifier.fillMaxSize().clipToBounds(), contentAlignment = Alignment.Center) {
        playback.slides.forEachIndexed { n, group ->
            val shown = n == playback.index
            val d = playback.relative(n)
            val look = coverflowLook(d)
            Box(
                Modifier
                    .size(cardWidth, cardHeight)
                    .zIndex(10f - min(abs(d), 2f))
                    // Placed relative to the layout direction, which mirrors the offset in right to left.
                    .offset { IntOffset((d * cardPx * COVERFLOW_STEP).roundToInt(), 0) }
                    .graphicsLayer {
                        scaleX = look.scale
                        scaleY = look.scale
                        // A graphics layer is not mirrored by the layout: the turn is, in right to left.
                        rotationY = -look.rotation * sideOf(d) * mirror
                        alpha = look.alpha
                        cameraDistance = 12f * density.density
                    }
                    .clip(RoundedCornerShape(view.radius.dp))
                    .then(if (shown) shownSlideModifier(playback, n, group, view) else neighbourModifier(playback, n)),
            ) {
                SlideContent(group, view, showTitle = shown)
            }
        }
    }
}

// The distance between two coverflow cards, in card widths: the neighbours overlap the shown one.
private const val COVERFLOW_STEP = 0.55f

/**
 * Peek: the shown slide at 72% of the viewport's width, the neighbours showing at the edges (the content
 * padding of a pager), a little smaller and dimmer. The line runs toward the start, mirrored in right to
 * left by the layout's direction.
 */
@Composable
internal fun BoxWithConstraintsScope.PeekTrack(playback: BannerPlayback, view: BannerViewContext, aspect: Float) {
    val density = LocalDensity.current
    val cardWidth = maxWidth * 0.72f
    val cardHeight = cardWidth / aspect
    val stepPx = with(density) { (cardWidth + PEEK_GAP_DP.dp).toPx() }
    Box(Modifier.fillMaxSize().clipToBounds(), contentAlignment = Alignment.Center) {
        playback.slides.forEachIndexed { n, group ->
            val shown = n == playback.index
            val d = playback.relative(n)
            if (abs(d) > 1.5f && !shown) return@forEachIndexed
            val look = peekLook(d)
            Box(
                Modifier
                    .size(cardWidth, cardHeight)
                    .offset { IntOffset((d * stepPx).roundToInt(), 0) }
                    .graphicsLayer {
                        scaleX = look.scale
                        scaleY = look.scale
                        alpha = look.alpha
                    }
                    .clip(RoundedCornerShape(view.radius.dp))
                    .then(if (shown) shownSlideModifier(playback, n, group, view) else neighbourModifier(playback, n)),
            ) {
                SlideContent(group, view, showTitle = shown)
            }
        }
    }
}

/**
 * Deck: the slides fanned out like cards, the shown one in front at 56% of the viewport's width, each
 * card behind it turned about the foot of the deck and shifted to its side. Only the front card takes
 * taps to open the group; a tap on a card behind shows it.
 */
@Composable
internal fun BoxWithConstraintsScope.DeckTrack(playback: BannerPlayback, view: BannerViewContext, aspect: Float) {
    val density = LocalDensity.current
    val cardWidth = maxWidth * 0.56f
    val cardHeight = cardWidth / aspect
    val cardPx = with(density) { cardWidth.toPx() }
    val mirror = if (view.rtl) -1f else 1f
    Box(Modifier.fillMaxSize().clipToBounds(), contentAlignment = Alignment.Center) {
        playback.slides.forEachIndexed { n, group ->
            val shown = n == playback.index
            val d = playback.relative(n)
            if (abs(d) > MAX_DRAWN_DISTANCE && !shown) return@forEachIndexed
            val look = deckLook(d)
            val side = sideOf(d) * mirror
            Box(
                Modifier
                    .size(cardWidth, cardHeight)
                    .zIndex(10f - min(abs(d), 2f))
                    .graphicsLayer {
                        scaleX = look.scale
                        scaleY = look.scale
                        rotationZ = look.rotation * side
                        translationX = look.shift * cardPx * side
                        transformOrigin = TransformOrigin(0.5f, 1.2f)
                    }
                    .clip(RoundedCornerShape(view.radius.dp))
                    .then(if (shown) shownSlideModifier(playback, n, group, view) else neighbourModifier(playback, n)),
            ) {
                SlideContent(group, view, showTitle = shown)
            }
        }
    }
}
