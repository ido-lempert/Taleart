package site.lempert.taleart.sdk.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.layout
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import site.lempert.taleart.sdk.delivery.ChoiceResult
import site.lempert.taleart.sdk.delivery.ResponseResult

// The five views of a poll (poll.schema.json `view`), drawn on the same card as the sticker: an embed card that
// holds its own results header, this-or-that (two halves split at the vote), grid (two big tiles) and inline
// (compact rows). The pure logic is here too: the split and the divider's place, each option's colour and the
// colour its text takes, so the views can be tested without drawing them.

// ---- Pure logic -------------------------------------------------------------------------------

/** The WCAG contrast ratio of two colours, from 1 (none) to 21 (black on white). */
internal fun contrastRatio(a: Color, b: Color): Double {
    val la = relativeLuminance(a)
    val lb = relativeLuminance(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)
}

/**
 * The text colour on [background]: white or black, whichever contrasts more. One of the two is at 4.5:1 or
 * more on any colour (the two meet at a luminance of about 0.18), so the text always reads.
 */
internal fun textOn(background: Color): Color =
    if (contrastRatio(background, Color.White) >= contrastRatio(background, Color.Black)) Color.White else Color.Black

/**
 * The first option's share of a this-or-that poll, as a whole percentage from 0 to 100: its share of the
 * votes once any are cast, and half before the vote (or when no vote counts for either option).
 */
internal fun thisOrThatPercentA(result: ResponseResult?, first: Choice, second: Choice): Int {
    if (result !is ChoiceResult) return 50
    val a = percentOf(result, first.id)
    val b = percentOf(result, second.id)
    if (a + b <= 0) return 50
    return (a * 100f / (a + b)).roundToInt().coerceIn(0, 100)
}

/**
 * The centre of the this-or-that divider, in pixels from the left edge of a [width] wide box, for option A's
 * [percentA] share from the start edge. The first option starts on the start edge: the left in left to right,
 * the right in right to left, so the divider is mirrored there.
 */
internal fun dividerCenterX(percentA: Int, width: Float, rtl: Boolean): Float {
    val fromStart = percentA.coerceIn(0, 100) / 100f * width
    return if (rtl) width - fromStart else fromStart
}

/** The colour of an option's half, tile or fill: its own `color`, else the theme's (the live colour, then the title colour). */
internal fun optionFill(option: Choice, index: Int, palette: ThemeColors): Color =
    parseHexColor(option.color) ?: if (index == 0) palette.live else palette.title

// ---- Shared pieces ----------------------------------------------------------------------------

/** The header of an embed: the vote total once voted, else the hint that results appear after a vote. */
@Composable
internal fun EmbedHeader(state: ChoiceState, ink: Color, canvas: CanvasMetrics) {
    val t = LocalTaleartContext.current.translate
    val total = (state.result as? ChoiceResult)?.total
    // The number is isolated, so it stays left to right inside a sentence of any direction.
    val text = if (total != null) t("poll.votes", mapOf("count" to "\u2066$total\u2069")) else t("poll.resultsAfterVote")
    BasicText(
        text,
        style = TextStyle(color = ink.copy(alpha = 0.75f), fontSize = canvas.sp(canvas.h(CARD_FONT) * 0.8f), fontWeight = FontWeight.Medium),
    )
}

/**
 * Places its content at the absolute pixel ([x], [y]) of the place around it. An offset is mirrored in right to
 * left; this one is not, so a place worked out from the left edge stays where it is in either direction.
 */
private fun Modifier.placedAbsolutely(x: Int, y: Int): Modifier = layout { measurable, constraints ->
    // The place fills the box it is in, so its own place is the box's corner whatever the alignment; its content goes to (x, y).
    val placeable = measurable.measure(Constraints())
    layout(constraints.maxWidth, constraints.maxHeight) { placeable.place(x, y) }
}

// The divider's VS marker: a round chip over the seam, 48 dp across. Its test tag places it in tests.
private val DividerSize: Dp = 48.dp

/** The test tag of the this-or-that divider (the marker's place on the seam). */
internal const val DIVIDER_TAG = "poll-divider"

/**
 * This-or-that (`view` this-or-that): two halves that fill the box, one per option, split at the vote's share.
 * Before the vote the halves are equal. Each half is a radio button; the marker over the seam sits at the split,
 * mirrored in right to left (the first option starts on the start edge). Option colours are the options' own,
 * else the theme's; the text on each takes white or black by contrast.
 */
@Composable
internal fun ColumnScope.ThisOrThatView(state: ChoiceState, first: Choice, second: Choice, canvas: CanvasMetrics, reduced: Boolean) {
    val palette = rememberThemeColors()
    val rtl = LocalHostLayoutDirection.current == LayoutDirection.Rtl
    val share = rememberFill(thisOrThatPercentA(state.result, first, second) / 100f, reduced)
    val density = LocalDensity.current
    val dividerPx = with(density) { DividerSize.toPx() }
    val shape = RoundedCornerShape(canvas.dp(canvas.h(0.018)))
    BoxWithConstraints(
        Modifier
            .fillMaxWidth()
            .heightIn(min = MinTarget * 2)
            .weight(1f)
            .clip(shape),
    ) {
        val width = constraints.maxWidth.toFloat()
        val height = constraints.maxHeight.toFloat()
        Row(Modifier.fillMaxSize().selectableGroup()) {
            Half(first, optionFill(first, 0, palette), share.coerceIn(MIN_SHARE, 1f - MIN_SHARE), state, canvas, reduced)
            Half(second, optionFill(second, 1, palette), (1f - share).coerceIn(MIN_SHARE, 1f - MIN_SHARE), state, canvas, reduced)
        }
        val centre = dividerCenterX((share * 100f).roundToInt(), width, rtl)
        // Placed at an absolute place in pixels: its centre is the seam, already worked out from the left edge.
        Box(Modifier.fillMaxSize().placedAbsolutely((centre - dividerPx / 2f).roundToInt(), (height / 2f - dividerPx / 2f).roundToInt())) {
            Box(Modifier.size(DividerSize).testTag(DIVIDER_TAG)) {
                Box(
                    Modifier
                        .fillMaxSize()
                        .clip(RoundedCornerShape(50))
                        .background(palette.paper)
                        .clearAndSetSemantics { },
                    contentAlignment = Alignment.Center,
                ) {
                    BasicText(
                        "VS",
                        style = TextStyle(color = palette.ink, fontSize = canvas.sp(canvas.h(CARD_FONT) * 0.8f), fontWeight = FontWeight.ExtraBold),
                        softWrap = false,
                        maxLines = 1,
                    )
                }
            }
        }
    }
}

