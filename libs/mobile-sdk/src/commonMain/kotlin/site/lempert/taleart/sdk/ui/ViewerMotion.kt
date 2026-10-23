package site.lempert.taleart.sdk.ui

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animate
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.GraphicsLayerScope
import androidx.compose.ui.graphics.TransformOrigin
import kotlin.math.abs
import kotlin.math.sign

/** How long the viewer takes to open (`VIEWER_OPEN_MS`). */
const val VIEWER_OPEN_MS = 280

/** How long the viewer takes to close (`VIEWER_CLOSE_MS`). */
const val VIEWER_CLOSE_MS = 220

/** How long a group change the person did not drag (a tap past a group's end, the timer) turns the cube. */
const val GROUP_TURN_MS = 380

/** How far a page facing away is turned at most, in degrees: a cube's face. */
internal const val CUBE_DEGREES = 90f

/** A swipe past the first or last group moves the page this share of the finger's travel. */
internal const val EDGE_RESISTANCE = 0.25f

/** Open and close: a quick ease out, as the platforms' own sheets. */
internal val VIEWER_EASING = CubicBezierEasing(0.2f, 0f, 0f, 1f)

/** The spring a released cube settles on: no bounce, quick (`Spring.StiffnessMediumLow`). */
internal fun <T> cubeSpring() = spring<T>(dampingRatio = Spring.DampingRatioNoBouncy, stiffness = Spring.StiffnessMediumLow)

/**
 * A static page beside the live one: the first tale of group [groupIndex], drawn without playing,
 * at [side] (+1 to the right of the live page, -1 to its left) during a group transition.
 */
internal data class NeighborPage(val groupIndex: Int, val view: TaleView, val side: Int)

/**
 * The viewer's group transition (story 9.9): the live page's offset as a share of the stage's width
 * ([offset], 0 when it is in place, negative to the left) and the static page turning in or out
 * beside it ([neighbor]); each page is a cube's face ([cubeFace]). A drag sideways moves the live
 * page with the finger, the group it leads to turning in beside it ([drag]); on release the cube
 * settles on a spring to the new group ([commitTarget]) or back. A group change the person did not
 * drag (a tap past a group's end, the timer, a key) turns the cube by itself ([groupChanged]).
 * Under reduced motion nothing moves: groups change at once and nothing follows the finger.
 *
 * [dir] is 1 left to right, -1 right to left, where the next group lies to the left.
 */
internal class ViewerMotion(private val state: TaleViewerState) {
    /** The live page's offset, a share of the stage's width. */
    var offset by mutableFloatStateOf(0f)

    /** The static page beside the live one, during a transition. */
    var neighbor by mutableStateOf<NeighborPage?>(null)

    /** True while the person drags sideways. */
    var dragging by mutableStateOf(false)
        private set

    /** Bumped for each change that wants [offset] animated to its rest: the composable runs it. */
    var settles by mutableStateOf(0)
        private set

    // The group change the motion itself makes (a committed drag): already in place, not turned again.
    private var committing = false

    /** Where a released drag is settling: its target offset and the group it shows there (null: back). */
    private var pending: Pair<Float, Int?>? = null

    /** Screen side (+1 right, -1 left) of the group [step] groups on (1 next, -1 previous). */
    fun sideOf(step: Int, dir: Int): Int = step * dir

    /**
     * The finger moved [fraction] of the stage's width sideways (negative to the left). The page
     * follows it; the group on that side turns in beside it, or, past the first or last group, the
     * page moves only [EDGE_RESISTANCE] of the way. Nothing moves under reduced motion.
     */
    fun drag(fraction: Float, dir: Int) {
        if (state.reducedMotion || !state.isOpen) return
        dragging = true
        if (fraction == 0f) {
            offset = 0f
            neighbor = null
            return
        }
        // Moving the page left reveals the right side, whose group is `dir` steps on.
        val revealed = if (fraction < 0) 1 else -1
        val step = revealed * dir
        val target = state.groupIndex + step
        if (target in state.groups.indices) {
            if (neighbor?.groupIndex != target) {
                neighbor = NeighborPage(target, TaleView.read(state.groups[target].tales.first(), 0), revealed)
            }
            offset = fraction.coerceIn(-1f, 1f)
        } else {
            neighbor = null
            offset = fraction * EDGE_RESISTANCE
        }
    }

