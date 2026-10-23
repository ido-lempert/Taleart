package site.lempert.taleart.sdk.ui

import androidx.compose.foundation.Canvas
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
import site.lempert.taleart.sdk.delivery.DeliveryTaleGroup

/** Test tag of the viewer. */
const val VIEWER_TAG = "taleart-viewer"

/** Test tag of each progress segment. */
const val VIEWER_SEGMENT_TAG = "taleart-viewer-segment"

/** Test tag of the stage, where taps, holds and swipes land. */
const val VIEWER_STAGE_TAG = "taleart-viewer-stage"

/** Test tag of the current tale's 9:16 canvas. */
const val VIEWER_CANVAS_TAG = "taleart-viewer-canvas"

/** Test tag of the current tale's page. */
const val VIEWER_PAGE_TAG = "taleart-viewer-page"

/** How far a progress segment is filled, 0 to 1; screen readers never read it (the live region says where the viewer is). */
val SegmentFill = SemanticsPropertyKey<Float>("TaleartSegmentFill")
private var SemanticsPropertyReceiver.segmentFill by SegmentFill

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
private val TRACK = Color.White.copy(alpha = 0.4f)
private val CONTROL_BACKGROUND = Color.Black.copy(alpha = 0.6f)
private val NAME_BACKGROUND = Color.Black.copy(alpha = 0.8f)
private val TOP_SHADE = Brush.verticalGradient(listOf(Color.Black.copy(alpha = 0.7f), Color.Transparent))

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
 * advances by itself: each tale starts paused, a video plays from the Play button, and the person steps.
 *
 * Each group shown is marked seen in [seenGroups] and passed to [onGroupShown]; [onClose] is called
 * once with the group shown last. [theme]'s accent colours the progress and the controls.
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
    val state = remember(groups, startGroupId) {
        TaleViewerState(groups, startGroupId, reducedMotion, onClosed = { closed(it) })
    }
    TaleartViewer(state, modifier, seenGroups, theme, onGroupShown)
}

