package site.lempert.taleart.sdk.ui

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.LocalIndication
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
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
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.key
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import site.lempert.taleart.sdk.delivery.DeliveryTaleGroup

/** The test tag of a chip's unseen dot. */
const val BAR_DOT_TAG = "taleart-bar-dot"

/** The chip's pill height at least, so its touch target is 48 dp (WCAG 2.5.5 with room to spare). */
private const val CHIP_MIN_DP = 48

/** A poster's lift while pressed, in dp. */
private const val POSTER_LIFT_DP = 6f

/** A poster's corner radius, the Web SDK's 16 px (a poster ignores the shape). */
internal const val POSTER_RADIUS_DP = 16

/** The unseen accent border of a poster, in dp. */
private const val POSTER_BORDER_DP = 2

/** How far each stack cover overlaps the one before, in dp, and the border that separates them. */
internal const val STACK_OVERLAP_DP = 14
private const val STACK_BORDER_DP = 3

/** The space between a stack's covers and its caption, in dp. */
internal const val STACK_CAPTION_GAP_DP = 6

/** The `Arrangement` of a row of items with the bar's gap and alignment (start, or centred). */
internal fun barArrangement(settings: BarSettings): Arrangement.Horizontal =
    if (settings.alignment == BarAlignment.Center) {
        Arrangement.spacedBy(settings.gap.dp, Alignment.CenterHorizontally)
    } else {
        Arrangement.spacedBy(settings.gap.dp)
    }

/**
 * The chip layout: a pill per group, its round cover beside its title, an unseen accent dot at its end. The pills
 * wrap in a [FlowRow]. Ignores the shape only; the cover's size follows the size setting (28, 32 or 40 dp).
 */
