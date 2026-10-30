package site.lempert.taleart.sdk.ui

import site.lempert.taleart.sdk.storage.deviceKeyValueStoreOrNull
import site.lempert.taleart.sdk.recordFrequencyView
import site.lempert.taleart.sdk.analytics.AnalyticsEventType
import androidx.compose.foundation.Canvas
import androidx.compose.animation.core.animate
import androidx.compose.animation.core.tween
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.MutableFloatState
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.input.pointer.util.VelocityTracker
import androidx.compose.ui.semantics.clearAndSetSemantics
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameMillis
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.isAltPressed
import androidx.compose.ui.input.key.isCtrlPressed
import androidx.compose.ui.input.key.isMetaPressed
import androidx.compose.ui.input.key.isShiftPressed
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsPropertyKey
import androidx.compose.ui.semantics.SemanticsPropertyReceiver
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.isTraversalGroup
import androidx.compose.ui.semantics.traversalIndex
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import coil3.ImageLoader
import coil3.compose.AsyncImage
import kotlin.math.abs
import site.lempert.taleart.sdk.ComponentRef
import site.lempert.taleart.sdk.delivery.DeliveryTaleGroup
import site.lempert.taleart.sdk.deliver
import site.lempert.taleart.sdk.deliver
import site.lempert.taleart.sdk.deliverAction

/** Test tag of the viewer. */
const val VIEWER_TAG = "taleart-viewer"

/** Test tag of each progress segment. */
const val VIEWER_SEGMENT_TAG = "taleart-viewer-segment"

/** Test tag of the stage, where taps, holds and swipes land. */
const val VIEWER_STAGE_TAG = "taleart-viewer-stage"

/**
 * How far the top bar reaches below the safe area, where the canvas starts: 8 dp padding, the 3 dp
 * progress, 8 dp, the 44 dp controls and 8 dp padding, rounded up.
 */
internal val VIEWER_TOP_BAR_HEIGHT = 72.dp

/** Test tag of the current tale's 9:16 canvas. */
const val VIEWER_CANVAS_TAG = "taleart-viewer-canvas"

/** Test tag of the still page of the group turning in or out beside the live one (story 9.9). */
const val VIEWER_NEIGHBOR_TAG = "taleart-viewer-neighbor"

/** Test tag of the current tale's page. */
const val VIEWER_PAGE_TAG = "taleart-viewer-page"

/** How far a progress segment is filled, 0 to 1; screen readers never read it (the live region says where the viewer is). */
val SegmentFill = SemanticsPropertyKey<Float>("TaleartSegmentFill")
private var SemanticsPropertyReceiver.segmentFill by SegmentFill

/** How far the viewer has opened, 0 (hidden) to 1 (shown), as it opens and closes; for tests only. */
val ViewerPresence = SemanticsPropertyKey<Float>("TaleartViewerPresence")
private var SemanticsPropertyReceiver.viewerPresence by ViewerPresence

/** The tale a page shows, as `groupId/index`; for tests only. */
val ViewerTale = SemanticsPropertyKey<String>("TaleartViewerTale")
private var SemanticsPropertyReceiver.viewerTale by ViewerTale

/** Travel that makes a press a swipe: sideways between groups, down to close (`SWIPE_MIN_PX` in the Web SDK). */
const val SWIPE_MIN_DP = 50

/**
 * A swipe up opens the tale's swipe-up link (R7) when it is a flick: released within
 * [SWIPE_UP_MAX_MS], travelling at least [SWIPE_UP_MIN_DP] or [SWIPE_UP_MIN_SHARE] of the stage's
 * height, and more up than sideways (`SWIPE_UP_MAX_MS`, `SWIPE_UP_MIN_PX`, `SWIPE_UP_MIN_SHARE`).
 */
const val SWIPE_UP_MAX_MS = 500L
const val SWIPE_UP_MIN_DP = SWIPE_MIN_DP
const val SWIPE_UP_MIN_SHARE = 0.08f

/**
 * The most one frame moves the tale's timer on: a safety net only. The tale waits while the app is
 * in the background (its lifecycle stops the timer); should frames still stop for long without a
 * lifecycle event (a window hidden some other way), the first frame after does not count the whole
 * time away as play and skip the tale.
 */
internal const val MAX_FRAME_STEP_MS = 1_000L

/** A press at least this long is a hold (pause), not a tap (step) (`HOLD_MIN_MS`). */
const val HOLD_MIN_MS = 250L

