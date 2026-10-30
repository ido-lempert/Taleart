package site.lempert.taleart.sdk.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import site.lempert.taleart.sdk.delivery.DeliveryTaleGroup

/**
 * Remembers, for the rest of the process, the sticky banners the person dismissed, by the slides they
 * showed (see [stickyKey]): a new set of groups shows the banner again. Read and written on the main
 * thread only, like the banner's other state.
 */
internal object BannerDismissals {
    private val keys = mutableSetOf<String>()

    fun contains(key: String): Boolean = key in keys

    fun add(key: String) {
        keys += key
    }
}

// The dismiss button's cross: 20dp in a 48dp target.
private const val DISMISS_ICON_DP = 20
private const val STICKY_THUMB_DP = 56

/**
 * The sticky banner: a compact card of the shown slide (a thumbnail, its name and "Watch stories") at
 * the bottom of its host, above the system's bottom bar (the safe area), with a dismiss button of 48dp.
 * It cycles through the slides by autoplay as the settings say; a tap on the card opens the shown group.
 * Dismissing it removes it for the rest of the process ([BannerDismissals]). It ignores the aspect ratio,
 * the dots and loop: it always loops, and stops on a tap, as the other slides do.
 */
@Composable
internal fun StickyBanner(
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
    val key = remember(slides) { stickyKey(slides.map { it.id }) }
    // The playback is set up before the dismissal is read, so a request made to it is consumed either way.
    val playback = rememberBannerPlayback(slides, settings, reducedMotion, loop = true, show = show, onShowDone = onShowDone)
    var dismissed by remember(key) { mutableStateOf(BannerDismissals.contains(key)) }
    val palette = theme.colors(titleStyle.color, rememberPrefersDarkScheme())
    val translate = LocalTaleartContext.current.translate
    val loader = rememberCoverImageLoader()
    val onClick by rememberUpdatedState(onGroupClick)
    if (dismissed) return

    val index = playback.index
    val group = slides[index]
    Box(
        modifier
            .fillMaxWidth()
            .testTag(BANNER_TAG)
            .semantics {
                contentDescription = translate("banner.label")
                bannerShown = group.id
                bannerRotating = playback.rotating
                bannerVariantShown = BannerVariant.Sticky.key
            },
        contentAlignment = Alignment.BottomCenter,
    ) {
        Row(
            Modifier
                .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Bottom + WindowInsetsSides.Horizontal))
                .padding(12.dp)
                .fillMaxWidth()
                .clip(RoundedCornerShape(16.dp))
                .background(palette.paper)
                .border(1.dp, palette.muted, RoundedCornerShape(16.dp))
                .padding(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Row(
                Modifier
                    .weight(1f)
                    .heightIn(min = 48.dp)
                    .testTag(BANNER_SLIDE_TAG)
                    .focusRequester(playback.focusers[index])
                    .then(playback.stopsOnFocus)
                    .clickable(role = Role.Button) {
                        playback.interact()
                        onClick(group)
                    }
                    .semantics {
                        contentDescription = group.name
                        stateDescription = bannerSlideLabel(index, playback.count, translate)
                        if (!playback.rotating) liveRegion = LiveRegionMode.Polite
                    },
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(Modifier.size(STICKY_THUMB_DP.dp).clip(RoundedCornerShape(12.dp))) {
                    SlideMedia(group, loader, palette.surface)
                }
                Spacer(Modifier.width(12.dp))
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    BasicText(group.name, style = titleStyle.copy(color = palette.ink, fontSize = 16.sp, fontWeight = FontWeight.Bold))
                    BasicText(bannerWatchLabel(translate), style = TextStyle(color = palette.muted, fontSize = 13.sp))
                }
            }
            Box(
                Modifier
                    .testTag(BANNER_DISMISS_TAG)
                    .size(48.dp)
                    .clip(CircleShape)
                    .clickable(role = Role.Button) {
                        playback.interact()
                        BannerDismissals.add(key)
                        dismissed = true
                    }
                    .semantics { contentDescription = bannerDismissLabel(translate) },
                contentAlignment = Alignment.Center,
            ) {
                Canvas(Modifier.size(DISMISS_ICON_DP.dp)) {
                    val s = size.width
                    val stroke = 2.dp.toPx()
                    drawLine(palette.ink, Offset(s * 0.2f, s * 0.2f), Offset(s * 0.8f, s * 0.8f), strokeWidth = stroke, cap = StrokeCap.Round)
                    drawLine(palette.ink, Offset(s * 0.8f, s * 0.2f), Offset(s * 0.2f, s * 0.8f), strokeWidth = stroke, cap = StrokeCap.Round)
                }
            }
        }
    }
}