    /**
     * Where the live page settles when the drag ends: off its side (-1 or 1) when [commit] and a
     * group lies there (the neighbor is then the page in place), else back at 0.
     */
    fun commitTarget(commit: Boolean): Float {
        dragging = false
        val n = neighbor
        val target = if (commit && n != null) -n.side.toFloat() else 0f
        pending = target to n?.groupIndex?.takeIf { target != 0f }
        return target
    }

    /**
     * The drag settled ([commitTarget]): a full turn shows the group it was released toward, which
     * becomes the live page in place, when that group is still the one beside the group on screen;
     * else the neighbor leaves. Nothing when no settle is pending.
     */
    fun settled() {
        val (_, group) = pending ?: return
        pending = null
        if (group != null) {
            committing = true
            try {
                when (group) {
                    state.groupIndex + 1 -> state.nextGroup()
                    state.groupIndex - 1 -> state.previousGroup()
                }
            } finally {
                committing = false
            }
        }
        offset = 0f
        neighbor = null
    }

    /** A new touch while a released drag still settles: it lands where it was going at once. */
    fun finishSettle() = settled()

    /**
     * The group on screen changed from [from] (showing [fromView]) to [to] without a drag: the new
     * group turns in from its side, the old one turning out, unless under reduced motion.
     */
    fun groupChanged(from: Int, fromView: TaleView, to: Int, dir: Int) {
        if (committing || dragging) return
        if (state.reducedMotion) {
            offset = 0f
            neighbor = null
            return
        }
        val side = sideOf((to - from).sign, dir)
        neighbor = NeighborPage(from, fromView, -side)
        offset = side.toFloat()
        settles++
    }

    /** Animates [offset] to 0 (a turn by itself), then drops the neighbor. */
    suspend fun settleTurn() {
        if (offset != 0f) {
            animate(offset, 0f, animationSpec = tween(GROUP_TURN_MS, easing = VIEWER_EASING)) { value, _ -> offset = value }
        }
        offset = 0f
        neighbor = null
    }

    /**
     * Animates the released drag to [target] on a spring, starting at [velocity] (widths a second),
     * then [settled]. The tale waits meanwhile ([TaleViewerState.turning]): it does not end under a
     * turning cube. Cancelled (a new touch), it lands at once ([finishSettle]).
     */
    suspend fun settleDrag(target: Float, velocity: Float) {
        state.turning = true
        try {
            animate(offset, target, initialVelocity = velocity, animationSpec = cubeSpring()) { value, _ -> offset = value }
        } finally {
            settled()
            state.turning = false
        }
    }

    /** Drops any transition at once: reduced motion turned on, or the viewer closed. */
    fun stop() {
        dragging = false
        pending = null
        offset = 0f
        neighbor = null
        state.turning = false
    }
}

/**
 * Draws a page as a cube's face at [position] (its offset, a share of the width): moved sideways and
 * turned about the edge it shares with the face beside it, up to [CUBE_DEGREES], and hidden once it
 * faces fully away. Read in the layer, so a moving cube redraws without recomposing.
 */
internal fun GraphicsLayerScope.cubeFace(position: Float) {
    if (position == 0f) return
    if (abs(position) >= 1f) {
        alpha = 0f
        return
    }
    translationX = position * size.width
    // The face to the right turns about its left edge, away from the viewer; the left one about its right edge.
    transformOrigin = TransformOrigin(if (position > 0) 0f else 1f, 0.5f)
    rotationY = position * CUBE_DEGREES
    cameraDistance = 12f * density
}