// The viewer's fixed look (VIEWER_BASE_STYLES in the Web SDK).
private val TRACK = InkDark.copy(alpha = 0.4f)
private val CONTROL_BACKGROUND = CardDark.copy(alpha = 0.6f)
private val NAME_BACKGROUND = CardDark.copy(alpha = 0.8f)
private val TOP_SHADE = Brush.verticalGradient(listOf(CardDark.copy(alpha = 0.7f), Color.Transparent))

private object Icons {
    const val PAUSE = "M6 5h4v14H6zM14 5h4v14h-4z"
    const val PLAY = "M7 4.5v15L19.5 12z"
    const val CLOSE = "M18.3 7.1 16.9 5.7 12 10.6 7.1 5.7 5.7 7.1l4.9 4.9-4.9 4.9 1.4 1.4 4.9-4.9 4.9 4.9 1.4-1.4-4.9-4.9z"
}

/**
 * The full-screen tale viewer, as `TaleViewer` in libs/web-sdk/src/lib/viewer.ts: it opens group
 * [startGroupId] of [groups] at its first tale and plays the groups in order, skipping those
 * without tales, with one progress segment per tale of the group.
 *
 * A tale shows for its document's `durationMs` (7 s by default; 5 s for a tale sent without a
 * document), or a video tale for its video's own length, its segment following the video's position.
 * A tap on the stage's right two thirds shows the next tale and on its left third the previous one
 * (mirrored right to left); after a group's last tale comes the next group, and after the last
 * group's the viewer closes. A press of [HOLD_MIN_MS] or more pauses while held, a swipe sideways
 * changes group, a swipe down closes, as do the Close button and Android's Back. The tale waits
 * while the app is in the background. When the person prefers reduced motion nothing plays or
 * advances by itself: each tale starts paused, a video plays from the Play button, and the person
 * steps. The viewer follows the setting live while open ([reducedMotion] follows the platform's).
 *
 * The viewer moves (story 9.9): it opens growing and fading in, and closes fading out (following a
 * swipe down); a swipe sideways turns a cube to the next or previous group, the page following the
 * finger and settling on a spring; a group change by a tap or the timer turns the cube by itself;
 * tales of a group switch at once, as the Web SDK on a phone. Under reduced motion none of it moves.
 *
 * Each group shown is marked seen in [seenGroups] and passed to [onGroupShown]; [onClose] is called
 * once with the group shown last, when the viewer has finished closing. [theme]'s accent colours the
 * progress and the controls.
 */
@Composable
fun TaleartViewer(
    groups: List<DeliveryTaleGroup>,
    startGroupId: String,
    onClose: (groupId: String) -> Unit,
    modifier: Modifier = Modifier,
    seenGroups: SeenGroups = rememberSeenGroups(),
    theme: TaleartTheme = TaleartTheme.DEFAULT,
    onGroupShown: (groupId: String) -> Unit = {},
    reducedMotion: Boolean = rememberPrefersReducedMotion(),
) {
    val closed by rememberUpdatedState(onClose)
    // The group shown last, kept from the moment the viewer closes until it has faded out.
    val last = remember(groups, startGroupId) { arrayOfNulls<String>(1) }
    val translate = LocalTaleartContext.current.translate
    val state = remember(groups, startGroupId) {
        TaleViewerState(groups, startGroupId, reducedMotion, onClosed = { last[0] = it }, translate = translate)
    }
    ProvideTaleartTheme(theme) {
        ViewerContent(state, modifier, seenGroups, theme, onGroupShown, reducedMotion, onExited = { last[0]?.let { closed(it) } })
    }
}

/**
 * The viewer of a [TaleViewerState] the caller holds (see the other overload). The state keeps the
 * reduced motion it was made with (the caller may set [TaleViewerState.reducedMotion]), unless
 * [followReducedMotion]: it then follows the platform's setting live while the viewer shows. The
 * state's `onClosed` is called as the viewer starts to close; it then fades out, drawing nothing
 * once done.
 */
@Composable
fun TaleartViewer(
    state: TaleViewerState,
    modifier: Modifier = Modifier,
    seenGroups: SeenGroups = rememberSeenGroups(),
    theme: TaleartTheme = TaleartTheme.DEFAULT,
    onGroupShown: (groupId: String) -> Unit = {},
    followReducedMotion: Boolean = false,
) = ProvideTaleartTheme(theme) { ViewerContent(
    state,
    modifier,
    seenGroups,
    theme,
    onGroupShown,
    reducedMotion = if (followReducedMotion) rememberPrefersReducedMotion() else null,
    onExited = {},
) }

/** How long the viewer waits for its window to appear before it opens anyway (iOS). */
internal const val VIEWER_APPEAR_TIMEOUT_MS = 500L

