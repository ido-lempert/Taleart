package site.lempert.taleart.sdk.ui

import androidx.compose.animation.core.animateDpAsState
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.BoxWithConstraintsScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.hideFromAccessibility
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.ImageLoader
import coil3.compose.AsyncImage
import site.lempert.taleart.sdk.delivery.DeliveryTaleGroup
import site.lempert.taleart.sdk.i18n.Translate
import site.lempert.taleart.sdk.i18n.defaultTranslate
import kotlin.math.abs

/** Test tag of the banner. */
const val BANNER_TAG = "taleart-banner"

/** Test tag of the shown slide's button (the only slide that is there for taps and screen readers). */
const val BANNER_SLIDE_TAG = "taleart-banner-slide"

/** Test tag of each banner dot. */
const val BANNER_DOT_TAG = "taleart-banner-dot"

/** Test tag of the banner's slide area, where swipes change the slide. */
const val BANNER_VIEWPORT_TAG = "taleart-banner-viewport"

/** Test tag of a slide drawn beside the shown one (coverflow, peek, deck); a tap on it shows that slide. */
const val BANNER_NEIGHBOUR_TAG = "taleart-banner-neighbour"

/** Test tag of the sticky banner's dismiss button. */
const val BANNER_DISMISS_TAG = "taleart-banner-dismiss"

/** Test tag of the strip's marquee. */
const val BANNER_STRIP_TAG = "taleart-banner-strip"

/** Test tag of each strip item (the first copy of the marquee; the copies that loop are silent). */
const val BANNER_STRIP_ITEM_TAG = "taleart-banner-strip-item"

/** The group whose slide is shown, for tests (`index` in the Web SDK's banner view). */
val BannerShown = SemanticsPropertyKey<String>("TaleartBannerShown")
internal var SemanticsPropertyReceiver.bannerShown by BannerShown

/** True while the banner advances by itself, for tests (`rotating` in the Web SDK's banner view). */
val BannerRotating = SemanticsPropertyKey<Boolean>("TaleartBannerRotating")
internal var SemanticsPropertyReceiver.bannerRotating by BannerRotating

/** The banner's variant by its key (`variant` in banner.schema.json), for tests. */
val BannerVariantShown = SemanticsPropertyKey<String>("TaleartBannerVariant")
internal var SemanticsPropertyReceiver.bannerVariantShown by BannerVariantShown

/** A slide's position for screen readers, as the Web SDK's slide label: `1 of 3`. */
fun bannerSlideLabel(index: Int, count: Int, translate: Translate = defaultTranslate): String =
    translate("banner.slideOf", mapOf("index" to index + 1, "count" to count))

/** A dot's name, as in the Web SDK: `Show <group title>`. */
fun bannerDotLabel(name: String, translate: Translate = defaultTranslate): String = translate("banner.showGroup", mapOf("name" to name))

/** The rotation button's name, as in the Web SDK. */
fun bannerRotationLabel(rotating: Boolean, translate: Translate = defaultTranslate): String =
    if (rotating) translate("banner.stopRotation") else translate("banner.startRotation")

/** The call to action on a slide, and the sticky banner's subtitle. */
fun bannerWatchLabel(translate: Translate = defaultTranslate): String = translate("banner.watch")

/** The sticky banner's dismiss button's name. */
fun bannerDismissLabel(translate: Translate = defaultTranslate): String = translate("banner.dismiss")

// The banner's fixed look (BANNER_STYLES in the Web SDK) comes from the theme's palette.
private const val DEFAULT_RADIUS = 12
private const val ROUND_BUTTON_DP = 48
private const val TITLE_SP = 26

// A slide shorter than this (in dp) gets the compact title.
private const val COMPACT_TITLE_DP = 150

// The start inset of a slide's title when the previous button is there: the button (48dp) and its 8dp margin.
private const val ARROW_CLEAR_DP = 64

private object BannerIcons {
    const val PREV = "M15.4 7.4 14 6l-6 6 6 6 1.4-1.4-4.6-4.6z"
    const val NEXT = "M8.6 16.6 10 18l6-6-6-6-1.4 1.4 4.6 4.6z"
    const val PAUSE = "M6 5h4v14H6zM14 5h4v14h-4z"
    const val PLAY = "M7 4.5v15L19.5 12z"
}