@Composable
internal fun ChipBar(items: BarItems) {
    val look = items.look
    val settings = look.settings
    val cover = chipCoverDp(settings.size)
    val title = look.titleText().merge(TextStyle(fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Start))
    FlowRow(
        modifier = Modifier.testTag(BAR_TAG).fillMaxWidth().padding(4.dp),
        horizontalArrangement = barArrangement(settings),
        verticalArrangement = Arrangement.spacedBy(settings.gap.dp),
    ) {
        items.groups.forEachIndexed { index, group ->
            key(group.id) {
                ImpressOnce(items, group)
                val isSeen = group.id in items.seen
                val source = remember { MutableInteractionSource() }
                val scale = pressedScale(source, look.reducedMotion)
                Row(
                    modifier = Modifier
                        .testTag(BAR_ITEM_TAG)
                        .sizeIn(minHeight = CHIP_MIN_DP.dp, minWidth = CHIP_MIN_DP.dp)
                        .enterAt(index, look.reducedMotion)
                        .graphicsLayer { scaleX = scale; scaleY = scale }
                        .clip(RoundedCornerShape(50))
                        .background(if (isSeen) Color.Transparent else look.palette.surface)
                        .clickable(interactionSource = source, indication = LocalIndication.current, role = Role.Button) { items.onTap(group) }
                        .semantics { contentDescription = barItemLabel(group.name, isSeen, items.translate) }
                        .padding(start = 4.dp, end = 14.dp, top = 4.dp, bottom = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    ItemCover(
                        group,
                        isSeen,
                        Modifier.size(cover.dp),
                        CircleShape,
                        CircleShape,
                        items,
                    )
                    if (settings.showTitles) {
                        BasicText(
                            group.name,
                            style = if (isSeen) title.merge(TextStyle(color = look.palette.muted)) else title,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.clearAndSetSemantics { barTitle = group.name },
                        )
                    }
                    if (!isSeen) {
                        Box(
                            Modifier
                                .size(8.dp)
                                .clip(CircleShape)
                                .testTag(BAR_DOT_TAG)
                                .background(accentDotColor(look.palette.accent, look.palette.paper, look.palette.live)),
                        )
                    }
                }
            }
        }
    }
}

/**
 * The poster layout: a portrait card of 3:5 per group, its cover full-bleed under a dark scrim, the tale
 * segments along the top (one per tale, the first lit while unseen, all lit once seen), the title and the
 * "N stories" caption in white at the bottom. An unseen card has an accent border; a pressed card lifts.
 * Ignores the shape and the size; the title follows showTitles.
 */
@Composable
internal fun PosterBar(items: BarItems, maxWidth: Dp) {
    val look = items.look
    val settings = look.settings
    val translate = items.translate
    val radius = RoundedCornerShape(POSTER_RADIUS_DP.dp)
    val density = LocalDensity.current.density
    Row(
        modifier = Modifier
            .testTag(BAR_TAG)
            .horizontalScroll(rememberScrollState())
            .widthIn(min = maxWidth)
            .padding(4.dp),
        horizontalArrangement = barArrangement(settings),
    ) {
        items.groups.forEachIndexed { index, group ->
            key(group.id) {
                ImpressOnce(items, group)
                val isSeen = group.id in items.seen
                val source = remember { MutableInteractionSource() }
                val scale = pressedScale(source, look.reducedMotion)
                val lift = pressedLift(source, look.reducedMotion)
                val caption = translate(storiesKey(group.tales.size), mapOf("count" to group.tales.size))
                Box(
                    modifier = Modifier
                        .testTag(BAR_ITEM_TAG)
                        .size(POSTER_WIDTH_DP.dp, POSTER_HEIGHT_DP.dp)
                        .enterAt(index, look.reducedMotion)
                        .graphicsLayer {
                            scaleX = scale
                            scaleY = scale
                            translationY = -POSTER_LIFT_DP * density * lift
                        }
                        .shadow(elevation = (4 + 8 * lift).dp, shape = radius)
                        .clip(radius)
                        .background(look.palette.surface)
                        .then(if (isSeen) Modifier else Modifier.border(POSTER_BORDER_DP.dp, look.palette.accent, radius))
                        .clickable(interactionSource = source, indication = LocalIndication.current, role = Role.Button) { items.onTap(group) }
                        .semantics { contentDescription = "${barItemLabel(group.name, isSeen, translate)}, $caption" },
                ) {
                    Cover(group, RectangleShape, look, items.loader, Modifier.fillMaxSize(), edged = false)
                    Box(
                        Modifier
                            .fillMaxSize()
                            .background(Brush.verticalGradient(listOf(Color.Transparent, POSTER_SCRIM))),
                    )
                    Row(
                        Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 8.dp),
                        horizontalArrangement = Arrangement.spacedBy(3.dp),
                    ) {
                        val segments = posterSegmentCount(group.tales.size)
                        for (segment in 0 until segments) {
                            val lit = isSeen || segment == 0
                            Box(
                                Modifier
                                    .weight(1f)
                                    .height(3.dp)
                                    .clip(RoundedCornerShape(50))
                                    .background(if (lit) POSTER_INK else POSTER_INK.copy(alpha = 0.35f)),
                            )
                        }
                    }
                    Column(
                        Modifier.align(Alignment.BottomStart).padding(10.dp),
                        verticalArrangement = Arrangement.spacedBy(2.dp),
                    ) {
                        if (settings.showTitles) {
                            BasicText(
                                group.name,
                                style = TextStyle(color = POSTER_INK, fontSize = 13.sp, lineHeight = 17.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Start),
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.clearAndSetSemantics { barTitle = group.name },
                            )
                        }
                        BasicText(
                            caption,
                            style = TextStyle(color = POSTER_INK.copy(alpha = 0.85f), fontSize = 11.sp, lineHeight = 14.sp, textAlign = TextAlign.Start),
                            maxLines = 1,
                            modifier = Modifier.clearAndSetSemantics { },
                        )
                    }
                }
            }
        }
    }
}

// The poster's ink: white on its dark scrim, whatever the theme (the scrim keeps it at 4.5:1 or more).
private val POSTER_INK = Color.White

// The scrim's dark end: near black at 85 %, so the white title and caption read on any cover.
private val POSTER_SCRIM = Color(0xD9000000)

/** The lift of a pressed item: 1 while pressed on a spring, else 0 (and 0 under reduced motion). */
@Composable
internal fun pressedLift(source: MutableInteractionSource, reducedMotion: Boolean): Float {
    val pressed by source.collectIsPressedAsState()
    val lift by animateFloatAsState(
        targetValue = if (pressed && !reducedMotion) 1f else 0f,
        animationSpec = spring(dampingRatio = 0.6f, stiffness = 400f),
        label = "barLift",
    )
    return lift
}

