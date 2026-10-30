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
import androidx.compose.foundation.layout.fillMaxHeight
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
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLayoutDirection
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
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import site.lempert.taleart.sdk.delivery.DeliveryTaleGroup

/** The test tag of a chip's unseen dot. */
const val BAR_DOT_TAG = "taleart-bar-dot"

/** The chip's touch target at least, 48 dp (WCAG 2.5.5 with room to spare); the pill drawn in it is [CHIP_PILL_DP] high. */
private const val CHIP_MIN_DP = 48

/** The chip pill's minimum height, the Web SDK's 44 px, centred in its [CHIP_MIN_DP] touch target. */
internal const val CHIP_PILL_DP = 44

/** A chip title's widest, in dp (`max-width` of `.title` in the chip layout). */
private const val CHIP_TITLE_MAX_DP = 180

/** A poster's lift and tilt while pressed, in dp and degrees (the Web SDK's hover: up 8 px, rotated 1.5 degrees). */
private const val POSTER_LIFT_DP = 8f
private const val POSTER_TILT_DEG = 1.5f

/** A poster's corner radius, the Web SDK's 16 px (a poster ignores the shape). */
internal const val POSTER_RADIUS_DP = 16

/** The unseen accent ring of a poster, in dp. */
private const val POSTER_BORDER_DP = 2

/** The room above and below a poster row for its shadow, which reaches about 30 dp under the card (`padding-block: 32px`). */
internal const val POSTER_ROW_PAD_DP = 32

/** The poster card's resting elevation, in dp: its shadow falls about 18 dp below it. */
private const val POSTER_SHADOW_DP = 22

/** How far each stack cover overlaps the one before, in dp, and the paper border that separates them. */
internal const val STACK_OVERLAP_DP = 14
internal const val STACK_BORDER_DP = 3

/** The stack pill's minimum height, corner radius and gap, and its start and end padding (`.stack` in the Web SDK). */
internal const val STACK_MIN_DP = 60
internal const val STACK_RADIUS_DP = 16
internal const val STACK_GAP_DP = 12
internal const val STACK_PAD_START_DP = 24
internal const val STACK_PAD_END_DP = 14

/** The `Arrangement` of a row of items with the bar's gap and alignment (start, or centred). */
internal fun barArrangement(settings: BarSettings): Arrangement.Horizontal =
    if (settings.alignment == BarAlignment.Center) {
        Arrangement.spacedBy(settings.gap.dp, Alignment.CenterHorizontally)
    } else {
        Arrangement.spacedBy(settings.gap.dp)
    }

/**
 * The chip layout: a pill per group, its plain round cover beside its title, an unseen accent dot at its end. The
 * pills wrap in a [FlowRow]. Ignores the shape only; the cover's size follows the size setting (28, 32 or 40 dp).
 * The pill is 44 dp high at least inside a 48 dp touch target; seen, its title is muted, its cover dimmed, its dot gone.
 */
@Composable
internal fun ChipBar(items: BarItems) {
    val look = items.look
    val settings = look.settings
    val cover = chipCoverDp(settings.size)
    val title = look.titleText().merge(TextStyle(fontSize = 14.sp, lineHeight = 20.sp, fontWeight = FontWeight.Medium, textAlign = TextAlign.Start))
    val pill = RoundedCornerShape(50)
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
                val ink = if (isSeen) look.palette.muted else look.palette.title
                Box(
                    modifier = Modifier
                        .testTag(BAR_ITEM_TAG)
                        .sizeIn(minHeight = CHIP_MIN_DP.dp, minWidth = CHIP_MIN_DP.dp)
                        .enterAt(index, look.reducedMotion)
                        .graphicsLayer { scaleX = scale; scaleY = scale }
                        .clip(pill)
                        .clickable(interactionSource = source, indication = LocalIndication.current, role = Role.Button) { items.onTap(group) }
                        .semantics { contentDescription = barItemLabel(group.name, isSeen, items.translate) },
                    contentAlignment = Alignment.Center,
                ) {
                    Row(
                        modifier = Modifier
                            .sizeIn(minHeight = CHIP_PILL_DP.dp)
                            .clip(pill)
                            .background(look.palette.surface)
                            .border(1.dp, ink.copy(alpha = ink.alpha * 0.18f), pill)
                            .padding(start = 4.dp, end = 14.dp, top = 4.dp, bottom = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Cover(
                            group,
                            CircleShape,
                            look,
                            items.loader,
                            Modifier.size(cover.dp).then(if (isSeen) Modifier.graphicsLayer { alpha = 0.6f } else Modifier),
                            edged = false,
                        )
                        if (settings.showTitles) {
                            BasicText(
                                group.name,
                                style = if (isSeen) title.merge(TextStyle(color = look.palette.muted)) else title,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.widthIn(max = CHIP_TITLE_MAX_DP.dp).clearAndSetSemantics { barTitle = group.name },
                            )
                        }
                        if (!isSeen) {
                            // The accent dot, ringed in the ink so it reads on any card (the Web SDK's 0 0 0 1px ink).
                            val ring = look.palette.ink
                            Box(
                                Modifier
                                    .size(8.dp)
                                    .testTag(BAR_DOT_TAG)
                                    .drawBehind { drawCircle(ring, radius = size.minDimension / 2f + 1.dp.toPx()) }
                                    .clip(CircleShape)
                                    .background(look.palette.accent),
                            )
                        }
                    }
                }
            }
        }
    }
}

