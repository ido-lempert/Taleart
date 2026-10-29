package site.lempert.taleart.sdk.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.withFrameNanos
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsPropertyKey
import androidx.compose.ui.semantics.SemanticsPropertyReceiver
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.isTraversalGroup
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import kotlinx.coroutines.delay
import site.lempert.taleart.sdk.delivery.DeliveryTaleGroup
import site.lempert.taleart.sdk.i18n.Translate
import site.lempert.taleart.sdk.i18n.defaultTranslate
import kotlin.math.abs
import kotlin.math.roundToInt

/** Test tag of the banner. */
const val BANNER_TAG = "taleart-banner"

/** Test tag of each banner slide's button. */
const val BANNER_SLIDE_TAG = "taleart-banner-slide"

/** Test tag of each banner dot. */
const val BANNER_DOT_TAG = "taleart-banner-dot"

/** Test tag of the banner's slide area, where swipes change the slide. */
const val BANNER_VIEWPORT_TAG = "taleart-banner-viewport"

/** The group whose slide is shown, for tests (`index` in the Web SDK's banner view). */
val BannerShown = SemanticsPropertyKey<String>("TaleartBannerShown")
private var SemanticsPropertyReceiver.bannerShown by BannerShown

/** True while the banner advances by itself, for tests (`rotating` in the Web SDK's banner view). */
val BannerRotating = SemanticsPropertyKey<Boolean>("TaleartBannerRotating")
private var SemanticsPropertyReceiver.bannerRotating by BannerRotating

/** A slide's position for screen readers, as the Web SDK's slide label: `1 of 3`. */
fun bannerSlideLabel(index: Int, count: Int, translate: Translate = defaultTranslate): String =
    translate("banner.slideOf", mapOf("index" to index + 1, "count" to count))

/** A dot's name, as in the Web SDK: `Show <group title>`. */
fun bannerDotLabel(name: String, translate: Translate = defaultTranslate): String = translate("banner.showGroup", mapOf("name" to name))

/** The rotation button's name, as in the Web SDK. */
fun bannerRotationLabel(rotating: Boolean, translate: Translate = defaultTranslate): String =
    if (rotating) translate("banner.stopRotation") else translate("banner.startRotation")

// The banner's fixed look (BANNER_STYLES in the Web SDK).
private val SLIDE_PLACEHOLDER = Color(0xFFE5E7EB)
private val BUTTON_FILL = Color.White.copy(alpha = 0.92f)
private val BUTTON_BORDER = Color(0xFF6B7280)
private val BUTTON_INK = Color(0xFF111827)
private val DOT = Color(0xFF6B7280)
private const val DEFAULT_RADIUS = 12
private const val SLIDE_MS = 350

// CSS `ease`.
private val EASE = CubicBezierEasing(0.25f, 0.1f, 0.25f, 1f)

private object BannerIcons {
    const val PREV = "M15.4 7.4 14 6l-6 6 6 6 1.4-1.4-4.6-4.6z"
    const val NEXT = "M8.6 16.6 10 18l6-6-6-6-1.4 1.4 4.6 4.6z"
    const val PAUSE = "M6 5h4v14H6zM14 5h4v14h-4z"
    const val PLAY = "M7 4.5v15L19.5 12z"
}

/**
 * A zone's banner display (web zones R3), as libs/web-sdk/src/lib/banner.ts draws it: a carousel
 * with one slide per tale group that has a tale, in the delivered order, each showing the group's
 * default cover ([defaultCoverSource]) cut to the display's aspect ratio, with previous and next
 * buttons, swipe, dots and autoplay as its [settings] say. A tap on a slide calls [onGroupClick]
 * with its group. Nothing shows when no group has a tale.
 *
 * Autoplay runs only with the `autoplay` setting, two or more slides and no preference for reduced
 * motion ([reducedMotion], followed live); an interaction (a tap or a sideways drag on the slides,
 * a button, a dot, focus) stops it, and the rotation button starts it again. Unlike the web banner,
 * where any pointerdown stops it, a vertical scroll that starts on the banner leaves it playing. Without `loop` it stops on the last slide. The
 * project's [theme] sets the background, the slides' corner radius (12dp by default) and the dots'
 * colour; [titleStyle]'s colour is the shown dot's colour when the theme has no title colour, as the
 * web banner takes the host page's text colour.
 *
 * It fills the width it is given. Its height is 16dp (8 above, 8 below) plus the width divided by
 * the aspect ratio (16:9, 3:1 or 1:1), plus, when it has two or more slides and shows dots or
 * autoplays, a 4dp gap and a row of 44dp (with the rotation button) or 24dp (dots only).
 */
