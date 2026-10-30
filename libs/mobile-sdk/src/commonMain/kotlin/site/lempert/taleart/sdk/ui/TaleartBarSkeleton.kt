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
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.background
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
    val colors = SkeletonColors(base = palette.ink.copy(alpha = 0.08f), highlight = palette.ink.copy(alpha = 0.16f), pill = palette.ink.copy(alpha = 0.06f), paper = palette.paper)
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

/** The shimmer's two inks (ink at 8 % and 16 %), the pills' ground (ink at 6 %) and the stack covers' paper border. */
private class SkeletonColors(val base: Color, val highlight: Color, val pill: Color, val paper: Color)

@Composable
private fun SkeletonLayout(settings: BarSettings, colors: SkeletonColors, sweep: Float, root: Modifier) {
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
        BarLayout.Chip -> FlowRow(
            root.padding(4.dp),
            horizontalArrangement = barArrangement(settings),
            verticalArrangement = Arrangement.spacedBy(settings.gap.dp),
        ) {
            val cover = chipCoverDp(settings.size)
            repeat(skeletonCount(BarLayout.Chip)) {
                // The 44 dp pill in the 48 dp touch target the chip has.
                Box(Modifier.sizeIn(minHeight = 48.dp), contentAlignment = Alignment.Center) {
                    Row(
                        Modifier
                            .sizeIn(minHeight = CHIP_PILL_DP.dp)
                            .clip(RoundedCornerShape(50))
                            .background(colors.pill)
                            .padding(start = 4.dp, end = 14.dp, top = 4.dp, bottom = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Box(Modifier.size(cover.dp).clip(CircleShape).skeleton(sweep, colors))
                        if (settings.showTitles) TitleLine(sweep, colors, width = 72)
                    }
                }
            }
        }
        BarLayout.Poster -> Row(
            root.horizontalScroll(rememberScrollState()).padding(horizontal = 4.dp, vertical = POSTER_ROW_PAD_DP.dp),
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
            Row(root.padding(4.dp)) {
                repeat(skeletonCount(BarLayout.Stack)) {
                    Row(
                        Modifier
                            .clip(RoundedCornerShape(STACK_RADIUS_DP.dp))
                            .background(colors.pill)
                            .sizeIn(minHeight = STACK_MIN_DP.dp)
                            .padding(start = STACK_PAD_START_DP.dp, end = STACK_PAD_END_DP.dp, top = 10.dp, bottom = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(STACK_GAP_DP.dp),
                    ) {
                        val covers = STACK_VISIBLE_COVERS
                        Box(Modifier.width((stackEdge + (covers - 1) * step).dp).height(stackEdge.dp)) {
                            for (index in 0 until covers) {
                                Box(
                                    Modifier
                                        .align(Alignment.CenterStart)
                                        .padding(start = (index * step).dp)
                                        .size(stackEdge.dp)
                                        .clip(CircleShape)
                                        .background(colors.paper)
                                        .padding(STACK_BORDER_DP.dp)
                                        .clip(CircleShape)
                                        .skeleton(sweep, colors),
                                )
                            }
                        }
                        Box(Modifier.height(18.dp), contentAlignment = Alignment.CenterStart) { TitleLine(sweep, colors, width = 72) }
                    }
                }
            }
        }
    }
}

// A title's placeholder: a square-ended line, 44 dp wide (or [width]) and 8 dp high, in the title's 16 dp line.
@Composable
private fun TitleLine(sweep: Float, colors: SkeletonColors, width: Int = 44) {
    Box(Modifier.height(16.dp), contentAlignment = Alignment.Center) {
        Box(Modifier.width(width.dp).height(8.dp).skeleton(sweep, colors))
    }
}

// A placeholder filled with the base ink and a lighter band sweeping across it (the Web SDK's 200 % wide gradient).
private fun Modifier.skeleton(sweep: Float, colors: SkeletonColors): Modifier = this.drawBehind { sweepBand(sweep, colors) }

private fun DrawScope.sweepBand(sweep: Float, colors: SkeletonColors) {
    val w = size.width
    val x = -w + 2f * w * sweep
    drawRect(
        Brush.linearGradient(
            colors = listOf(colors.base, colors.highlight, colors.base),
            start = Offset(x, 0f),
            end = Offset(x + w, 0f),
        ),
    )
}