/**
 * The viewer, following [reducedMotion] when not null and calling [onExited] once, when it has
 * finished closing (its fade out done) or leaves the composition after it closed.
 */
@Composable
internal fun ViewerContent(
    state: TaleViewerState,
    modifier: Modifier,
    seenGroups: SeenGroups,
    theme: TaleartTheme,
    onGroupShown: (groupId: String) -> Unit,
    reducedMotion: Boolean?,
    onExited: () -> Unit,
) {
    val shown by rememberUpdatedState(onGroupShown)
    val exitedNow by rememberUpdatedState(onExited)
    val context = LocalTaleartContext.current
    val uri = LocalUriHandler.current
    // A call to action of the tale: the listeners hear it first; the URL opens unless one of them handled it.
    // The groups this opening of the viewer has counted as viewed (see the frequency cap).
    val counted = remember(state) { mutableSetOf<String>() }
    val opener = remember(state, context, uri) {
        LinkOpener { component, url ->
            val tale = state.group.tales.getOrNull(state.taleIndex)
            val event = context.event(
                "actionClicked",
                group = groupRef(state.groups, state.group),
                tale = tale?.let { taleRef(it, state.taleIndex) },
                component = component,
                url = url,
            )
            context.track(AnalyticsEventType.Click, groupRef(state.groups, state.group), tale?.let { taleRef(it, state.taleIndex) })
            if (!deliverAction(context.listener, event)) runCatching { uri.openUri(url) }
        }
    }
    // A component of the tale that did something (a countdown ended, a promo code copied): the listeners hear it.
    // The visitor's answers to the interactive elements of the tale on screen (none without a zone to post to).
    val responder = remember(state, context) {
        context.responses?.let { zone ->
            TaleResponder(zone, context, current = {
                state.group.tales.getOrNull(state.taleIndex)?.let { CurrentTale(groupRef(state.groups, state.group), taleRef(it, state.taleIndex)) }
            })
        }
    }
    val reporter = remember(state, context) {
        ComponentReporter { component, action ->
            val tale = state.group.tales.getOrNull(state.taleIndex)
            val event = context.event(
                "componentEvent",
                group = groupRef(state.groups, state.group),
                tale = tale?.let { taleRef(it, state.taleIndex) },
                component = component,
                action = action,
            )
            deliver(context.listener, event) { it.onComponentEvent(event) }
        }
    }
    // An unknown group, or one without tales: nothing opens (`open` returns false).
    val opened = remember(state) { state.isOpen }
    if (!opened) return
    // The person's setting, followed live: turned on, the tale pauses; turned off, it goes on.
    if (reducedMotion != null) SideEffect { state.reducedMotion = reducedMotion }
    // The host is told once: when the fade out ends, or when the viewer leaves mid-fade.
    val reported = remember(state) { BooleanArray(1) }
    val report = {
        if (!reported[0]) {
            reported[0] = true
            exitedNow()
        }
    }
    DisposableEffect(state) {
        onDispose { if (!state.isOpen) report() }
    }
    val rtl = LocalLayoutDirection.current == LayoutDirection.Rtl
    val dir = if (rtl) -1 else 1
    val motion = remember(state) { ViewerMotion(state) }
    // Open and close: 0 hidden, 1 shown. Under reduced motion it opens shown and closes at once.
    val presence = remember(state) { mutableFloatStateOf(if (state.reducedMotion) 1f else 0f) }
    var exited by remember(state) { mutableStateOf(false) }
    // On iOS the modal's view appears a moment after the viewer composes: it opens then, or after
    // VIEWER_APPEAR_TIMEOUT_MS should UIKit never say so. The tale and its video wait until then.
    var appearTimedOut by remember(state) { mutableStateOf(false) }
    val appeared = LocalViewerAppeared.current.value || appearTimedOut
    LaunchedEffect(state, appeared) {
        if (!appeared) {
            delay(VIEWER_APPEAR_TIMEOUT_MS)
            appearTimedOut = true
        }
    }
    SideEffect { state.notShownYet = !appeared }
    LaunchedEffect(state, state.isOpen, appeared) {
        if (state.isOpen) {
            if (!appeared) return@LaunchedEffect
            if (presence.value < 1f) {
                animate(presence.value, 1f, animationSpec = tween(VIEWER_OPEN_MS, easing = VIEWER_EASING)) { v, _ -> presence.value = v }
            }
        } else {
            motion.stop()
            if (!state.reducedMotion) {
                animate(presence.value, 0f, animationSpec = tween(VIEWER_CLOSE_MS, easing = VIEWER_EASING)) { v, _ -> presence.value = v }
            }
            exited = true
            report()
        }
    }
    // A group change the person did not drag turns the cube; reduced motion stops any turn.
    DisposableEffect(state, motion, dir) {
        state.onGroupChange = { from, view, to -> motion.groupChanged(from, view, to, dir) }
        onDispose { state.onGroupChange = null }
    }
    LaunchedEffect(motion, motion.settles) { motion.settleTurn() }
    LaunchedEffect(motion, state.reducedMotion) { if (state.reducedMotion) motion.stop() }
    if (exited) return
    // The group is viewed (seen) whenever one of its tales shows, and a screen reader says where the viewer is.
    DisposableEffect(state.shows) {
        if (state.isOpen) {
            seenGroups.markSeen(state.group.id)
            // A view is one opening of the viewer on a group: counted once, however many tales it shows.
            if (counted.add(state.group.id)) recordFrequencyView(deviceKeyValueStoreOrNull(), state.group.id)
            shown(state.group.id)
            state.group.tales.getOrNull(state.taleIndex)?.let { tale ->
                val event = context.event("taleShown", group = groupRef(state.groups, state.group), tale = taleRef(tale, state.taleIndex))
                deliver(context.listener, event) { it.onTaleShown(event) }
                context.track(AnalyticsEventType.View, groupRef(state.groups, state.group), taleRef(tale, state.taleIndex))
            }
            announceForAccessibility(state.announcement)
        }
        onDispose { }
    }
    // The tale's timer: frame by frame while it plays, keeping the time left across a pause.
    LaunchedEffect(state.shows, state.timed, state.stopped, state.reducedMotion) {
        if (!state.timed || state.stopped || state.reducedMotion) return@LaunchedEffect
        var last = withFrameMillis { it }
        while (state.isOpen) {
            val now = withFrameMillis { it }
            state.tick((now - last).coerceAtMost(MAX_FRAME_STEP_MS))
            last = now
        }
    }
    // The stall check of a document's own video (R5): frame by frame while it should play; each
    // start (a new tale, run or resume) gives it a fresh VIDEO_STALL_MS, as the web's watchdog.
    // A finger held on the stage only suspends the count (stallTick skips while held); it does not restart it.
    LaunchedEffect(state.shows, state.videoRuns, state.capped, state.paused, state.inBackground, state.notShownYet, state.reducedMotion) {
        if (!state.capped || state.paused || state.inBackground || state.notShownYet || state.reducedMotion) return@LaunchedEffect
        state.restartStallCheck()
        var last = withFrameMillis { it }
        while (state.isOpen) {
            val now = withFrameMillis { it }
            state.stallTick((now - last).coerceAtMost(MAX_FRAME_STEP_MS))
            last = now
        }
    }
    // The tale waits while the app is in the background, and goes on when it comes back.
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lifecycle, state) {
        // An app that is not in the foreground as the viewer opens: the tale waits from the start.
        state.inBackground = !lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_PAUSE, Lifecycle.Event.ON_STOP -> {
                    state.held = false
                    state.inBackground = true
                }
                Lifecycle.Event.ON_RESUME -> state.inBackground = false
                else -> Unit
            }
        }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }

    val accent = parseHexColor(theme.accentColor) ?: InkDark
    val font = rememberFontFamily(theme.fontFamily)
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }

    // How far a swipe down has dragged the tale, in pixels: the backdrop fades as it goes.
    val dragDown = remember(state) { mutableFloatStateOf(0f) }
    Box(
        modifier
            .fillMaxSize()
            .graphicsLayer {
                // Opening grows the viewer from 92 % and fades it in; closing reverses it.
                val p = presence.value
                alpha = p
                scaleX = 0.92f + 0.08f * p
                scaleY = 0.92f + 0.08f * p
            }
            .drawBehind {
                val pulled = (dragDown.value / size.height).coerceIn(0f, 1f)
                drawRect(CardDark.copy(alpha = 1f - 0.6f * pulled))
            }
            .testTag(VIEWER_TAG)
            .semantics {
                paneTitle = state.group.name
                viewerPresence = presence.value
            }
            .focusRequester(focus)
            .focusable()
            .onKeyEvent { event ->
                if (event.type != KeyEventType.KeyDown) return@onKeyEvent false
                // Modified keys stay with the system.
                if (event.isAltPressed || event.isCtrlPressed || event.isMetaPressed || event.isShiftPressed) return@onKeyEvent false
                val (forward, back) = if (rtl) Key.DirectionLeft to Key.DirectionRight else Key.DirectionRight to Key.DirectionLeft
                when (event.key) {
                    forward -> state.next()
                    back -> state.previous()
                    Key.Spacebar -> state.togglePause()
                    Key.Escape -> state.close()
                    else -> return@onKeyEvent false
                }
                true
            },
        contentAlignment = Alignment.Center,
    ) {
        // A native video view does not follow the viewer's layers: it hides while the viewer moves.
        val moving = remember(state, motion) { { presence.value < 1f || dragDown.value != 0f || motion.offset != 0f || motion.neighbor != null } }
        // The frame: the whole width on a phone, at most 9:16 of the height (`.frame` in the Web SDK).
        CompositionLocalProvider(LocalViewerInMotion provides moving) {
        BoxWithConstraints(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            val width = if (maxWidth < maxHeight * 9f / 16f) maxWidth else maxHeight * 9f / 16f
            Box(Modifier.width(width).fillMaxHeight()) {
                CompositionLocalProvider(LocalLinkOpener provides opener, LocalComponentReporter provides reporter, LocalElementResponder provides responder) {
                    Stage(state, rtl, theme.fontFamily, motion, dragDown)
                }
                TopBar(state, accent, font)
                // The live region (`.sr-only` in the Web SDK): says which tale shows.
                Box(
                    Modifier
                        .size(1.dp)
                        .semantics {
                            liveRegion = LiveRegionMode.Polite
                            contentDescription = state.announcement
                        },
                )
            }
        }
        }
    }
}