@Composable
fun TaleartBanner(
    groups: List<DeliveryTaleGroup>,
    settings: BannerSettings,
    theme: TaleartTheme,
    onGroupClick: (DeliveryTaleGroup) -> Unit,
    modifier: Modifier = Modifier,
    titleStyle: TextStyle = TextStyle.Default,
    reducedMotion: Boolean = rememberPrefersReducedMotion(),
) = TaleartBanner(groups, settings, theme, onGroupClick, modifier, titleStyle, reducedMotion, show = null, onShowDone = {})

/**
 * Asks a banner to show and focus the slide of [groupId], as the Web SDK's banner `focus` does when
 * the viewer closes. Only a banner that was already on screen when the request was made honours it:
 * a banner made later (a reload with other groups, a switch from the bar) starts at its first slide.
 */
internal class BannerShowRequest(val groupId: String) {
    /** The order requests were made in (main thread only). */
    val serial: Long = ++made

    internal companion object {
        /** The serial of the latest request; a banner notes it when it is made. */
        var made: Long = 0L
            private set
    }
}

@Composable
internal fun TaleartBanner(
    groups: List<DeliveryTaleGroup>,
    settings: BannerSettings,
    theme: TaleartTheme,
    onGroupClick: (DeliveryTaleGroup) -> Unit,
    modifier: Modifier,
    titleStyle: TextStyle,
    reducedMotion: Boolean,
    show: BannerShowRequest?,
    onShowDone: (BannerShowRequest) -> Unit,
) {
    val slides = remember(groups) { groups.filter { it.tales.isNotEmpty() } }
    if (slides.isEmpty()) {
        // No banner to honour it: the request is dropped, not kept for a later one.
        if (show != null) SideEffect { onShowDone(show) }
        return
    }
    // A new set of slides starts again at the first, as the Web SDK renders a new banner.
    key(slides) { Banner(slides, settings, theme, onGroupClick, modifier, titleStyle, reducedMotion, show, onShowDone) }
}