/**
 * The stack layout: up to four overlapping covers and a '+N' bubble for the rest, with the caption "N new stories"
 * (or "N stories" once all are seen), as one button that opens the first unseen group. Ignores the shape, the
 * showTitles, the alignment and the gap; the cover size follows the size setting (40, 48 or 56 dp).
 */
@Composable
internal fun StackBar(items: BarItems) {
    val groups = items.groups
    val visible = stackVisibleCount(groups.size)
    val unseen = groups.count { it.id !in items.seen }
    val caption = if (unseen > 0) {
        items.translate(newStoriesKey(unseen), mapOf("count" to unseen))
    } else {
        items.translate(storiesKey(groups.size), mapOf("count" to groups.size))
    }
    // The covers drawn count as seen by the render; the groups folded into the bubble are not drawn.
    for (index in 0 until visible) key(groups[index].id) { ImpressOnce(items, groups[index]) }
    Row(
        modifier = Modifier.testTag(BAR_TAG).padding(4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        val opened = stackOpenIndex(groups.map { it.id }, items.seen)
        if (opened != null) StackButton(items, groups[opened], caption)
    }
}

// The stack's one button: its covers, the '+N' bubble and the caption, named by the group it opens and the caption.
@Composable
private fun StackButton(items: BarItems, group: DeliveryTaleGroup, caption: String) {
    val look = items.look
    val groups = items.groups
    val edge = stackCoverDp(look.settings.size)
    val step = edge - STACK_OVERLAP_DP
    val visible = stackVisibleCount(groups.size)
    val overflow = stackOverflow(groups.size)
    val slots = visible + if (overflow > 0) 1 else 0
    val source = remember { MutableInteractionSource() }
    val scale = pressedScale(source, look.reducedMotion)
    // The covers, with the caption under them: the stack is as wide as its covers, so the caption never shortens.
    Column(
        modifier = Modifier
            .testTag(BAR_ITEM_TAG)
            .sizeIn(minHeight = CHIP_MIN_DP.dp, minWidth = CHIP_MIN_DP.dp)
            .graphicsLayer { scaleX = scale; scaleY = scale }
            .clip(RoundedCornerShape(8.dp))
            .clickable(interactionSource = source, indication = LocalIndication.current, role = Role.Button) { items.onTap(group) }
            .semantics { contentDescription = "${group.name}, $caption" },
        horizontalAlignment = Alignment.Start,
        verticalArrangement = Arrangement.spacedBy(STACK_CAPTION_GAP_DP.dp),
    ) {
        Box(Modifier.width((edge + (slots - 1).coerceAtLeast(0) * step).dp).height(edge.dp)) {
            for (index in 0 until visible) {
                Box(
                    Modifier
                        .align(Alignment.CenterStart)
                        .padding(start = (index * step).dp)
                        .size(edge.dp)
                        .clip(CircleShape)
                        .background(look.palette.gap),
                ) {
                    Cover(groups[index], CircleShape, look, items.loader, Modifier.padding(STACK_BORDER_DP.dp), edged = false)
                }
            }
            if (overflow > 0) {
                Box(
                    Modifier
                        .align(Alignment.CenterStart)
                        .padding(start = (visible * step).dp)
                        .size(edge.dp)
                        .clip(CircleShape)
                        .background(look.palette.surface),
                    contentAlignment = Alignment.Center,
                ) {
                    LeftToRight {
                        BasicText(
                            "+$overflow",
                            style = TextStyle(color = look.palette.title, fontSize = 13.sp, lineHeight = 16.sp, fontWeight = FontWeight.SemiBold),
                        )
                    }
                }
            }
        }
        BasicText(
            caption,
            style = look.titleText().merge(TextStyle(fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Start)),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.height(18.dp).clearAndSetSemantics { },
        )
    }
}

/** The string key of a group's tale count: `bar.story` for one tale, else `bar.stories`. */
internal fun storiesKey(count: Int): String = if (count == 1) "bar.story" else "bar.stories"

/** The string key of the count of unseen groups: `bar.newStory` for one, else `bar.newStories`. */
internal fun newStoriesKey(count: Int): String = if (count == 1) "bar.newStory" else "bar.newStories"