// The stage: the tale's page, the tap zones, and the gestures over both. A swipe sideways turns the
// cube with the finger ([ViewerMotion]); a swipe down drags the page down, closing or springing back.
@Composable
private fun BoxScope.Stage(state: TaleViewerState, rtl: Boolean, themeFont: String?, motion: ViewerMotion, dragDown: MutableFloatState) {
    val uri = LocalUriHandler.current
    val opener = LocalLinkOpener.current
    val t = LocalTaleartContext.current.translate
    val scope = rememberCoroutineScope()
    val dir = if (rtl) -1 else 1
    // The released drag settling now, if any: a new touch lands it at once.
    val settling = remember(motion) { arrayOfNulls<Job>(1) }
    Box(
        Modifier
            .matchParentSize()
            .testTag(VIEWER_STAGE_TAG)
            .pointerInput(state, rtl, uri, opener, motion) {
                val swipe = SWIPE_MIN_DP.dp.toPx()
                val swipeUp = maxOf(SWIPE_UP_MIN_DP.dp.toPx(), SWIPE_UP_MIN_SHARE * size.height)
                val slop = viewConfiguration.touchSlop
                awaitEachGesture {
                    val down = awaitFirstDown(requireUnconsumed = false)
                    settling[0]?.let {
                        motion.finishSettle()
                        it.cancel()
                        settling[0] = null
                    }
                    state.held = true
                    var joined = false
                    // A tap a link took (a call to action on the canvas): it opens the link and does not step.
                    var linkTapped = false
                    var released: Pair<Float, Float>? = null
                    var releasedAt = down.uptimeMillis
                    // The page follows the finger sideways once it has moved past the touch slop that way.
                    var following = false
                    val velocity = VelocityTracker()
                    velocity.addPosition(down.uptimeMillis, down.position)
                    try {
                        while (true) {
                            val event = awaitPointerEvent()
                            // A second finger (a pinch) makes the press neither a tap, a hold nor a swipe.
                            if (event.changes.any { it.id != down.id && it.pressed }) joined = true
                            val change = event.changes.firstOrNull { it.id == down.id } ?: break
                            velocity.addPosition(change.uptimeMillis, change.position)
                            val dy = change.position.y - down.position.y
                            val dx = change.position.x - down.position.x
                            if (!change.pressed) {
                                linkTapped = change.isConsumed
                                released = dx to dy
                                releasedAt = change.uptimeMillis
                                break
                            }
                            if (!joined && !following && abs(dx) > slop && abs(dx) > abs(dy) && !state.reducedMotion) following = true
                            if (following && !joined) motion.drag(dx / size.width, dir)
                            dragDown.floatValue = if (!following && dy > 0 && dy > abs(dx) && !state.reducedMotion) dy else 0f
                        }
                    } finally {
                        state.held = false
                    }
                    val (dx, dy) = released ?: (0f to 0f)
                    val closing = released != null && !joined && !linkTapped && !following && dy >= swipe && dy > abs(dx)
                    // A swipe down that closes keeps the page where the finger left it as the viewer fades; else it springs back.
                    if (!closing && dragDown.floatValue != 0f) {
                        scope.launch {
                            animate(dragDown.floatValue, 0f, animationSpec = cubeSpring()) { v, _ -> dragDown.floatValue = v }
                        }
                    }
                    val short = released != null && !joined && abs(dx) < swipe && abs(dy) < swipe
                    if (following && short) {
                        // A release that moved less than a swipe is still a tap or a hold, as on the web:
                        // the page, barely moved, is back in place at once.
                        motion.commitTarget(commit = false)
                        motion.settled()
                    } else if (following) {
                        // The cube settles: to the group the finger turned toward when it went far enough, else back.
                        val commit = released != null && !joined && abs(dx) >= swipe && abs(dx) > abs(dy)
                        val toNext = if (rtl) dx > 0 else dx < 0
                        if (commit && motion.neighbor == null) {
                            // Past the last group a swipe on closes the viewer, as on the web.
                            motion.stop()
                            if (toNext) state.nextGroup()
                        } else {
                            val target = motion.commitTarget(commit)
                            val v = velocity.calculateVelocity().x / size.width
                            settling[0] = scope.launch { motion.settleDrag(target, v) }
                        }
                        return@awaitEachGesture
                    }
                    if (released == null || joined || linkTapped) return@awaitEachGesture
                    val swipeUpHref = state.view.swipeUpHref
                    when {
                        // A flick up opens the tale's swipe-up link, when it has one (R7).
                        swipeUpHref != null && releasedAt - down.uptimeMillis < SWIPE_UP_MAX_MS && -dy >= swipeUp && -dy > abs(dx) ->
                            openLink(opener, uri, ComponentRef(state.view.swipeUpId.orEmpty(), "swipe-up"), swipeUpHref)
                        // A swipe toward the start of the line (left, or right in right to left) shows the next group.
                        abs(dx) >= swipe && abs(dx) > abs(dy) -> if (if (rtl) dx > 0 else dx < 0) state.nextGroup() else state.previousGroup()
                        closing -> state.close()
                        releasedAt - down.uptimeMillis >= HOLD_MIN_MS -> Unit
                        else -> {
                            val third = size.width / 3f
                            val back = if (rtl) down.position.x > size.width - third else down.position.x < third
                            if (back) state.previous() else state.next()
                        }
                    }
                }
            },
    ) {
        // The tap zones, for screen readers: the gestures over the stage handle touch; these name the
        // parts. They lie under the tale and come first in the reading order, so the tale's links,
        // drawn over them, are what touch exploration finds where they are.
        Row(Modifier.matchParentSize().semantics { isTraversalGroup = true; traversalIndex = -1f }) {
            // The Row mirrors right to left by itself: Previous is then the right third.
            Zone(t("viewer.previousTale"), 1f) { state.previous() }
            Zone(t("viewer.nextTale"), 2f) { state.next() }
        }
        // The group turning in or out beside the live one: a still picture of its tale, hidden from
        // screen readers and touch.
        motion.neighbor?.let { neighbor ->
            key(neighbor.groupIndex, neighbor.side) {
                Box(
                    Modifier
                        .matchParentSize()
                        .testTag(VIEWER_NEIGHBOR_TAG)
                        .clearAndSetSemantics { }
                        .graphicsLayer { cubeFace(motion.offset + neighbor.side) }
                        .faceShade { motion.offset + neighbor.side },
                ) {
                    TalePreview(neighbor.view, themeFont)
                }
            }
        }
        Box(
            Modifier
                .matchParentSize()
                .graphicsLayer {
                    cubeFace(motion.offset)
                    // A swipe down drags the tale with the finger, shrinking it a little (never under reduced motion).
                    val pulled = dragDown.floatValue
                    if (pulled != 0f) {
                        translationY = pulled
                        val scale = 1f - 0.15f * (pulled / size.height).coerceIn(0f, 1f)
                        scaleX = scale
                        scaleY = scale
                    }
                }
                .faceShade { motion.offset },
        ) {
            key(state.shows) { TalePage(state, themeFont = themeFont) }
        }
    }
}