/**
 * A zone's banner display (web zones R3), as libs/web-sdk/src/lib/banner.ts draws it, in the variant
 * the [settings] name: a carousel by default with one slide per tale group that has a tale, in the
 * delivered order, each showing the group's default cover ([defaultCoverSource]) with its name and a
 * "Watch stories" call to action on a scrim, cut to the display's aspect ratio. The variants are
 * [BannerVariant]'s: coverflow, peek and deck show the slides beside the shown one; sticky is a compact
 * bar pinned to the bottom of its host, dismissible for the rest of the process; strip is a marquee.
 *
 * Carousel, coverflow, peek and deck have previous and next buttons (48dp), swipe, dots (the shown
 * one a longer pill that grows from the start edge) and autoplay as the settings say. A tap on the
 * shown slide calls [onGroupClick] with its group. Autoplay runs only with the `autoplay` setting, two
 * or more slides and no preference for reduced motion ([reducedMotion], followed live); an interaction
 * (a tap or a sideways drag on the slides, a button, a dot, focus) stops it, and the rotation button
 * starts it again. Unlike the web banner, where any pointerdown stops it, a vertical scroll that starts
 * on the banner leaves it playing. Without `loop` it stops on the last slide. The project's [theme]
 * sets the background, the slides' corner radius (12dp by default) and the dots' colour; [titleStyle]'s
 * colour is the shown dot's colour when the theme has no title colour, as the web banner takes the host
 * page's text colour.
 *
 * The carousel fills the width it is given. Its height is 16dp (8 above, 8 below) plus the width divided
 * by the aspect ratio (16:9, 3:1 or 1:1), plus, when it has two or more slides and shows dots or
 * autoplays, a 4dp gap and a row of 48dp (with the rotation button) or 24dp (dots only). Sticky and
 * strip take their own height.
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
    ProvideTaleartDirection {
        key(slides) {
            when (settings.variant) {
                BannerVariant.Sticky -> StickyBanner(slides, settings, theme, onGroupClick, modifier, titleStyle, reducedMotion, show, onShowDone)
                BannerVariant.Strip -> StripBanner(slides, theme, onGroupClick, modifier, titleStyle, reducedMotion, show, onShowDone)
                else -> SlideBanner(slides, settings, theme, onGroupClick, modifier, titleStyle, reducedMotion, show, onShowDone)
            }
        }
    }
}

/** What the slides of a banner draw with: the palette, corner radius, text style, images and the direction. */
internal class BannerViewContext(
    val palette: ThemeColors,
    val radius: Int,
    val titleStyle: TextStyle,
    val loader: ImageLoader,
    val rtl: Boolean,
    val translate: Translate,
    /** True when the previous and next buttons sit on the slides' start and end edges (more than one slide). */
    val arrows: Boolean,
    /** A tap on a slide: the playback stops, and the group opens. */
    val open: (DeliveryTaleGroup) -> Unit,
)