/**
 * The poster layout: a portrait card of 112 by 188 dp per group, its cover full-bleed under a dark scrim over its lower
 * 60 %, the tale segments along the top (one per tale, all dim while unseen, all lit once seen), the title and the
 * "N stories" caption in white at the bottom. An unseen card has an accent ring; a pressed card lifts and tilts, the
 * way the Web SDK's hover does. The row keeps 32 dp above and below for the cards' shadows.
 * Ignores the shape and the size; the title follows showTitles.
 */
@Composable
internal fun PosterBar(items: BarItems, maxWidth: Dp) {
    val look = items.look
    val settings = look.settings
    val translate = items.translate
    val radius = RoundedCornerShape(POSTER_RADIUS_DP.dp)
    val density = LocalDensity.current.density
    val rtl = LocalLayoutDirection.current == LayoutDirection.Rtl
    Row(
        modifier = Modifier
            .testTag(BAR_TAG)
            .horizontalScroll(rememberScrollState())
            .widthIn(min = maxWidth)
            .padding(horizontal = 16.dp, vertical = POSTER_ROW_PAD_DP.dp),
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
                val resting = CardDark.copy(alpha = 0.8f)
                val lifted = look.palette.accent.copy(alpha = 0.6f)
                Box(
                    modifier = Modifier
                        .testTag(BAR_ITEM_TAG)
                        .size(POSTER_WIDTH_DP.dp, POSTER_HEIGHT_DP.dp)
                        .enterAt(index, look.reducedMotion)
                        .graphicsLayer {
                            scaleX = scale
                            scaleY = scale
                            translationY = -POSTER_LIFT_DP * density * lift
                            rotationZ = (if (rtl) POSTER_TILT_DEG else -POSTER_TILT_DEG) * lift
                        }
                        // The web's `0 18px 30px -18px dark 80 %` (accent 60 % on hover) as the platform's own soft shadow: one
                        // blurred drop under the card, no steps. The elevation stands for the offset and blur.
                        .shadow(
                            elevation = (POSTER_SHADOW_DP + 8 * lift).dp,
                            shape = radius,
                            clip = false,
                            ambientColor = Color.Transparent,
                            spotColor = lerp(resting, lifted, lift),
                        )
                        .clip(radius)
                        .background(look.palette.surface)
                        .clickable(interactionSource = source, indication = LocalIndication.current, role = Role.Button) { items.onTap(group) }
                        .semantics { contentDescription = "${barItemLabel(group.name, isSeen, translate)}, $caption" },
                ) {
                    Cover(group, RectangleShape, look, items.loader, Modifier.fillMaxSize(), edged = false)
                    // The scrim: dark 90 % at the foot, 70 % at 40 % of its height, clear at the top, over the lower 60 % of the card.
                    Box(
                        Modifier
                            .align(Alignment.BottomStart)
                            .fillMaxWidth()
                            .fillMaxHeight(0.6f)
                            .background(Brush.verticalGradient(0f to Color.Transparent, 0.6f to CardDark.copy(alpha = 0.7f), 1f to CardDark.copy(alpha = 0.9f))),
                    )
                    Row(
                        Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 8.dp),
                        horizontalArrangement = Arrangement.spacedBy(3.dp),
                    ) {
                        val segments = posterSegmentCount(group.tales.size)
                        for (segment in 0 until segments) {
                            Box(
                                Modifier
                                    .weight(1f)
                                    .height(3.dp)
                                    .clip(RoundedCornerShape(9.dp))
                                    .background(if (isSeen) POSTER_INK else POSTER_INK.copy(alpha = 0.35f)),
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
                                style = TextStyle(color = POSTER_INK, fontSize = 15.sp, lineHeight = 16.5.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Start),
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.clearAndSetSemantics { barTitle = group.name },
                            )
                        }
                        BasicText(
                            caption,
                            style = TextStyle(color = POSTER_INK, fontSize = 11.sp, lineHeight = 14.sp, textAlign = TextAlign.Start),
                            maxLines = 1,
                            modifier = Modifier.clearAndSetSemantics { },
                        )
                    }
                    // The unseen accent ring, inset in the card.
                    if (!isSeen) Box(Modifier.fillMaxSize().border(POSTER_BORDER_DP.dp, look.palette.accent, radius))
                }
            }
        }
    }
}

