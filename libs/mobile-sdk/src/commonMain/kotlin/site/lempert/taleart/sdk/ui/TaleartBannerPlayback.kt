package site.lempert.taleart.sdk.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.onFocusChanged
import kotlinx.coroutines.delay
import site.lempert.taleart.sdk.delivery.DeliveryTaleGroup

// The slide's move: CSS `ease`, over 350 ms.
private const val SLIDE_MS = 350
private val EASE = CubicBezierEasing(0.25f, 0.1f, 0.25f, 1f)

/**
 * What a banner's slides share, whatever their variant: the shown slide, the track's position while a
 * slide moves, whether autoplay runs and the person's interaction that stops it. [loop], [autoplay] and
 * [reducedMotion] are set from the settings each composition ([rememberBannerPlayback]).
 */
@Stable
internal class BannerPlayback(val slides: List<DeliveryTaleGroup>) {
    val count: Int get() = slides.size
    var loop = true
    var autoplay = true
    var reducedMotion = false

    /** The shown slide's index. */
    var index by mutableIntStateOf(0)

    /** Set by the person's interaction or by reaching the last slide without loop; only the rotation button clears it. */
    var stopped by mutableStateOf(false)

    /** The track's position: the shown index, moved to over [SLIDE_MS] (at once under reduced motion). */
    val track = Animatable(0f)

    /** One requester per slide; the shown one is focusable (see [rememberBannerPlayback]). */
    val focusers: List<FocusRequester> = List(count) { FocusRequester() }

    /** True while the SDK moves focus itself, which is not the person's interaction. */
    val programmaticFocus = BooleanArray(1)

    /** The groups whose first showing was already reported (once per group). */
    val impressed = mutableSetOf<String>()

    val atEnd: Boolean get() = !loop && index == count - 1
    val canRotate: Boolean get() = autoplay && count > 1
    val rotating: Boolean get() = canRotate && !stopped && !reducedMotion && !atEnd

    /** The track's position, for the slides' layout: the shown index under reduced motion. */
    fun position(): Float = if (reducedMotion) index.toFloat() else track.value

    /** A slide's place relative to the track (see [bannerRelative]). */
    fun relative(n: Int): Float = bannerRelative(n, position(), count, loop)

    /** The index [delta] slides away, or null past an end without loop. */
    fun stepTo(delta: Int): Int? {
        val target = index + delta
        if (target in 0 until count) return target
        return if (loop) (target + count) % count else null
    }

    fun step(delta: Int) {
        stepTo(delta)?.let { index = it }
    }

    fun select(n: Int) {
        index = n
    }

    /** The person took the banner: autoplay stops until the rotation button starts it again. */
    fun interact() {
        stopped = true
    }

    /** Focus on a slide stops autoplay, unless the SDK moved it. */
    val stopsOnFocus: Modifier = Modifier.onFocusChanged { if (it.isFocused && !programmaticFocus[0]) stopped = true }
}

/**
 * The playback of [slides] under [settings] ([loop] given by the variant, as the sticky banner always
 * loops): the track, the timer for autoplay, the impression of each slide shown the first time, and a
 * [show] request (a viewer closed on a group) that moves to and focuses its slide, then is consumed
 * through [onShowDone].
 */
@Composable
internal fun rememberBannerPlayback(
    slides: List<DeliveryTaleGroup>,
    settings: BannerSettings,
    reducedMotion: Boolean,
    loop: Boolean,
    show: BannerShowRequest?,
    onShowDone: (BannerShowRequest) -> Unit,
): BannerPlayback {
    val playback = remember(slides) { BannerPlayback(slides) }
    playback.loop = loop
    playback.autoplay = settings.autoplay
    playback.reducedMotion = reducedMotion
    // Requests made before this banner existed are not its own (see BannerShowRequest).
    val madeAfter = remember { BannerShowRequest.made }
    val showDone by rememberUpdatedState(onShowDone)
    val impressContext = LocalTaleartContext.current

    // The shown slide is an impression once per group, the first time it is shown.
    LaunchedEffect(playback.index, slides) {
        val group = slides.getOrNull(playback.index) ?: return@LaunchedEffect
        if (playback.impressed.add(group.id)) impressContext.impression(groupRef(slides, group))
    }
    LaunchedEffect(playback.index, reducedMotion) {
        if (reducedMotion) playback.track.snapTo(playback.index.toFloat())
        else playback.track.animateTo(playback.index.toFloat(), tween(SLIDE_MS, easing = EASE))
    }

    // The timer for the next slide, restarted by every change of slide or rotation state.
    val rotating = playback.rotating
    LaunchedEffect(rotating, playback.index, settings.intervalSeconds) {
        if (!rotating) return@LaunchedEffect
        delay(settings.intervalSeconds * 1000L)
        playback.step(1)
        // Reaching the last slide without loop stops autoplay.
        if (!playback.loop && playback.index == playback.count - 1) playback.stopped = true
    }

    LaunchedEffect(show) {
        val request = show ?: return@LaunchedEffect
        val i = slides.indexOfFirst { it.id == request.groupId }
        // Consumed whether honoured or not, so no later banner takes it up.
        if (request.serial <= madeAfter || i < 0) {
            showDone(request)
            return@LaunchedEffect
        }
        playback.select(i)
        try {
            // The slide becomes focusable once it is the shown one: wait for that frame, then focus it.
            withFrameNanos { }
            playback.programmaticFocus[0] = true
            try {
                runCatching { playback.focusers[i].requestFocus() }
            } finally {
                playback.programmaticFocus[0] = false
            }
        } finally {
            showDone(request)
        }
    }
    return playback
}
