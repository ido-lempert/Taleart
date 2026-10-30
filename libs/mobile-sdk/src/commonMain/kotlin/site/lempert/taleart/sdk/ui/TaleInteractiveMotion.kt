package site.lempert.taleart.sdk.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.AnimationSpec
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.geometry.Size
import androidx.compose.foundation.layout.Box

// The motion of the interactive components (handoff 2.2): the results fill with a spring, a selection pops,
// a wrong quiz answer shakes, a rating's thumb grows, a reaction rises and fades, a countdown digit flips, a
// promo ticket shines and a swipe-up arrow bobs. Every one stops under reduced motion (the person's setting,
// or [LocalTaleReducedMotion] in a test): it snaps, or it is not drawn at all.

/** Overrides the platform's reduce-motion setting for the components inside (tests); null follows the platform. */
internal val LocalTaleReducedMotion = compositionLocalOf<Boolean?> { null }

/** Whether the person asked for less motion: the override in [LocalTaleReducedMotion], else the platform's setting. */
@Composable
internal fun rememberTaleReducedMotion(): Boolean {
    val platform = rememberPrefersReducedMotion()
    return LocalTaleReducedMotion.current ?: platform
}

/** A fill that moves to [target] (0 to 1) on the results' spring; it snaps under reduced motion. */
@Composable
internal fun rememberFill(target: Float, reduced: Boolean): Float {
    val spec: AnimationSpec<Float> = if (reduced) snap() else spring(dampingRatio = Spring.DampingRatioLowBouncy, stiffness = Spring.StiffnessLow)
    return animateFloatAsState(target, animationSpec = spec, label = "fill").value
}

/**
 * The selection pop (`pop`): a choice that becomes selected grows to 1.06 and settles back. The choice a
 * visitor already selected when it first appears does not pop; nothing moves under reduced motion.
 */
@Composable
internal fun rememberPop(selected: Boolean, reduced: Boolean): Float {
    val scale = remember { Animatable(1f) }
    var first by remember { mutableStateOf(true) }
    LaunchedEffect(selected, reduced) {
        if (selected && !first && !reduced) {
            scale.animateTo(1.06f, tween(200, easing = FastOutSlowInEasing))
            scale.animateTo(1f, spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessMedium))
        } else {
            scale.snapTo(1f)
        }
        first = false
    }
    return scale.value
}

/** The horizontal offset in dp of a wrong answer's shake (`shake`, 450 ms); 0 at rest, nothing under reduced motion. */
@Composable
internal fun rememberShake(active: Boolean, reduced: Boolean): Float {
    val x = remember { Animatable(0f) }
    var first by remember { mutableStateOf(true) }
    LaunchedEffect(active, reduced) {
        if (active && !first && !reduced) {
            x.snapTo(0f)
            for (step in SHAKE_STEPS) x.animateTo(step, tween(90, easing = LinearEasing))
        } else {
            x.snapTo(0f)
        }
        first = false
    }
    return x.value
}

private val SHAKE_STEPS = listOf(-7f, 6f, -4f, 3f, 0f)

/**
 * A countdown digit that flips when its text changes (`tickA`, 450 ms): it tilts in from the top. The digits
 * stay as they are under reduced motion; the flip never runs on the first composition.
 */
@Composable
internal fun FlipDigit(text: String, reduced: Boolean, modifier: Modifier, content: @Composable () -> Unit) {
    val flip = remember { Animatable(1f) }
    var first by remember { mutableStateOf(true) }
    LaunchedEffect(text, reduced) {
        if (!first && !reduced) {
            flip.snapTo(0f)
            flip.animateTo(1f, tween(450, easing = FastOutSlowInEasing))
        } else {
            flip.snapTo(1f)
        }
        first = false
    }
    val p = flip.value
    Box(
        modifier.graphicsLayer {
            rotationX = (1f - p) * 70f
            alpha = 0.3f + 0.7f * p
            cameraDistance = 12f * density
        },
    ) { content() }
}

/**
 * A reaction's emoji rising from its button and fading (`fly`, 1.1 s): [content] draws it at each progress from
 * 0 to 1; it restarts when [restart] changes and is not drawn once it has ended or under reduced motion.
 */
@Composable
internal fun RisingEmoji(restart: Int, reduced: Boolean, content: @Composable (progress: Float) -> Unit) {
    if (reduced) return
    val p = remember(restart) { Animatable(0f) }
    LaunchedEffect(restart) { p.animateTo(1f, tween(1_100, easing = FastOutSlowInEasing)) }
    val v = p.value
    if (v >= 1f) return
    content(v)
}

/** The fraction of the rising emoji's travel at [progress] (0 to 1), faded in then out (`fly`'s opacity). */
internal fun risingAlpha(progress: Float): Float = when {
    progress < 0.15f -> progress / 0.15f
    else -> ((1f - progress) / 0.85f).coerceIn(0f, 1f)
}

/**
 * A promo ticket's shine (`shine`): a soft highlight that sweeps across it every 2.8 seconds. The sweep is
 * not run under reduced motion, so nothing moves.
 */
@Composable
internal fun Modifier.ticketShine(reduced: Boolean): Modifier {
    val sweep = remember { Animatable(0f) }
    LaunchedEffect(reduced) {
        if (reduced) {
            sweep.snapTo(0f)
        } else {
            while (true) {
                sweep.snapTo(0f)
                sweep.animateTo(1f, tween(2_800, easing = LinearEasing))
            }
        }
    }
    if (reduced) return this
    return this.drawWithContent {
        drawContent()
        val width = size.width
        val band = width * 0.4f
        // The highlight starts just left of the ticket and ends just right of it: `left: -60%` to `130%`.
        val x = -band * 1.5f + sweep.value * (width + band * 2.5f)
        drawRect(
            brush = Brush.linearGradient(
                colors = listOf(Color.Transparent, Color.White.copy(alpha = 0.35f), Color.Transparent),
                start = Offset(x, 0f),
                end = Offset(x + band, size.height),
            ),
            size = Size(width, size.height),
        )
    }
}

/** A swipe-up arrow's bob in dp (`bob`: 6 dp up and back, 1.4 s a cycle); 0, and no motion, under reduced motion. */
@Composable
internal fun rememberBob(reduced: Boolean): Float {
    val y = remember { Animatable(0f) }
    LaunchedEffect(reduced) {
        if (reduced) {
            y.snapTo(0f)
        } else {
            while (true) {
                y.animateTo(-6f, tween(700, easing = FastOutSlowInEasing))
                y.animateTo(0f, tween(700, easing = FastOutSlowInEasing))
            }
        }
    }
    return y.value
}