// The carousel and the variants that keep one slide shown: a viewport of the aspect ratio, the track,
// the buttons, then a row for the rotation button and the dots.
@Composable
private fun SlideBanner(
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
    val variant = settings.variant
    val playback = rememberBannerPlayback(slides, settings, reducedMotion, loop = settings.loop, show = show, onShowDone = onShowDone)
    val count = playback.count
    val rtl = LocalLayoutDirection.current == LayoutDirection.Rtl
    val translate = LocalTaleartContext.current.translate
    val palette = theme.colors(titleStyle.color, rememberPrefersDarkScheme())
    val radius = theme.cornerRadius ?: DEFAULT_RADIUS
    val background = parseHexColor(theme.backgroundColor)
    val dotColor = parseHexColor(theme.titleColor)
    val hostColor = titleStyle.color.takeUnless { it == Color.Unspecified } ?: palette.ink
    val onClick by rememberUpdatedState(onGroupClick)
    val view = BannerViewContext(
        palette = palette,
        radius = radius,
        titleStyle = titleStyle,
        loader = rememberCoverImageLoader(),
        rtl = rtl,
        translate = translate,
        arrows = count > 1,
        open = { group -> playback.interact(); onClick(group) },
    )
    val rotating = playback.rotating
    val aspect = settings.aspectRatio.widthOverHeight

    Column(
        modifier
            .fillMaxWidth()
            .testTag(BANNER_TAG)
            .semantics {
                isTraversalGroup = true
                // aria-label "Banner" on the carousel.
                contentDescription = translate("banner.label")
                bannerShown = slides[playback.index].id
                bannerRotating = rotating
                bannerVariantShown = variant.key
            }
            // The web banner's 8px margin lies outside its background.
            .padding(vertical = 8.dp)
            .then(if (background != null) Modifier.background(background) else Modifier),
    ) {
        BoxWithConstraints(
            Modifier
                .fillMaxWidth()
                .aspectRatio(aspect)
                .clip(RoundedCornerShape(radius.dp))
                .background(palette.surface)
                .testTag(BANNER_VIEWPORT_TAG)
                .bannerSwipe(playback, rtl),
        ) {
            when (variant) {
                BannerVariant.Coverflow -> CoverflowTrack(playback, view, aspect)
                BannerVariant.Peek -> PeekTrack(playback, view, aspect)
                BannerVariant.Deck -> DeckTrack(playback, view, aspect)
                else -> CarouselTrack(playback, view)
            }
            if (count > 1) {
                RoundButton(
                    colors = palette,
                    label = translate("banner.previousSlide"),
                    icon = BannerIcons.PREV,
                    mirrored = rtl,
                    disabled = !playback.loop && playback.index == 0,
                    modifier = Modifier.align(Alignment.CenterStart).padding(start = 8.dp).then(playback.stopsOnFocus),
                ) {
                    playback.interact()
                    playback.step(-1)
                }
                RoundButton(
                    colors = palette,
                    label = translate("banner.nextSlide"),
                    icon = BannerIcons.NEXT,
                    mirrored = rtl,
                    disabled = playback.atEnd,
                    modifier = Modifier.align(Alignment.CenterEnd).padding(end = 8.dp).then(playback.stopsOnFocus),
                ) {
                    playback.interact()
                    playback.step(1)
                }
            }
        }
        val canRotate = playback.canRotate
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
                        colors = palette,
                        label = bannerRotationLabel(rotating, translate),
                        icon = if (rotating) BannerIcons.PAUSE else BannerIcons.PLAY,
                        mirrored = false,
                        // Nothing to start on the last slide without loop.
                        disabled = !rotating && playback.atEnd,
                    ) {
                        if (rotating) playback.stopped = true else if (!playback.atEnd) playback.stopped = false
                    }
                }
                if (showDots) {
                    Row {
                        slides.forEachIndexed { n, group ->
                            Dot(
                                muted = palette.muted,
                                label = bannerDotLabel(group.name, translate),
                                current = n == playback.index,
                                themed = dotColor,
                                host = hostColor,
                                modifier = playback.stopsOnFocus,
                            ) {
                                playback.interact()
                                playback.select(n)
                            }
                        }
                    }
                }
            }
        }
    }
}

/** A swipe toward the start of the line (left, or right in right to left) shows the next slide; a swipe is never a tap. */
private fun Modifier.bannerSwipe(playback: BannerPlayback, rtl: Boolean): Modifier = pointerInput(playback, rtl) {
    val swipe = SWIPE_MIN_DP.dp.toPx()
    val slop = viewConfiguration.touchSlop
    awaitEachGesture {
        // Seen before the slide's button, so a swipe can take the tap from it.
        val down = awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
        // Unlike the web banner, whose pointerdown stops autoplay, a touch stops it only once it drags
        // sideways (a tap stops it through the slide's button): a page scrolled by a finger that lands on
        // the banner keeps it playing.
        var swiped = false
        while (true) {
            val event = awaitPointerEvent(PointerEventPass.Initial)
            val change = event.changes.firstOrNull { it.id == down.id } ?: break
            val dx = change.position.x - down.position.x
            val dy = change.position.y - down.position.y
            if (!playback.stopped && abs(dx) > slop && abs(dx) > abs(dy)) playback.interact()
            if (!swiped && abs(dx) >= swipe && abs(dx) > abs(dy)) swiped = true
            if (swiped) change.consume()
            if (!change.pressed) {
                if (swiped) playback.step(if ((dx < 0) != rtl) 1 else -1)
                break
            }
        }
    }
}

/** The modifier of the shown slide: its button (opens the group), its name, state and live region. */
internal fun shownSlideModifier(playback: BannerPlayback, n: Int, group: DeliveryTaleGroup, view: BannerViewContext): Modifier =
    Modifier
        .testTag(BANNER_SLIDE_TAG)
        .focusRequester(playback.focusers[n])
        .then(playback.stopsOnFocus)
        .clickable(role = Role.Button) { view.open(group) }
        .semantics {
            contentDescription = group.name
            stateDescription = bannerSlideLabel(n, playback.count, view.translate)
            // Screen readers hear the slide shown only when the person changes it.
            if (!playback.rotating) liveRegion = LiveRegionMode.Polite
        }

