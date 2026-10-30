package site.lempert.taleart.sdk.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.LocalIndication
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Outline
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsPropertyKey
import androidx.compose.ui.semantics.SemanticsPropertyReceiver
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.ImageLoader
import coil3.PlatformContext
import coil3.compose.AsyncImage
import coil3.compose.LocalPlatformContext
import coil3.network.ktor3.KtorNetworkFetcherFactory
import kotlinx.coroutines.delay
import site.lempert.taleart.sdk.delivery.DeliveryTaleGroup
import site.lempert.taleart.sdk.delivery.platformHttpClient
import site.lempert.taleart.sdk.i18n.Translate
import site.lempert.taleart.sdk.i18n.defaultTranslate

/** Test tag of each bar item. */
const val BAR_ITEM_TAG = "taleart-bar-item"

/** Test tag of the bar's row (every layout). */
const val BAR_TAG = "taleart-bar"

/** Test tag of the loading skeleton, shown while the zone reads, in the footprint of the bar it replaces. */
const val BAR_SKELETON_TAG = "taleart-bar-skeleton"

/** The width in dp of a ring item beyond its cover: the room its title takes. */
private const val RING_ITEM_EXTRA_DP = 12

/** One full turn of an unseen ring's sweep, in milliseconds. */
internal const val RING_SPIN_MS = 4000

/** The scale of an item while it is pressed (the Web SDK's `active` value). */
internal const val PRESS_SCALE = 0.94f

/** The cover's inner border and the ring's breathing space, in dp (the cover sits inside the ring). */
private const val COVER_BORDER_DP = 2

/** The title a bar item shows under its cover; accessibility services never read it (the item's name does). */
val BarTitle = SemanticsPropertyKey<String>("TaleartBarTitle")
internal var SemanticsPropertyReceiver.barTitle by BarTitle

/** The accessible name of a bar item, as `setItemSeen` in the Web SDK: the group's title, and `, seen` once viewed. */
fun barItemLabel(name: String, seen: Boolean, translate: Translate = defaultTranslate): String =
    if (seen) translate("bar.seen", mapOf("name" to name)) else name

/**
 * A zone's bar display (web zones R2 and P4): one item per tale group in the delivered order, drawn in the
 * display's [settings] layout (`ring`, `chip`, `poster` or `stack`) with the project's [theme]. Groups in
 * [seen] are seen: a ring stops and turns grey, a chip has no dot, a stack opens the next unseen group.
 * [titleStyle] carries the host's font and title colour, which apply where the theme leaves them unset.
 * [reducedMotion] stops every motion of the bar (followed live from the host's setting by default).
 *
 * It fills the width it is given. A ring or a poster row scrolls sideways, a chip row wraps and a stack is one
 * collapsed row. Its height depends on its layout and settings (see [TaleartBarLayouts]).
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
    reducedMotion: Boolean = rememberPrefersReducedMotion(),
) {
    val context = LocalTaleartContext.current
    val palette = theme.colors(titleStyle.color, rememberPrefersDarkScheme())
    // Each group is an impression once per render (the groups list is the render's), when its item is first composed.
    val impressed = remember(groups) { mutableSetOf<String>() }
    val look = BarLook(settings, theme, palette, titleStyle, rememberFontFamily(theme.fontFamily), reducedMotion)
    val items = BarItems(groups, seen, context.translate, impressed, context, look, rememberCoverImageLoader(), onTap = onGroupClick)
    BoxWithConstraints(modifier.fillMaxWidth()) {
        when (settings.layout) {
            BarLayout.Ring -> RingBar(items, maxWidth)
            BarLayout.Chip -> ChipBar(items)
            BarLayout.Poster -> PosterBar(items, maxWidth)
            BarLayout.Stack -> StackBar(items)
        }
    }
}

/** The look of a bar, from the theme, the host and the settings (one value for every item of the bar). */
internal class BarLook(
    val settings: BarSettings,
    val theme: TaleartTheme,
    val palette: ThemeColors,
    val titleStyle: TextStyle,
    val fontFamily: FontFamily?,
    val reducedMotion: Boolean,
) {
    val none: Boolean get() = theme.ringStyle == RingStyle.None
    val ringWidth: Int get() = if (none) 0 else theme.ringWidth

    /** The theme's ring colours that parse (at most three). */
    val ringColors: List<Color> get() = theme.ringColors.mapNotNull(::parseHexColor)

    /** A ring with one colour (or a solid ring) stands still: there is no sweep to turn. */
    val solidRing: Boolean get() = theme.ringStyle == RingStyle.Solid || ringColors.size <= 1

    /** The colour of a seen ring: the theme's seen colour, else the muted ink. */
    val seenColor: Color get() = parseHexColor(theme.seenRingColor) ?: palette.muted

    /** A rounded square's radius: the theme's, else a quarter of the item (the cover's sits inside the ring). */
    val radiusDp: Int get() = theme.cornerRadius ?: (settings.size.edgeDp / 4)

    /** The title in the bar's text style: the palette's colour, 12sp medium, one line of 16sp. */
    fun titleText(): TextStyle = titleStyle.merge(
        TextStyle(
            color = palette.title,
            fontFamily = fontFamily ?: titleStyle.fontFamily,
            fontSize = 12.sp,
            lineHeight = 16.sp,
            fontWeight = FontWeight.Medium,
            textAlign = TextAlign.Center,
        ),
    )
}