@Composable
private fun Banner(
    slides: List<DeliveryTaleGroup>,
    settings: BannerSettings,
    theme: TaleartTheme,
    onGroupClick: (DeliveryTaleGroup) -> Unit,
    modifier: Modifier,
    titleStyle: TextStyle,
    reducedMotion: Boolean,
    show: BannerShowRequest?,
    onShowDone: (BannerShowRequest) -> Unit,
) {
    val count = slides.size
    // Requests made before this banner existed are not its own (see BannerShowRequest).
    val madeAfter = remember { BannerShowRequest.made }
    val showDone by rememberUpdatedState(onShowDone)
    val loop = settings.loop
    val canRotate = settings.autoplay && count > 1
    val rtl = LocalLayoutDirection.current == LayoutDirection.Rtl
    val open by rememberUpdatedState(onGroupClick)

    var index by remember { mutableIntStateOf(0) }
    // Set by the person's interaction or by reaching the last slide without loop; only the rotation button clears it.
    var stopped by remember { mutableStateOf(false) }
    // True while the SDK moves focus itself, which is not the person's interaction (not state: read in callbacks only).
    val programmaticFocus = remember { BooleanArray(1) }
    val atEnd = !loop && index == count - 1
    val rotating = canRotate && !stopped && !reducedMotion && !atEnd

    fun stepTo(delta: Int): Int? {
        val target = index + delta
        if (target in 0 until count) return target
        return if (loop) (target + count) % count else null
    }
    fun step(delta: Int) {
        stepTo(delta)?.let { index = it }
    }
    fun interact() {
        stopped = true
    }

    // The track follows the index: sliding, or at once under reduced motion (`transition: none`).
    val animated = remember { Animatable(0f) }
    LaunchedEffect(index, reducedMotion) {
        if (reducedMotion) animated.snapTo(index.toFloat())
        else animated.animateTo(index.toFloat(), tween(SLIDE_MS, easing = EASE))
    }
    // Read in layout (the slides' offsets) and composition (which slides are drawn).
    val position = { if (reducedMotion) index.toFloat() else animated.value }

    // The timer for the next slide, restarted by every change of slide or rotation state.
    LaunchedEffect(rotating, index, settings.intervalSeconds) {
        if (!rotating) return@LaunchedEffect
        delay(settings.intervalSeconds * 1000L)
        step(1)
        // Reaching the last slide without loop stops autoplay.
        if (!loop && index == count - 1) stopped = true
    }

    val focusers = remember(slides) { List(count) { FocusRequester() } }
    LaunchedEffect(show) {
        val request = show ?: return@LaunchedEffect
        val i = slides.indexOfFirst { it.id == request.groupId }
        // Consumed whether honoured or not, so no later banner takes it up; consuming it changes
        // [show], which restarts this effect, so it comes last.
        if (request.serial <= madeAfter || i < 0) {
            showDone(request)
            return@LaunchedEffect
        }
        index = i
        try {
            // The slide becomes focusable once it is the shown one: wait for that frame, then focus it.
            withFrameNanos { }
            programmaticFocus[0] = true
            try {
                runCatching { focusers[i].requestFocus() }
            } finally {
                programmaticFocus[0] = false
            }
        } finally {
            showDone(request)
        }
    }
    val stopsOnFocus = Modifier.onFocusChanged { if (it.isFocused && !programmaticFocus[0]) interact() }

    val radius = theme.cornerRadius ?: DEFAULT_RADIUS
    val background = parseHexColor(theme.backgroundColor)
    val dotColor = parseHexColor(theme.titleColor)
    val hostColor = titleStyle.color.takeUnless { it == Color.Unspecified } ?: Color.Black
    val translate = LocalTaleartContext.current.translate
    val loader = rememberCoverImageLoader()

    Column(
        modifier
            .fillMaxWidth()
            .testTag(BANNER_TAG)
            .semantics {
                isTraversalGroup = true
                // aria-label "Banner" on the carousel.
                contentDescription = translate("banner.label")
                bannerShown = slides[index].id
                bannerRotating = rotating
            }
            // The web banner's 8px margin lies outside its background.
            .padding(vertical = 8.dp)
            .then(if (background != null) Modifier.background(background) else Modifier),
    ) {
        BoxWithConstraints(
            Modifier
                .fillMaxWidth()
                .aspectRatio(settings.aspectRatio.widthOverHeight)
                .clip(RoundedCornerShape(radius.dp))
                .background(SLIDE_PLACEHOLDER)
                .testTag(BANNER_VIEWPORT_TAG)
                .pointerInput(rtl, count, loop) {
                    val swipe = SWIPE_MIN_DP.dp.toPx()
                    val slop = viewConfiguration.touchSlop
                    awaitEachGesture {
                        // Seen before the slide's button, so a swipe can take the tap from it.
                        val down = awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
                        // Unlike the web banner, whose pointerdown stops autoplay, a touch stops it only
                        // once it drags sideways (a tap stops it through the slide's button): a page
                        // scrolled by a finger that lands on the banner keeps it playing.
                        var swiped = false
                        while (true) {
                            val event = awaitPointerEvent(PointerEventPass.Initial)
                            val change = event.changes.firstOrNull { it.id == down.id } ?: break
                            val dx = change.position.x - down.position.x
                            val dy = change.position.y - down.position.y
                            if (!stopped && abs(dx) > slop && abs(dx) > abs(dy)) interact()
                            if (!swiped && abs(dx) >= swipe && abs(dx) > abs(dy)) swiped = true
                            // A swipe is never a tap: the slide's button does not open.
                            if (swiped) change.consume()
                            if (!change.pressed) {
                                // A swipe toward the start of the line (left, or right in right to left) shows the next slide.
                                if (swiped) step(if ((dx < 0) != rtl) 1 else -1)
                                break
                            }
                        }
                    }
                },
        ) {
            val width = constraints.maxWidth.toFloat()
            // The slides, one width apart; the Row-like offset mirrors right to left by itself.
            Box(Modifier.fillMaxSize().clipToBounds()) {
                val near = setOfNotNull(index, stepTo(1), stepTo(-1))
                // Every slide the track passes on its way to the shown one, so none pops in mid-slide.
                val at = position()
                val from = minOf(at, index.toFloat()) - 1f
                val to = maxOf(at, index.toFloat()) + 1f
                slides.forEachIndexed { n, group ->
                    val shown = n == index
                    // Slides off the path and not next to the shown one wait (the Web SDK's lazy pictures).
                    val drawn = n.toFloat() in from..to || n in near
                    // Placed in layout, so the slide moves every frame without recomposing.
                    Box(
                        Modifier
                            .fillMaxSize()
                            .offset { IntOffset(((n - position()) * width).roundToInt(), 0) }
                            .then(
                                if (shown) {
                                    Modifier
                                        .testTag(BANNER_SLIDE_TAG)
                                        .focusRequester(focusers[n])
                                        .then(stopsOnFocus)
                                        .clickable(role = Role.Button) {
                                            interact()
                                            open(group)
                                        }
                                        .semantics {
                                            contentDescription = group.name
                                            stateDescription = bannerSlideLabel(n, count, translate)
                                            // Screen readers hear the slide shown only when the person changes it.
                                            if (!rotating) liveRegion = LiveRegionMode.Polite
                                        }
                                } else {
                                    // Hidden slides are inert, as in the Web SDK.
                                    Modifier.clearAndSetSemantics {}
                                },
                            ),
                    ) {
                        if (drawn) SlideMedia(group, loader)
                    }
                }
            }
            if (count > 1) {
                val prevDisabled = !loop && index == 0
                RoundButton(
                    label = translate("banner.previousSlide"),
                    icon = BannerIcons.PREV,
                    mirrored = rtl,
                    disabled = prevDisabled,
                    modifier = Modifier.align(Alignment.CenterStart).padding(start = 8.dp).then(stopsOnFocus),
                ) {
                    interact()
                    step(-1)
                }
                RoundButton(
                    label = translate("banner.nextSlide"),
                    icon = BannerIcons.NEXT,
                    mirrored = rtl,
                    disabled = atEnd,
                    modifier = Modifier.align(Alignment.CenterEnd).padding(end = 8.dp).then(stopsOnFocus),
                ) {
                    interact()
                    step(1)
                }
            }
        }
        val showRotate = canRotate && !reducedMotion
        val showDots = settings.showDots && count > 1
        if (showRotate || showDots) {
            Row(
                Modifier.fillMaxWidth().padding(top = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (showRotate) {
                    RoundButton(
                        label = bannerRotationLabel(rotating, translate),
                        icon = if (rotating) BannerIcons.PAUSE else BannerIcons.PLAY,
                        mirrored = false,
                        // Nothing to start on the last slide without loop.
                        disabled = !rotating && atEnd,
                    ) {
                        if (rotating) stopped = true else if (!atEnd) stopped = false
                    }
                }
                if (showDots) {
                    Row {
                        slides.forEachIndexed { n, group ->
                            Dot(
                                label = bannerDotLabel(group.name, translate),
                                current = n == index,
                                themed = dotColor,
                                host = hostColor,
                                modifier = stopsOnFocus,
                            ) {
                                interact()
                                index = n
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun SlideMedia(group: DeliveryTaleGroup, loader: coil3.ImageLoader) {
    val source = remember(group) { defaultCoverSource(group) }
    val placeholder = (source as? CoverSource.Placeholder)?.color?.let(::parseHexColor) ?: SLIDE_PLACEHOLDER
    Box(Modifier.fillMaxSize().background(placeholder)) {
        if (source is CoverSource.Image) {
            AsyncImage(
                model = source.url,
                contentDescription = null,
                imageLoader = loader,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
        }
    }
}

// A 44dp round control with a 24dp icon (`.b-btn` in the Web SDK). A disabled one (aria-disabled)
// stays a button, dimmed, whose tap still counts as an interaction.
@Composable
private fun RoundButton(
    label: String,
    icon: String,
    mirrored: Boolean,
    disabled: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    val path = remember(icon) { PathParser().parsePathString(icon).toPath() }
    Box(
        modifier
            .size(44.dp)
            .alpha(if (disabled) 0.4f else 1f)
            .clip(CircleShape)
            .background(BUTTON_FILL)
            .border(1.dp, BUTTON_BORDER, CircleShape)
            .clickable(role = Role.Button, onClick = onClick)
            .semantics {
                contentDescription = label
                if (disabled) disabled()
            },
        contentAlignment = Alignment.Center,
    ) {
        Canvas(Modifier.size(24.dp)) {
            val factor = size.width / 24f
            scale(if (mirrored) -factor else factor, factor, pivot = Offset(if (mirrored) size.width / 2f else 0f, 0f)) {
                drawPath(path, BUTTON_INK)
            }
        }
    }
}

// A dot: a 24dp target around an 8dp grey dot, the shown slide's 12dp in the host's text colour;
// with a theme title colour, 10dp rings of it, the shown one filled.
@Composable
private fun Dot(label: String, current: Boolean, themed: Color?, host: Color, modifier: Modifier, onClick: () -> Unit) {
    Box(
        modifier
            .testTag(BANNER_DOT_TAG)
            .size(24.dp)
            .clip(CircleShape)
            .clickable(role = Role.Button, onClick = onClick)
            .semantics {
                contentDescription = label
                // aria-current on the shown slide's dot.
                selected = current
            },
        contentAlignment = Alignment.Center,
    ) {
        when {
            current -> Box(Modifier.size(12.dp).clip(CircleShape).background(themed ?: host))
            themed != null -> Box(Modifier.size(10.dp).border(2.dp, themed, CircleShape))
            else -> Box(Modifier.size(8.dp).clip(CircleShape).background(DOT))
        }
    }
}
