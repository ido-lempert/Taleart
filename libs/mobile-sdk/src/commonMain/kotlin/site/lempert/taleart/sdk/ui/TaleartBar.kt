package site.lempert.taleart.sdk.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsPropertyKey
import androidx.compose.ui.semantics.SemanticsPropertyReceiver
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.ImageLoader
import coil3.PlatformContext
import coil3.compose.AsyncImage
import coil3.compose.LocalPlatformContext
import coil3.network.ktor3.KtorNetworkFetcherFactory
import site.lempert.taleart.sdk.delivery.DeliveryTaleGroup
import site.lempert.taleart.sdk.i18n.Translate
import site.lempert.taleart.sdk.i18n.defaultTranslate
import site.lempert.taleart.sdk.delivery.platformHttpClient

/** Test tag of each bar item. */
const val BAR_ITEM_TAG = "taleart-bar-item"

/** Test tag of the bar's row. */
const val BAR_TAG = "taleart-bar"

// The bar's fixed look (BAR_STYLES in the Web SDK): the neutral cover behind a picture, the cover's
// edge when the theme has no background colour, the gap between ring and title, the title's type.
private val COVER_PLACEHOLDER = Color(0xFFE5E7EB)
private val COVER_EDGE = Color.White
private const val DEFAULT_RING_WIDTH = 2

/** The title a bar item shows under its cover; accessibility services never read it (the item's name does). */
val BarTitle = SemanticsPropertyKey<String>("TaleartBarTitle")
private var SemanticsPropertyReceiver.barTitle by BarTitle

/** The accessible name of a bar item, as `setItemSeen` in the Web SDK: the group's title, and `, seen` once viewed. */
fun barItemLabel(name: String, seen: Boolean, translate: Translate = defaultTranslate): String =
    if (seen) translate("bar.seen", mapOf("name" to name)) else name

/**
 * A zone's bar display (web zones R2): one item per tale group in the delivered order, each the
 * group's cover in a ring with its title under it, styled by the display's [settings] and the
 * project's [theme] as libs/web-sdk/src/lib/bar.ts and theme.ts style it. Groups in [seen] show
 * the seen ring. [titleStyle] carries the host's font and title colour, which apply where the
 * theme leaves them unset.
 *
 * It fills the width it is given and scrolls sideways. Its height is 8dp of padding plus the cover
 * size (48, 64 or 80dp), plus, when titles show, 6dp and one or two 16dp title lines: at most
 * 126dp (large covers, two-line titles).
 */