// A cube's face darkens as it turns away, as a face out of the light.
private fun Modifier.faceShade(position: () -> Float): Modifier = drawWithContent {
    drawContent()
    val p = abs(position()).coerceIn(0f, 1f)
    if (p > 0f) drawRect(CardDark.copy(alpha = 0.5f * p))
}

/**
 * A tale drawn still, beside the live page during a group transition: its stage colour and image,
 * its canvas's background and elements without their videos (a native video view cannot turn with
 * the cube) and with its links inert. Nothing in it plays.
 */
@Composable
private fun TalePreview(view: TaleView, themeFont: String?) {
    val loader = rememberCoverImageLoader()
    Box(
        Modifier
            .fillMaxSize()
            .background(view.stageColor?.let(::parseHexColor) ?: CardDark),
        contentAlignment = Alignment.Center,
    ) {
        when (val media = view.media) {
            is StageMedia.Image -> MediaImage(media, loader, Modifier.fillMaxSize())
            is StageMedia.Placeholder -> Box(Modifier.fillMaxSize().background(parseHexColor(LEGACY_PLACEHOLDER_COLOR)!!))
            else -> Unit
        }
        view.canvas?.let { canvas ->
            val still = canvas.copy(layer = canvas.layer.copy(elements = canvas.layer.elements.filter { it !is DocumentElement.Video }))
            CanvasBox(still, loader) { c ->
                DocumentElementsLayer(c.layer, themeFont = themeFont, inertLinks = true, topChrome = VIEWER_TOP_BAR_HEIGHT, projectFonts = c.projectFonts)
            }
        }
    }
}