// The smallest share a half keeps, so an option at 0 % still has a visible, tappable half.
private const val MIN_SHARE = 0.12f

// One half of a this-or-that: its label and, once voted, its share, on its colour with the text by contrast.
@Composable
private fun RowScope.Half(
    choice: Choice,
    fill: Color,
    share: Float,
    state: ChoiceState,
    canvas: CanvasMetrics,
    reduced: Boolean,
) {
    val text = textOn(fill)
    val percent = state.result?.let { percentOf(it, choice.id) }
    val isSelected = state.shown == choice.id
    val enabled = !state.locked && !state.busy
    val pop = rememberPop(isSelected, reduced)
    val spoken = if (percent != null) "${choice.label}, $percent%" else choice.label
    val base = canvas.h(CARD_FONT)
    Box(
        Modifier
            .weight(share)
            .fillMaxHeight()
            .graphicsLayer { scaleX = pop; scaleY = pop }
            .background(fill)
            .selectable(selected = isSelected, enabled = enabled, role = Role.RadioButton, onClick = { state.press(choice) })
            .semantics(mergeDescendants = true) {
                contentDescription = spoken
                selected = isSelected
                if (!enabled) disabled()
            }
            .padding(canvas.dp(base * 0.6f)),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(canvas.dp(base * 0.3f))) {
            BasicText(
                choice.label,
                style = TextStyle(color = text, fontSize = canvas.sp(base * 1.1f), fontWeight = FontWeight.Bold, textAlign = TextAlign.Center),
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.clearAndSetSemantics { },
            )
            if (percent != null) {
                // The share reads left to right in any direction: the number, then its sign.
                LeftToRight {
                    BasicText(
                        "$percent%",
                        style = TextStyle(color = text, fontSize = canvas.sp(base * 2.2f), fontWeight = FontWeight.ExtraBold),
                        softWrap = false,
                        maxLines = 1,
                        modifier = Modifier.clearAndSetSemantics { },
                    )
                }
            }
        }
    }
}

/**
 * Grid (`view` grid): two big tiles side by side, each in its option's colour with the label, and once voted
 * the option's share. The chosen tile is ringed and pops once; each tile is a radio button, 48 dp at least.
 */
@Composable
internal fun ColumnScope.GridView(state: ChoiceState, choices: List<Choice>, canvas: CanvasMetrics, reduced: Boolean) {
    val palette = rememberThemeColors()
    val gap = canvas.dp(canvas.h(0.012))
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = MinTarget * 2)
            .weight(1f)
            .selectableGroup(),
        horizontalArrangement = Arrangement.spacedBy(gap),
    ) {
        choices.forEachIndexed { index, choice ->
            Tile(choice, optionFill(choice, index, palette), state, canvas, reduced)
        }
    }
}

@Composable
private fun RowScope.Tile(choice: Choice, fill: Color, state: ChoiceState, canvas: CanvasMetrics, reduced: Boolean) {
    val text = textOn(fill)
    val percent = state.result?.let { percentOf(it, choice.id) }
    val isSelected = state.shown == choice.id
    val enabled = !state.locked && !state.busy
    val pop = rememberPop(isSelected, reduced)
    val base = canvas.h(CARD_FONT)
    val shape = RoundedCornerShape(canvas.dp(canvas.h(0.018)))
    val ring = canvas.dp(canvas.h(0.0035))
    val spoken = if (percent != null) "${choice.label}, $percent%" else choice.label
    Box(
        Modifier
            .weight(1f)
            .fillMaxHeight()
            .graphicsLayer { scaleX = pop; scaleY = pop }
            .clip(shape)
            .background(fill)
            .border(if (isSelected) ring else 0.dp, text, shape)
            .selectable(selected = isSelected, enabled = enabled, role = Role.RadioButton, onClick = { state.press(choice) })
            .semantics(mergeDescendants = true) {
                contentDescription = spoken
                selected = isSelected
                if (!enabled) disabled()
            }
            .padding(canvas.dp(base * 0.6f)),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(canvas.dp(base * 0.2f))) {
            BasicText(
                choice.label,
                style = TextStyle(color = text, fontSize = canvas.sp(base * 1.1f), fontWeight = FontWeight.Bold, textAlign = TextAlign.Center),
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.clearAndSetSemantics { },
            )
            if (percent != null) {
                LeftToRight {
                    BasicText(
                        "$percent%",
                        style = TextStyle(color = text, fontSize = canvas.sp(base * 2.2f), fontWeight = FontWeight.ExtraBold),
                        softWrap = false,
                        maxLines = 1,
                        modifier = Modifier.clearAndSetSemantics { },
                    )
                }
            }
        }
    }
}