@Composable
fun TaleartBar(
    groups: List<DeliveryTaleGroup>,
    settings: BarSettings,
    theme: TaleartTheme,
    seen: Set<String>,
    onGroupClick: (DeliveryTaleGroup) -> Unit,
    modifier: Modifier = Modifier,
    titleStyle: TextStyle = TextStyle.Default,
) {
    val translate = LocalTaleartContext.current.translate
    val edge = settings.size.edgeDp
    val none = theme.ringStyle == RingStyle.None
    val ringWidth = if (none) 0 else theme.ringWidth
    val ringBrush: Brush = when {
        none -> SolidColor(Color.Transparent)
        theme.ringStyle == RingStyle.Solid || theme.ringColors.size == 1 -> SolidColor(parseHexColor(theme.ringColors.first()) ?: Color.Transparent)
        else -> gradient45(theme.ringColors.mapNotNull(::parseHexColor))
    }
    val seenBrush: Brush = SolidColor(if (none) Color.Transparent else parseHexColor(theme.seenRingColor) ?: Color.Gray)
    val background = parseHexColor(theme.backgroundColor)
    val coverEdge = background ?: COVER_EDGE
    // A rounded square's radius: the theme's, else a quarter of the item; the cover's sits inside the ring.
    val radius = theme.cornerRadius ?: (edge / 4)
    val ringShape: Shape = if (settings.shape == BarShape.Circle) CircleShape else RoundedCornerShape(radius.dp)
    val coverShape: Shape =
        if (settings.shape == BarShape.Circle) CircleShape else RoundedCornerShape(maxOf(0, radius - (if (none) 0 else theme.ringWidth)).dp)
    val title = titleStyle.merge(
        TextStyle(
            color = parseHexColor(theme.titleColor) ?: titleStyle.color.takeOrElse(Color.Black),
            fontFamily = rememberFontFamily(theme.fontFamily) ?: titleStyle.fontFamily,
            fontSize = 12.sp,
            lineHeight = 16.sp,
            textAlign = TextAlign.Center,
        ),
    )
    val loader = rememberCoverImageLoader()

    BoxWithConstraints(modifier.fillMaxWidth()) {
        val arrangement = if (settings.alignment == BarAlignment.Center) {
            Arrangement.spacedBy(settings.gap.dp, Alignment.CenterHorizontally)
        } else {
            Arrangement.spacedBy(settings.gap.dp)
        }
        Row(
            modifier = Modifier
                .testTag(BAR_TAG)
                .then(if (background != null) Modifier.background(background) else Modifier)
                .horizontalScroll(rememberScrollState())
                // At least the bar's width, so a centred row centres in it.
                .widthIn(min = maxWidth)
                .padding(4.dp),
            horizontalArrangement = arrangement,
        ) {
            for (group in groups) {
                val isSeen = group.id in seen
                Column(
                    modifier = Modifier
                        .testTag(BAR_ITEM_TAG)
                        .width((edge + 12).dp)
                        .sizeIn(minWidth = 48.dp, minHeight = 48.dp)
                        // One focusable button named by its group (the cover and title below say nothing more).
                        .clickable(role = Role.Button) { onGroupClick(group) }
                        .semantics { contentDescription = barItemLabel(group.name, isSeen, translate) },
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Box(
                        Modifier
                            .size(edge.dp)
                            .clip(ringShape)
                            .background(if (isSeen) seenBrush else ringBrush)
                            .padding(ringWidth.dp),
                    ) {
                        Cover(group, coverShape, coverEdge, loader)
                    }
                    if (settings.showTitles) {
                        BasicText(
                            group.name,
                            style = title,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                            // The item's name already says it (aria-hidden in the Web SDK); only tests read BarTitle.
                            modifier = Modifier.fillMaxWidth().clearAndSetSemantics { barTitle = group.name },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun Cover(group: DeliveryTaleGroup, shape: Shape, edge: Color, loader: ImageLoader) {
    val source = remember(group) { coverSource(group) }
    val placeholder = (source as? CoverSource.Placeholder)?.color?.let(::parseHexColor) ?: COVER_PLACEHOLDER
    // A cover's image loads over the neutral placeholder; a failed load leaves the placeholder.
    Box(
        Modifier
            .fillMaxSize()
            .clip(shape)
            .background(placeholder)
            .border(DEFAULT_RING_WIDTH.dp, edge, shape),
    ) {
        if (source is CoverSource.Image) {
            AsyncImage(
                model = source.url,
                contentDescription = null,
                imageLoader = loader,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize().padding(DEFAULT_RING_WIDTH.dp).clip(shape),
            )
        }
    }
}

// CSS `linear-gradient(45deg, …)` on a square: from the bottom-left corner to the top-right one.
// (An infinite coordinate is the brush's full width or height.)
private fun gradient45(colors: List<Color>): Brush = when (colors.size) {
    0 -> SolidColor(Color.Transparent)
    1 -> SolidColor(colors.first())
    else -> Brush.linearGradient(colors, start = Offset(0f, Float.POSITIVE_INFINITY), end = Offset(Float.POSITIVE_INFINITY, 0f))
}

private fun Color.takeOrElse(fallback: Color): Color = if (this == Color.Unspecified) fallback else this

// One image loader for every bar: Coil over the SDK's Ktor client (no cookies), with Coil's caches.
private var coverImageLoader: ImageLoader? = null

/** The loader of cover images, when not the SDK's own: tests provide one on a fake server. */
internal val LocalCoverImageLoader = staticCompositionLocalOf<ImageLoader?> { null }

@Composable
internal fun rememberCoverImageLoader(): ImageLoader {
    LocalCoverImageLoader.current?.let { return it }
    val context: PlatformContext = LocalPlatformContext.current
    return remember(context) {
        coverImageLoader ?: ImageLoader.Builder(context)
            .components { add(KtorNetworkFetcherFactory(httpClient = { platformHttpClient() })) }
            .build()
            .also { coverImageLoader = it }
    }
}