/** A slide that is not the shown one: hidden from screen readers; a tap on it shows it (the Web SDK's neighbours). */
internal fun neighbourModifier(playback: BannerPlayback, n: Int): Modifier =
    Modifier
        .semantics { hideFromAccessibility() }
        .testTag(BANNER_NEIGHBOUR_TAG)
        .pointerInput(playback, n) {
            detectTapGestures {
                playback.interact()
                playback.select(n)
            }
        }

/** A slide's picture, and on the shown slide, the name and call to action on a scrim. */
@Composable
internal fun SlideContent(group: DeliveryTaleGroup, view: BannerViewContext, showTitle: Boolean) {
    Box(Modifier.fillMaxSize()) {
        SlideMedia(group, view.loader, view.palette.surface)
        if (showTitle) SlideTitle(group.name, view.palette, view.titleStyle, view.translate, view.arrows)
    }
}

// The name and a "Watch stories" button over the foot of the slide, on a scrim of a neutral the colour
// scheme owns (the ink on light, the card ground on dark) with the text picked for contrast on it. A small
// card (the coverflow's, the deck's, the peek's) keeps both in less room: smaller type and tighter spacing.
@Composable
private fun SlideTitle(name: String, palette: ThemeColors, titleStyle: TextStyle, translate: Translate, arrows: Boolean) {
    val scrim = if (palette.dark) palette.paper else palette.ink
    val onScrim = onAccentColor(scrim)
    BoxWithConstraints(
        Modifier
            .fillMaxSize()
            .background(Brush.verticalGradient(0.3f to Color.Transparent, 1f to scrim.copy(alpha = 0.85f))),
        contentAlignment = Alignment.BottomStart,
    ) {
        val compact = maxHeight < COMPACT_TITLE_DP.dp
        Column(
            // Clear of the previous button, which sits on the start edge.
            Modifier.padding(
                start = if (arrows) ARROW_CLEAR_DP.dp else if (compact) 10.dp else 16.dp,
                end = if (compact) 10.dp else 16.dp,
                top = if (compact) 8.dp else 24.dp,
                bottom = if (compact) 10.dp else 16.dp,
            ),
            verticalArrangement = Arrangement.spacedBy(if (compact) 4.dp else 8.dp),
        ) {
            BasicText(
                name,
                style = titleStyle.copy(color = onScrim, fontSize = (if (compact) 16 else TITLE_SP).sp, fontWeight = FontWeight.ExtraBold),
            )
            Box(
                Modifier
                    .clip(RoundedCornerShape(50))
                    .background(palette.accent)
                    .padding(horizontal = if (compact) 10.dp else 14.dp, vertical = if (compact) 4.dp else 8.dp),
            ) {
                BasicText(
                    bannerWatchLabel(translate),
                    style = TextStyle(color = palette.onAccent, fontSize = (if (compact) 11 else 14).sp, fontWeight = FontWeight.SemiBold),
                )
            }
        }
    }
}

@Composable
internal fun SlideMedia(group: DeliveryTaleGroup, loader: ImageLoader, surface: Color) {
    val source = remember(group) { defaultCoverSource(group) }
    val placeholder = (source as? CoverSource.Placeholder)?.color?.let(::parseHexColor) ?: surface
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

// A round control with a 24dp icon (`.b-btn` in the Web SDK), 48dp to touch. A disabled one (aria-disabled)
// stays a button, dimmed, whose tap still counts as an interaction.
@Composable
private fun RoundButton(
    colors: ThemeColors,
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
            .size(ROUND_BUTTON_DP.dp)
            .alpha(if (disabled) 0.4f else 1f)
            .clip(CircleShape)
            .background(colors.paper.copy(alpha = 0.92f))
            .border(1.dp, colors.muted, CircleShape)
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
                drawPath(path, colors.ink)
            }
        }
    }
}

// A dot: a 24dp target around a pill, 8dp wide, the shown slide's 20dp in the host's text colour (it grows
// from the start edge); with a theme title colour, rings of it, the shown one filled.
@Composable
private fun Dot(label: String, current: Boolean, themed: Color?, host: Color, muted: Color, modifier: Modifier, onClick: () -> Unit) {
    val pill by animateDpAsState(dotPillDp(current).dp)
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
        Box(
            Modifier
                .width(pill)
                .height(DOT_HEIGHT_DP.dp)
                .clip(CircleShape)
                .background(if (current) themed ?: host else themed?.copy(alpha = 0.35f) ?: muted),
        )
    }
}

private const val DOT_HEIGHT_DP = 8
