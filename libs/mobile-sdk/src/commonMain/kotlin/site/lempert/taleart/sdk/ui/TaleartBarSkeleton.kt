package site.lempert.taleart.sdk.ui

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.dp
import site.lempert.taleart.sdk.i18n.Translate

/** One sweep of the shimmer, in milliseconds. */
private const val SHIMMER_MS = 1400

/**
 * The loading skeleton of a bar: placeholders in the footprint of [settings]' layout, so the bar that replaces
 * it does not move the page. It is announced as busy (`bar.loading`, an indeterminate progress). The shimmer
 * sweeps across the placeholders; under reduced motion they stand still.
 */
@Composable
internal fun BarSkeleton(
    settings: BarSettings,
    titleStyle: TextStyle,
    translate: Translate,
    reducedMotion: Boolean,
    modifier: Modifier = Modifier,
) {
    val palette = TaleartTheme.DEFAULT.colors(titleStyle.color, rememberPrefersDarkScheme())
    val loading = translate("bar.loading")
    val colors = SkeletonColors(base = palette.title.copy(alpha = 0.10f), highlight = palette.title.copy(alpha = 0.22f))
    val root = modifier
        .fillMaxWidth()
        .testTag(BAR_SKELETON_TAG)
        .semantics {
            contentDescription = loading
            progressBarRangeInfo = ProgressBarRangeInfo.Indeterminate
        }
    if (reducedMotion) {
        SkeletonLayout(settings, colors, 0f, root)
    } else {
        AnimatedSkeleton(settings, colors, root)
    }
}

@Composable
private fun AnimatedSkeleton(settings: BarSettings, colors: SkeletonColors, root: Modifier) {
    val transition = rememberInfiniteTransition(label = "barSkeleton")
    val sweep by transition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(SHIMMER_MS, easing = LinearEasing)),
        label = "barSkeletonSweep",
    )
    SkeletonLayout(settings, colors, sweep, root)
}

private class SkeletonColors(val base: Color, val highlight: Color)

@Composable
private fun SkeletonLayout(settings: BarSettings, colors: SkeletonColors, sweep: Float, root: Modifier) {
    val gap = settings.gap.dp
    val edge = settings.size.edgeDp
    val shape: Shape = if (settings.shape == BarShape.Circle) CircleShape else RoundedCornerShape(maxOf(0, edge / 4).dp)
    when (settings.layout) {
        BarLayout.Ring -> Row(
            root.padding(4.dp).horizontalScroll(rememberScrollState()),
            horizontalArrangement = barArrangement(settings),
        ) {
            repeat(skeletonCount(BarLayout.Ring)) {
                Column(
                    Modifier.width((edge + 12).dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Box(Modifier.size(edge.dp).clip(shape).skeleton(sweep, colors))
                    if (settings.showTitles) TitleLine(sweep, colors)
                }
            }
        }
        BarLayout.Chip -> Row(
            root.padding(4.dp).horizontalScroll(rememberScrollState()),
            horizontalArrangement = barArrangement(settings),
        ) {
            val cover = chipCoverDp(settings.size)
            repeat(skeletonCount(BarLayout.Chip)) {
                Row(
                    Modifier
                        .sizeIn(minHeight = 48.dp)
                        .width(110.dp)
                        .clip(RoundedCornerShape(50))
                        .skeleton(sweep, colors)
                        .padding(start = 4.dp, end = 14.dp, top = 4.dp, bottom = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Box(Modifier.size(cover.dp).clip(CircleShape).skeletonInside(sweep, colors))
                    if (settings.showTitles) TitleLine(sweep, colors)
                }
            }
        }
        BarLayout.Poster -> Row(
            root.padding(4.dp).horizontalScroll(rememberScrollState()),
            horizontalArrangement = barArrangement(settings),
        ) {
            repeat(skeletonCount(BarLayout.Poster)) {
                Box(
                    Modifier
                        .size(POSTER_WIDTH_DP.dp, POSTER_HEIGHT_DP.dp)
                        .clip(RoundedCornerShape(POSTER_RADIUS_DP.dp))
                        .skeleton(sweep, colors),
                )
            }
        }
        BarLayout.Stack -> {
            val stackEdge = stackCoverDp(settings.size)
            val step = stackEdge - STACK_OVERLAP_DP
            Column(
                root.padding(4.dp).sizeIn(minHeight = 48.dp),
                horizontalAlignment = Alignment.Start,
                verticalArrangement = Arrangement.spacedBy(STACK_CAPTION_GAP_DP.dp),
            ) {
                val count = skeletonCount(BarLayout.Stack)
                Box(Modifier.width((stackEdge + (count - 1) * step).dp).height(stackEdge.dp)) {
                    for (index in 0 until count) {
                        Box(
                            Modifier
                                .align(Alignment.CenterStart)
                                .padding(start = (index * step).dp)
                                .size(stackEdge.dp)
                                .clip(CircleShape)
                                .skeleton(sweep, colors),
                        )
                    }
                }
                Box(Modifier.height(18.dp), contentAlignment = Alignment.CenterStart) { TitleLine(sweep, colors, width = 96) }
            }
        }
    }
}

// A title's placeholder: a short bar in the title's 16dp line.
@Composable
private fun TitleLine(sweep: Float, colors: SkeletonColors, width: Int = 56) {
    Box(Modifier.height(16.dp), contentAlignment = Alignment.Center) {
        Box(Modifier.width(width.dp).height(10.dp).clip(RoundedCornerShape(50)).skeletonInside(sweep, colors))
    }
}

// A placeholder filled with the base colour and a lighter band sweeping across it.
private fun Modifier.skeleton(sweep: Float, colors: SkeletonColors): Modifier = this.drawBehind { sweepBand(sweep, colors) }

// The same, for a placeholder inside another one (its shape is clipped by the parent's clip).
private fun Modifier.skeletonInside(sweep: Float, colors: SkeletonColors): Modifier = this.drawBehind { sweepBand(sweep, colors) }

private fun DrawScope.sweepBand(sweep: Float, colors: SkeletonColors) {
    drawRect(colors.base)
    val w = size.width
    val x = -w + 2f * w * sweep
    drawRect(
        Brush.linearGradient(
            colors = listOf(Color.Transparent, colors.highlight, Color.Transparent),
            start = Offset(x, 0f),
            end = Offset(x + w, 0f),
        ),
    )
}
