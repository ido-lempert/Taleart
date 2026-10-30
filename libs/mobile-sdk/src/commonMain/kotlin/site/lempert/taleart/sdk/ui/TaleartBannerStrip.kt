package site.lempert.taleart.sdk.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.BoxWithConstraintsScope
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import site.lempert.taleart.sdk.delivery.DeliveryTaleGroup

/**
 * The strip: a continuous marquee of the groups' names and covers, scrolling at a fixed speed (one
 * loop of [STRIP_LOOP_MS] however many groups there are), toward the start of the line: left in left to
 * right, right in right to left. A press on it pauses the scroll until it is lifted. A tap on an item
 * opens its group.
 *
 * It ignores autoplay, the interval, loop, the dots and the aspect ratio. Under reduced motion it does
 * not move: the items sit in a row the person scrolls sideways instead. Its copies are one viewport wide
 * at least, so the line never runs out; the copy after the first is silent for screen readers.
 */
@Composable
internal fun StripBanner(
    slides: List<DeliveryTaleGroup>,
    theme: TaleartTheme,
    onGroupClick: (DeliveryTaleGroup) -> Unit,
    modifier: Modifier,
    titleStyle: TextStyle,
    reducedMotion: Boolean,
    show: BannerShowRequest?,
    onShowDone: (BannerShowRequest) -> Unit,
) {
    val context = LocalTaleartContext.current
    val translate = context.translate
    val palette = theme.colors(titleStyle.color, rememberPrefersDarkScheme())
    val loader = rememberCoverImageLoader()
    val onClick by rememberUpdatedState(onGroupClick)
    val done by rememberUpdatedState(onShowDone)
    // The strip shows every group at once, so a viewer's return has no slide to take up: the request is consumed.
    show?.let { request -> SideEffect { done(request) } }

    // Each group is an impression once, the first time the strip shows it.
    val impressed = remember(slides) { mutableSetOf<String>() }
    LaunchedEffect(slides) {
        slides.forEach { group -> if (impressed.add(group.id)) context.impression(groupRef(slides, group)) }
    }

    var paused by remember { mutableStateOf(false) }
    val pausedNow by rememberUpdatedState(paused)
    // The motion so far, in nanoseconds; advanced per frame while the strip moves (read in layout only).
    var elapsedNanos by remember { mutableLongStateOf(0L) }
    LaunchedEffect(reducedMotion) {
        if (reducedMotion) return@LaunchedEffect
        var last = -1L
        while (true) {
            withFrameNanos { now ->
                if (last >= 0L && !pausedNow) elapsedNanos += now - last
                last = now
            }
        }
    }

    val moving = !reducedMotion && !paused
    BoxWithConstraints(
        modifier
            .fillMaxWidth()
            // The banner's 8dp margin, then the strip: the surface colour and the corner radius (`.b-strip`).
            .padding(vertical = 8.dp)
            .clip(RoundedCornerShape((theme.cornerRadius ?: STRIP_DEFAULT_RADIUS).dp))
            .background(palette.surface)
            .testTag(BANNER_TAG)
            .semantics {
                contentDescription = translate("banner.label")
                bannerRotating = moving
                bannerVariantShown = BannerVariant.Strip.key
            }
            .pointerInput(Unit) {
                // Seen before the items, which may take the press for their own taps: any press holds the strip.
                awaitEachGesture {
                    awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
                    paused = true
                    var pressed = true
                    while (pressed) {
                        val event = awaitPointerEvent(PointerEventPass.Initial)
                        pressed = event.changes.any { it.pressed }
                    }
                    paused = false
                }
            },
    ) {
        if (reducedMotion) {
            Row(Modifier.horizontalScroll(rememberScrollState()).padding(vertical = STRIP_PAD_DP.dp)) {
                StripItems(slides, palette, titleStyle, loader, translate, tagged = true) { onClick(it) }
            }
        } else {
            StripMarquee(slides, palette, titleStyle, loader, translate, elapsedNanos) { onClick(it) }
        }
    }
}

// The moving line: two copies of the items, each at least one viewport wide, offset by the time's share of a loop.
@Composable
private fun BoxWithConstraintsScope.StripMarquee(
    slides: List<DeliveryTaleGroup>,
    palette: ThemeColors,
    titleStyle: TextStyle,
    loader: coil3.ImageLoader,
    translate: site.lempert.taleart.sdk.i18n.Translate,
    elapsedNanos: Long,
    open: (DeliveryTaleGroup) -> Unit,
) {
    val viewport = maxWidth
    var copyWidth by remember { mutableIntStateOf(0) }
    Row(
        Modifier
            .wrapContentWidth(Alignment.Start, unbounded = true)
            .offset { IntOffset(stripOffsetPx(elapsedNanos, copyWidth), 0) }
            .padding(vertical = STRIP_PAD_DP.dp),
    ) {
        Row(Modifier.defaultMinSize(minWidth = viewport).onSizeChanged { copyWidth = it.width }) {
            StripItems(slides, palette, titleStyle, loader, translate, tagged = true, open = open)
        }
        Row(Modifier.defaultMinSize(minWidth = viewport).clearAndSetSemantics {}) {
            StripItems(slides, palette, titleStyle, loader, translate, tagged = false, open = open)
        }
    }
}

// One copy of the items: a round cover (36dp) and the name in a pill at least 44dp high (48dp to touch), 24dp apart,
// the copy padded 12dp at both ends.
@Composable
private fun StripItems(
    slides: List<DeliveryTaleGroup>,
    palette: ThemeColors,
    titleStyle: TextStyle,
    loader: coil3.ImageLoader,
    translate: site.lempert.taleart.sdk.i18n.Translate,
    tagged: Boolean,
    open: (DeliveryTaleGroup) -> Unit,
) {
    Row(Modifier.padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(24.dp)) {
        slides.forEach { group ->
            val item = if (tagged) Modifier.testTag(BANNER_STRIP_ITEM_TAG).semantics { contentDescription = group.name } else Modifier
            Row(
                item
                    .heightIn(min = 48.dp)
                    .clip(RoundedCornerShape(50))
                    .clickable(role = Role.Button) { open(group) }
                    .padding(start = 4.dp, end = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(Modifier.size(36.dp).clip(CircleShape)) { SlideMedia(group, loader, palette.surface) }
                Spacer(Modifier.width(10.dp))
                // The host's font and weight, in the title colour (`font: inherit; color: var(--ta-title, inherit)`).
                BasicText(group.name, style = titleStyle.copy(color = palette.title, fontSize = 16.sp), maxLines = 1)
            }
        }
    }
}

// The strip's default corner radius, and the room above and below its items: 2dp and the 48dp target make the Web SDK's
// 4px around 44px.
private const val STRIP_DEFAULT_RADIUS = 12
private const val STRIP_PAD_DP = 2
