package site.lempert.taleart.sdk.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.CircleShape
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
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.LayoutDirection
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

// The bar's height, and the room the slide's content keeps clear of the previous and next buttons (`padding: 0 60px`).
private const val STICKY_HEIGHT_DP = 64
private const val STICKY_COVER_DP = 44
private const val STICKY_CONTENT_INSET_DP = 60

/**
 * The sticky banner, as the Web SDK draws it: a full-width bar on the card ground with a soft shadow above it, at
 * the bottom of its host and above the system's bottom bar (the safe area). It is 64dp high: the previous and next
 * buttons (44dp, when there are two slides or more) at its two edges, between them the shown slide's round 44dp
 * cover and its name, and a 44dp dismiss button after them (all in 48dp targets). It has no subtitle.
 * It cycles through the slides by autoplay as the settings say; a tap on the slide opens the shown group.
 * Dismissing it removes it for the rest of the process ([BannerDismissals]). It ignores the aspect ratio,
 * the dots and loop: it always loops, and stops on a tap, as the other slides do. Unlike the Web SDK's, it has no
 * rotation button: the autoplay stops on the first touch, and the previous and next buttons move it by hand.
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
    val rtl = LocalLayoutDirection.current == LayoutDirection.Rtl
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
                .fillMaxWidth()
                // The web's `0 -4px 16px` ink at 12 %: a soft lift from the platform's own shadow (the bar sits at the
                // foot of the page, so the light falls from below).
                .shadow(elevation = 14.dp, shape = RectangleShape, clip = false, ambientColor = palette.ink.copy(alpha = 0.12f), spotColor = palette.ink.copy(alpha = 0.12f))
                .background(palette.paper)
                .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Bottom + WindowInsetsSides.Horizontal))
                .padding(horizontal = 8.dp, vertical = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.weight(1f).height(STICKY_HEIGHT_DP.dp)) {
                Row(
                    Modifier
                        .fillMaxSize()
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
                        }
                        .padding(horizontal = STICKY_CONTENT_INSET_DP.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterHorizontally),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(Modifier.size(STICKY_COVER_DP.dp).clip(CircleShape)) {
                        SlideMedia(group, loader, palette.surface)
                    }
                    BasicText(
                        group.name,
                        style = titleStyle.copy(color = palette.title, fontSize = 16.sp, fontWeight = FontWeight.SemiBold),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                }
                if (playback.count > 1) {
                    RoundButton(
                        colors = palette,
                        label = translate("banner.previousSlide"),
                        icon = BannerIcons.PREV,
                        mirrored = rtl,
                        disabled = false,
                        modifier = Modifier.align(Alignment.CenterStart).padding(start = ARROW_EDGE_DP.dp).then(playback.stopsOnFocus),
                    ) {
                        playback.interact()
                        playback.step(-1)
                    }
                    RoundButton(
                        colors = palette,
                        label = translate("banner.nextSlide"),
                        icon = BannerIcons.NEXT,
                        mirrored = rtl,
                        disabled = false,
                        modifier = Modifier.align(Alignment.CenterEnd).padding(end = ARROW_EDGE_DP.dp).then(playback.stopsOnFocus),
                    ) {
                        playback.interact()
                        playback.step(1)
                    }
                }
            }
            RoundButton(
                colors = palette,
                label = bannerDismissLabel(translate),
                icon = BannerIcons.CLOSE,
                mirrored = false,
                disabled = false,
                modifier = Modifier.testTag(BANNER_DISMISS_TAG),
            ) {
                playback.interact()
                BannerDismissals.add(key)
                dismissed = true
            }
        }
    }
}