@Composable
private fun androidx.compose.foundation.layout.RowScope.Zone(label: String, weight: Float, action: () -> Unit) {
    Box(
        Modifier
            .weight(weight)
            .fillMaxHeight()
            .semantics {
                contentDescription = label
                role = Role.Button
                onClick(label) {
                    action()
                    true
                }
            },
    )
}

/**
 * One tale: its stage media full-bleed over the stage colour, and its document's 9:16 canvas over
 * that, inside the screen's safe area: the canvas's background, then the document's elements
 * (story 9.5), drawn in [elementLayer].
 */
@Composable
internal fun TalePage(
    state: TaleViewerState,
    themeFont: String? = null,
    elementLayer: @Composable BoxScope.(TaleCanvas) -> Unit = { canvas -> DocumentElementsLayer(canvas.layer, themeFont = themeFont, video = documentVideoPlayback(state), topChrome = VIEWER_TOP_BAR_HEIGHT, projectFonts = canvas.projectFonts) },
) {
    val view = state.view
    val loader = rememberCoverImageLoader()
    Box(
        Modifier
            .fillMaxSize()
            .testTag(VIEWER_PAGE_TAG)
            .semantics { viewerTale = "${state.group.id}/${state.taleIndex}" }
            .then(view.stageColor?.let(::parseHexColor)?.let { Modifier.background(it) } ?: Modifier),
        contentAlignment = Alignment.Center,
    ) {
        when (val media = view.media) {
            is StageMedia.Image -> MediaImage(media, loader, Modifier.fillMaxSize())
            is StageMedia.Video -> {
                val player = LocalTaleVideoPlayer.current ?: remember { platformTaleVideoPlayer() }
                // One player per show and run: its callbacks name them, so a late call from an earlier one is ignored.
                val show = state.shows
                val run = state.videoRuns
                key(run) {
                    player.Video(
                        url = media.url,
                        fit = media.fit,
                        // Under reduced motion the tale starts paused: the video waits for Play.
                        playing = !state.stopped && state.isOpen && !state.timed,
                        muted = false,
                        onProgress = { position, duration -> state.videoProgress(show, run, position, duration) },
                        onEnded = { state.videoEnded(show, run) },
                        onError = { state.videoFailed(show, run) },
                        modifier = Modifier.fillMaxSize().mediaSemantics(media.label),
                    )
                }
            }
            is StageMedia.Placeholder -> Box(
                Modifier
                    .fillMaxSize()
                    .background(parseHexColor(LEGACY_PLACEHOLDER_COLOR)!!)
                    .semantics {
                        contentDescription = media.label
                        role = Role.Image
                    },
            )
            null -> Unit
        }
        view.canvas?.let { canvas -> CanvasBox(canvas, loader, elementLayer) }
    }
}

