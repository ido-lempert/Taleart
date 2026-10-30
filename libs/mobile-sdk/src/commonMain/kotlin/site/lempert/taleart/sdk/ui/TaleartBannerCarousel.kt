package site.lempert.taleart.sdk.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraintsScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.unit.IntOffset
import kotlin.math.roundToInt

/**
 * The carousel's track: the slides one viewport width apart, sliding as the playback moves. Every slide
 * the track passes on its way to the shown one is drawn, so none pops in mid-slide; the rest wait.
 */
@Composable
internal fun BoxWithConstraintsScope.CarouselTrack(playback: BannerPlayback, view: BannerViewContext) {
    val width = constraints.maxWidth.toFloat()
    Box(Modifier.fillMaxSize().clipToBounds()) {
        val index = playback.index
        val at = playback.position()
        val near = setOfNotNull(index, playback.stepTo(1), playback.stepTo(-1))
        val from = minOf(at, index.toFloat()) - 1f
        val to = maxOf(at, index.toFloat()) + 1f
        playback.slides.forEachIndexed { n, group ->
            val shown = n == index
            val drawn = n.toFloat() in from..to || n in near
            // Placed in layout, so the slide moves every frame without recomposing.
            Box(
                Modifier
                    .fillMaxSize()
                    .offset { IntOffset(((n - playback.position()) * width).roundToInt(), 0) }
                    .then(if (shown) shownSlideModifier(playback, n, group, view) else Modifier.clearAndSetSemantics {}),
            ) {
                if (drawn) SlideContent(group, view, showTitle = true)
            }
        }
    }
}