/** What every layout's items need: the groups, the seen state, the texts, the impressions, the look and the tap. */
internal class BarItems(
    val groups: List<DeliveryTaleGroup>,
    val seen: Set<String>,
    val translate: Translate,
    val impressed: MutableSet<String>,
    val context: TaleartContext,
    val look: BarLook,
    val loader: ImageLoader,
    val onTap: (DeliveryTaleGroup) -> Unit,
)

/** Reports a group's impression once per render, when its item is first composed. */
@Composable
internal fun ImpressOnce(items: BarItems, group: DeliveryTaleGroup) {
    LaunchedEffect(group.id) {
        if (items.impressed.add(group.id)) items.context.impression(groupRef(items.groups, group))
    }
}

internal const val ENTER_MS = 700
internal const val ENTER_STAGGER_MS = 60L
internal const val ENTER_RISE_DP = 14f
internal val EXPO_OUT = CubicBezierEasing(0.16f, 1f, 0.3f, 1f)

/**
 * The entrance of a bar item: it rises and fades in, [index] times 60 ms after the bar appears, over 700 ms on an
 * expo-out curve. Under reduced motion it is shown at once.
 */
@Composable
internal fun Modifier.enterAt(index: Int, reducedMotion: Boolean): Modifier {
    val progress = remember { Animatable(if (reducedMotion) 1f else 0f) }
    LaunchedEffect(Unit) {
        if (reducedMotion) {
            progress.snapTo(1f)
        } else {
            delay(index * ENTER_STAGGER_MS)
            progress.animateTo(1f, tween(ENTER_MS, easing = EXPO_OUT))
        }
    }
    val density = LocalDensity.current.density
    return graphicsLayer {
        val p = progress.value
        alpha = p
        translationY = (1f - p) * ENTER_RISE_DP * density
        scaleX = 0.9f + 0.1f * p
        scaleY = 0.9f + 0.1f * p
    }
}

/** The scale of an item: [PRESS_SCALE] while it is pressed on a spring, else 1 (and 1 under reduced motion). */
@Composable
internal fun pressedScale(source: MutableInteractionSource, reducedMotion: Boolean): Float {
    val pressed by source.collectIsPressedAsState()
    val scale by animateFloatAsState(
        targetValue = if (pressed && !reducedMotion) PRESS_SCALE else 1f,
        animationSpec = spring(dampingRatio = 0.5f, stiffness = 600f),
        label = "barPress",
    )
    return scale
}

@Composable
private fun RingBar(items: BarItems, maxWidth: Dp) {
    val look = items.look
    val settings = look.settings
    val edge = settings.size.edgeDp
    val shape: Shape = if (settings.shape == BarShape.Circle) CircleShape else RoundedCornerShape(look.radiusDp.dp)
    val coverShape: Shape = if (settings.shape == BarShape.Circle) CircleShape
    else RoundedCornerShape(maxOf(0, look.radiusDp - look.ringWidth).dp)
    val arrangement = if (settings.alignment == BarAlignment.Center) {
        Arrangement.spacedBy(settings.gap.dp, Alignment.CenterHorizontally)
    } else {
        Arrangement.spacedBy(settings.gap.dp)
    }
    val title = look.titleText()
    Row(
        modifier = Modifier
            .testTag(BAR_TAG)
            .then(parseHexColor(look.theme.backgroundColor)?.let { Modifier.background(it) } ?: Modifier)
            .horizontalScroll(rememberScrollState())
            // At least the bar's width, so a centred row centres in it.
            .widthIn(min = maxWidth)
            .padding(4.dp),
        horizontalArrangement = arrangement,
    ) {
        items.groups.forEachIndexed { index, group ->
            key(group.id) {
                ImpressOnce(items, group)
                val isSeen = group.id in items.seen
                val source = remember { MutableInteractionSource() }
                val scale = pressedScale(source, look.reducedMotion)
                Column(
                    modifier = Modifier
                        .testTag(BAR_ITEM_TAG)
                        .width((edge + RING_ITEM_EXTRA_DP).dp)
                        .sizeIn(minWidth = 48.dp, minHeight = 48.dp)
                        .enterAt(index, look.reducedMotion)
                        .graphicsLayer { scaleX = scale; scaleY = scale }
                        // One focusable button named by its group (the cover and title below say nothing more).
                        .clickable(interactionSource = source, indication = LocalIndication.current, role = Role.Button) { items.onTap(group) }
                        .semantics { contentDescription = barItemLabel(group.name, isSeen, items.translate) },
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    ItemCover(group, isSeen, Modifier.size(edge.dp), shape, coverShape, items)
                    if (settings.showTitles) {
                        BasicText(
                            group.name,
                            style = title,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            // The item's name already says it (aria-hidden in the Web SDK); only tests read BarTitle.
                            modifier = Modifier.fillMaxWidth().height(16.dp).clearAndSetSemantics { barTitle = group.name },
                        )
                    }
                }
            }
        }
    }
}