/**
 * How the viewer plays the document's own video (R5): as the tale's clock when the stage has no
 * video (playing with the tale, its progress, end and failure going to [state]), or else looping
 * beside the stage's video, playing while the tale plays.
 */
internal fun documentVideoPlayback(state: TaleViewerState): DocumentVideoPlayback {
    val clock = state.view.documentVideo != null
    val show = state.shows
    val run = state.videoRuns
    return DocumentVideoPlayback(
        playing = !state.stopped && state.isOpen && (!clock || !state.timed),
        clock = clock,
        run = run,
        onProgress = { position, duration -> state.videoProgress(show, run, position, duration) },
        onEnded = { state.videoEnded(show, run) },
        onError = { state.videoFailed(show, run) },
    )
}

// The document's canvas: 9:16, as large as fits inside the screen's safe area, centred
// (`.ta-area` inside `env(safe-area-inset-*)`, `.ta-canvas`), named by the tale.
@Composable
private fun CanvasBox(canvas: TaleCanvas, loader: ImageLoader, elementLayer: @Composable BoxScope.(TaleCanvas) -> Unit) {
    BoxWithConstraints(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing), contentAlignment = Alignment.Center) {
        val w = if (maxWidth * 16f / 9f <= maxHeight) maxWidth else maxHeight * 9f / 16f
        Box(
            Modifier
                .width(w)
                .height(w * 16f / 9f)
                .clip(RoundedCornerShape(0.dp))
                .then(canvas.color?.let(::parseHexColor)?.let { Modifier.background(it) } ?: Modifier)
                .testTag(VIEWER_CANVAS_TAG)
                .semantics {
                    contentDescription = canvas.label
                    isTraversalGroup = true
                },
        ) {
            canvas.background?.let { MediaImage(it, loader, Modifier.matchParentSize()) }
            elementLayer(canvas)
        }
    }
}