// The poster's ink (`--ta-light`): white on its dark scrim, whatever the theme (the scrim keeps it at 4.5:1 or more).
private val POSTER_INK = CardLight

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
 * The stack layout: one pill on the surface colour with up to four overlapping covers (a paper border each) and a '+N'
 * bubble for the rest, and beside them the caption "N new stories" (or "N stories" once all are seen, muted), as one
 * button that opens the first unseen group. Ignores the shape, the showTitles, the alignment and the gap; the cover size
 * follows the size setting (40, 48 or 56 dp).
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
        if (opened != null) StackButton(items, groups[opened], caption, muted = unseen == 0)
    }
}

// The stack's one button: its pill with the covers, the '+N' bubble and the caption, named by the group it opens and the caption.
@Composable
private fun StackButton(items: BarItems, group: DeliveryTaleGroup, caption: String, muted: Boolean) {
    val look = items.look
    val palette = look.palette
    val groups = items.groups
    val edge = stackCoverDp(look.settings.size)
    val step = edge - STACK_OVERLAP_DP
    val visible = stackVisibleCount(groups.size)
    val overflow = stackOverflow(groups.size)
    val slots = visible + if (overflow > 0) 1 else 0
    val source = remember { MutableInteractionSource() }
    val scale = pressedScale(source, look.reducedMotion)
    val pill = RoundedCornerShape(STACK_RADIUS_DP.dp)
    Row(
        modifier = Modifier
            .testTag(BAR_ITEM_TAG)
            .graphicsLayer { scaleX = scale; scaleY = scale }
            .clip(pill)
            .background(palette.surface)
            .clickable(interactionSource = source, indication = LocalIndication.current, role = Role.Button) { items.onTap(group) }
            .semantics { contentDescription = "${group.name}, $caption" }
            .sizeIn(minHeight = STACK_MIN_DP.dp)
            .padding(start = STACK_PAD_START_DP.dp, end = STACK_PAD_END_DP.dp, top = 10.dp, bottom = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(STACK_GAP_DP.dp),
    ) {
        Box(Modifier.width((edge + (slots - 1).coerceAtLeast(0) * step).dp).height(edge.dp)) {
            for (index in 0 until visible) {
                Box(
                    Modifier
                        .align(Alignment.CenterStart)
                        .padding(start = (index * step).dp)
                        .size(edge.dp)
                        .clip(CircleShape)
                        .background(palette.paper),
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
                        // The paper mixed with 14 % of the title colour (`color-mix(currentColor 14%, paper)`), behind the paper border.
                        .background(palette.paper)
                        .padding(STACK_BORDER_DP.dp)
                        .clip(CircleShape)
                        .background(palette.title.copy(alpha = 0.14f).compositeOver(palette.paper)),
                    contentAlignment = Alignment.Center,
                ) {
                    LeftToRight {
                        BasicText(
                            "+$overflow",
                            style = TextStyle(color = palette.title, fontSize = 12.sp, lineHeight = 16.sp, fontWeight = FontWeight.Bold),
                        )
                    }
                }
            }
        }
        BasicText(
            caption,
            style = look.titleText().merge(
                TextStyle(
                    color = if (muted) palette.muted else palette.title,
                    fontSize = 13.sp,
                    lineHeight = 18.sp,
                    fontWeight = FontWeight.SemiBold,
                    textAlign = TextAlign.Start,
                ),
            ),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f, fill = false).clearAndSetSemantics { },
        )
    }
}

/** The string key of a group's tale count: `bar.story` for one tale, else `bar.stories`. */
internal fun storiesKey(count: Int): String = if (count == 1) "bar.story" else "bar.stories"

/** The string key of the count of unseen groups: `bar.newStory` for one, else `bar.newStories`. */
internal fun newStoriesKey(count: Int): String = if (count == 1) "bar.newStory" else "bar.newStories"