/** The viewer of a [TaleViewerState] the caller holds (see the other overload). */
@Composable
fun TaleartViewer(
    state: TaleViewerState,
    modifier: Modifier = Modifier,
    seenGroups: SeenGroups = rememberSeenGroups(),
    theme: TaleartTheme = TaleartTheme.DEFAULT,
    onGroupShown: (groupId: String) -> Unit = {},
) {
    val shown by rememberUpdatedState(onGroupShown)
    if (!state.isOpen) {
        // An unknown group, or one without tales: nothing opens (`open` returns false).
        return
    }
    // The group is viewed (seen) whenever one of its tales shows, and a screen reader says where the viewer is.
    DisposableEffect(state.shows) {
        if (state.isOpen) {
            seenGroups.markSeen(state.group.id)
            shown(state.group.id)
            announceForAccessibility(state.announcement)
        }
        onDispose { }
    }
    // The tale's timer: frame by frame while it plays, keeping the time left across a pause.
    LaunchedEffect(state.shows, state.timed, state.stopped) {
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
    LaunchedEffect(state.shows, state.videoRuns, state.capped, state.paused, state.inBackground) {
        if (!state.capped || state.paused || state.inBackground || state.reducedMotion) return@LaunchedEffect
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

    val rtl = LocalLayoutDirection.current == LayoutDirection.Rtl
    val accent = parseHexColor(theme.accentColor) ?: Color.White
    val font = fontFamilyOf(theme.fontFamily)
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }

    Box(
        modifier
            .fillMaxSize()
            .background(Color.Black)
            .testTag(VIEWER_TAG)
            .semantics { paneTitle = state.group.name }
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
        // The frame: the whole width on a phone, at most 9:16 of the height (`.frame` in the Web SDK).
        BoxWithConstraints(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            val width = if (maxWidth < maxHeight * 9f / 16f) maxWidth else maxHeight * 9f / 16f
            Box(Modifier.width(width).fillMaxHeight()) {
                Stage(state, rtl, theme.fontFamily)
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

// The stage: the tale's page, the tap zones, and the gestures over both.
@Composable
private fun BoxScope.Stage(state: TaleViewerState, rtl: Boolean, themeFont: String?) {
    var dragDown by remember { mutableFloatStateOf(0f) }
    val uri = LocalUriHandler.current
    Box(
        Modifier
            .matchParentSize()
            .testTag(VIEWER_STAGE_TAG)
            .pointerInput(state, rtl, uri) {
                val swipe = SWIPE_MIN_DP.dp.toPx()
                val swipeUp = maxOf(SWIPE_UP_MIN_DP.dp.toPx(), SWIPE_UP_MIN_SHARE * size.height)
                awaitEachGesture {
                    val down = awaitFirstDown(requireUnconsumed = false)
                    state.held = true
                    var joined = false
                    // A tap a link took (a call to action on the canvas): it opens the link and does not step.
                    var linkTapped = false
                    var released: Pair<Float, Float>? = null
                    var releasedAt = down.uptimeMillis
                    try {
                        while (true) {
                            val event = awaitPointerEvent()
                            // A second finger (a pinch) makes the press neither a tap, a hold nor a swipe.
                            if (event.changes.any { it.id != down.id && it.pressed }) joined = true
                            val change = event.changes.firstOrNull { it.id == down.id } ?: break
                            if (!change.pressed) {
                                linkTapped = change.isConsumed
                                released = change.position.x - down.position.x to change.position.y - down.position.y
                                releasedAt = change.uptimeMillis
                                break
                            }
                            val dy = change.position.y - down.position.y
                            val dx = change.position.x - down.position.x
                            dragDown = if (dy > 0 && dy > abs(dx)) dy else 0f
                        }
                    } finally {
                        state.held = false
                        dragDown = 0f
                    }
                    val (dx, dy) = released ?: return@awaitEachGesture
                    if (joined || linkTapped) return@awaitEachGesture
                    val swipeUpHref = state.view.swipeUpHref
                    when {
                        // A flick up opens the tale's swipe-up link, when it has one (R7).
                        swipeUpHref != null && releasedAt - down.uptimeMillis < SWIPE_UP_MAX_MS && -dy >= swipeUp && -dy > abs(dx) ->
                            runCatching { uri.openUri(swipeUpHref) }
                        // A swipe toward the start of the line (left, or right in right to left) shows the next group.
                        abs(dx) >= swipe && abs(dx) > abs(dy) -> if (if (rtl) dx > 0 else dx < 0) state.nextGroup() else state.previousGroup()
                        dy >= swipe && dy > abs(dx) -> state.close()
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
            Zone("Previous tale", 1f) { state.previous() }
            Zone("Next tale", 2f) { state.next() }
        }
        Box(
            Modifier.matchParentSize().graphicsLayer {
                // A swipe down drags the tale with the finger, unless the person prefers reduced motion.
                if (!state.reducedMotion) translationY = dragDown
            },
        ) {
            key(state.shows) { TalePage(state, themeFont = themeFont) }
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
 * (story 9.5), drawn in [elementLayer]. The tale's project fonts start loading as it shows.
 */
@Composable
internal fun TalePage(
    state: TaleViewerState,
    themeFont: String? = null,
    elementLayer: @Composable BoxScope.(TaleCanvas) -> Unit = { canvas -> DocumentElementsLayer(canvas.layer, themeFont = themeFont, video = documentVideoPlayback(state)) },
) {
    val view = state.view
    val loader = rememberCoverImageLoader()
    val fonts = state.group.tales.getOrNull(state.taleIndex)?.fonts.orEmpty()
    // Its project fonts load now that it shows (R18); its text shows the fallback stack until then.
    val fontClient = LocalFontHttpClient.current
    LaunchedEffect(fonts) { if (fonts.isNotEmpty() && view.canvas != null) ProjectFonts.load(fonts, fontClient) }
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
                    style = TextStyle(color = Color.White, fontSize = 14.sp, lineHeight = 20.sp, fontWeight = FontWeight.SemiBold, fontFamily = font),
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
                Control(if (state.paused) "Play" else "Pause", if (state.paused) Icons.PLAY else Icons.PAUSE, accent) { state.togglePause() }
                Spacer(Modifier.width(8.dp))
            }
            Control("Close", Icons.CLOSE, accent) { state.close() }
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