@Composable
private fun MediaImage(media: StageMedia.Image, loader: ImageLoader, modifier: Modifier) {
    AsyncImage(
        model = media.url,
        contentDescription = media.label,
        imageLoader = loader,
        contentScale = if (media.fit == MediaFit.Cover) ContentScale.Crop else ContentScale.Fit,
        modifier = modifier,
    )
}

private fun Modifier.mediaSemantics(label: String?): Modifier =
    if (label == null) this else semantics { contentDescription = label; role = Role.Image }

// The top: one segment per tale of the group, then the group's name, Pause and Close.
@Composable
private fun BoxScope.TopBar(state: TaleViewerState, accent: Color, font: androidx.compose.ui.text.font.FontFamily?) {
    val t = LocalTaleartContext.current.translate
    Column(
        Modifier
            .align(Alignment.TopCenter)
            .fillMaxWidth()
            .background(TOP_SHADE)
            .windowInsetsPadding(WindowInsets.safeDrawing)
            .padding(8.dp),
    ) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            val count = state.group.tales.size
            for (i in 0 until count) {
                val fill = when {
                    i < state.taleIndex -> 1f
                    i == state.taleIndex -> state.progress
                    else -> 0f
                }
                Segment(fill, accent, Modifier.weight(1f))
            }
        }
        Row(Modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            // The name takes the room the controls leave, and ellipsizes in it.
            Box(Modifier.weight(1f).padding(end = 8.dp)) {
                BasicText(
                    state.group.name,
                    style = TextStyle(color = InkDark, fontSize = 14.sp, lineHeight = 20.sp, fontWeight = FontWeight.SemiBold, fontFamily = font),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier
                        .clip(RoundedCornerShape(12.dp))
                        .background(NAME_BACKGROUND)
                        .padding(horizontal = 10.dp, vertical = 2.dp),
                )
            }
            // Under reduced motion the Pause button shows only for a video, which plays from it.
            if (!state.reducedMotion || state.view.runsOnVideo) {
                Control(if (state.paused) t("viewer.play") else t("viewer.pause"), if (state.paused) Icons.PLAY else Icons.PAUSE, accent) { state.togglePause() }
                Spacer(Modifier.width(8.dp))
            }
            Control(t("viewer.close"), Icons.CLOSE, accent) { state.close() }
        }
    }
}

@Composable
private fun Segment(fill: Float, accent: Color, modifier: Modifier) {
    Box(
        modifier
            .height(3.dp)
            .clip(RoundedCornerShape(2.dp))
            .background(TRACK)
            .testTag(VIEWER_SEGMENT_TAG)
            .semantics { segmentFill = fill },
    ) {
        val rtl = LocalLayoutDirection.current == LayoutDirection.Rtl
        Canvas(Modifier.matchParentSize()) {
            val w = size.width * fill
            drawRect(accent, topLeft = androidx.compose.ui.geometry.Offset(if (rtl) size.width - w else 0f, 0f), size = Size(w, size.height))
        }
    }
}

// A 44dp round control with a 24dp icon in the accent colour.
@Composable
private fun Control(label: String, icon: String, accent: Color, onClick: () -> Unit) {
    val path = remember(icon) { PathParser().parsePathString(icon).toPath() }
    Box(
        Modifier
            .size(44.dp)
            .clip(CircleShape)
            .background(CONTROL_BACKGROUND)
            .clickable(role = Role.Button, onClickLabel = null, onClick = onClick)
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) {
        Canvas(Modifier.size(24.dp)) {
            val factor = size.width / 24f
            scale(factor, factor, pivot = androidx.compose.ui.geometry.Offset.Zero) {
                drawPath(path, accent)
            }
        }
    }
}