/**
 * A group's cover in its ring, in the ring's state: none (the cover alone), seen (the seen colour, still), a solid
 * ring, or the sweep of the theme's colours: turning around the frame while unseen, still under reduced motion.
 */
@Composable
internal fun ItemCover(group: DeliveryTaleGroup, isSeen: Boolean, size: Modifier, shape: Shape, coverShape: Shape, items: BarItems) {
    val look = items.look
    when {
        look.none -> Cover(group, coverShape, look, items.loader, size)
        isSeen -> Ring(size, shape, SolidColor(look.seenColor), look, group, items, coverShape)
        look.solidRing -> Ring(size, shape, SolidColor(look.ringColors.firstOrNull() ?: look.seenColor), look, group, items, coverShape)
        look.reducedMotion -> Ring(size, shape, Brush.sweepGradient(ringSweepColors(look.ringColors)), look, group, items, coverShape)
        else -> SpinningRing(size, shape, look, group, items, coverShape)
    }
}

// An unseen ring turns: its sweep of the theme's colours goes once round every RING_SPIN_MS, around the frame only.
@Composable
private fun SpinningRing(
    size: Modifier,
    shape: Shape,
    look: BarLook,
    group: DeliveryTaleGroup,
    items: BarItems,
    coverShape: Shape,
) {
    val transition = rememberInfiniteTransition(label = "barRing")
    val turn by transition.animateFloat(
        initialValue = 0f,
        targetValue = 360f,
        animationSpec = infiniteRepeatable(tween(RING_SPIN_MS, easing = LinearEasing)),
        label = "barRingTurn",
    )
    Ring(size, shape, Brush.sweepGradient(ringSweepColors(look.ringColors)), look, group, items, coverShape, turn)
}

// A ring: [brush] filling [shape] around the cover, turned by [angle] degrees about the ring's centre.
@Composable
private fun Ring(
    size: Modifier,
    shape: Shape,
    brush: Brush,
    look: BarLook,
    group: DeliveryTaleGroup,
    items: BarItems,
    coverShape: Shape,
    angle: Float = 0f,
) {
    Box(
        size.drawBehind {
            rotate(angle, Offset(this.size.width / 2f, this.size.height / 2f)) {
                fillShape(shape, brush)
            }
        },
    ) {
        Cover(group, coverShape, look, items.loader, Modifier.padding(look.ringWidth.dp))
    }
}

// Fills [shape] over the whole of this draw scope with [brush] (a circle, a rounded square or any other outline).
private fun DrawScope.fillShape(shape: Shape, brush: Brush) {
    when (val outline = shape.createOutline(size, layoutDirection, this)) {
        is Outline.Rectangle -> drawRect(brush)
        is Outline.Rounded -> drawPath(Path().apply { addRoundRect(outline.roundRect) }, brush)
        is Outline.Generic -> drawPath(outline.path, brush)
    }
}

/** A group's cover: its image over the neutral placeholder, edged in the palette's gap colour, or [fill] when none. */
@Composable
internal fun Cover(
    group: DeliveryTaleGroup,
    shape: Shape,
    look: BarLook,
    loader: ImageLoader,
    modifier: Modifier = Modifier,
    edged: Boolean = true,
) {
    val source = remember(group) { coverSource(group) }
    val placeholder = (source as? CoverSource.Placeholder)?.color?.let(::parseHexColor) ?: look.palette.surface
    // A cover's image loads over the neutral placeholder; a failed load leaves the placeholder.
    Box(
        modifier
            .fillMaxSize()
            .clip(shape)
            .background(placeholder)
            .then(if (edged) Modifier.border(COVER_BORDER_DP.dp, look.palette.gap, shape) else Modifier),
    ) {
        if (source is CoverSource.Image) {
            AsyncImage(
                model = source.url,
                contentDescription = null,
                imageLoader = loader,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize().padding(if (edged) COVER_BORDER_DP.dp else 0.dp).clip(shape),
            )
        }
    }
}

/** The loader of cover images, when not the SDK's own: tests provide one on a fake server. */
internal val LocalCoverImageLoader = staticCompositionLocalOf<ImageLoader?> { null }

// One image loader for every bar: Coil over the SDK's Ktor client (no cookies), with Coil's caches.
private var coverImageLoader: ImageLoader? = null

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
