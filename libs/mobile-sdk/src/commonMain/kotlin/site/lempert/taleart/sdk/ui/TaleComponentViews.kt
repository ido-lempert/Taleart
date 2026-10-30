package site.lempert.taleart.sdk.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.em
import kotlinx.coroutines.delay
import site.lempert.taleart.sdk.ComponentRef
import site.lempert.taleart.sdk.i18n.Translate
import kotlin.time.Clock
import kotlin.time.Instant

// The components of a tale that the native SDK draws (components, 2026-10-29), as the Web SDK draws them:
// the countdown (days, hours, minutes and seconds ticking from the device's clock, then the ended text)
// and the promo code (a code in a chip with a Copy button). Sizes are fractions of the canvas height,
// as the web's `cqh`; the card is the poll's (white with near-black text, or the reverse for dark).

/** The clock the countdowns read: the device's, unless a test sets its own. */
internal val LocalTaleClock = staticCompositionLocalOf<() -> Instant> { { Clock.System.now() } }

/** Puts a promo code on the clipboard: the platform's, unless a test sets its own. */
internal val LocalClipboardCopy = staticCompositionLocalOf<(String) -> Boolean> { { text: String -> copyToClipboard(text) } }

/**
 * The card's and text's colours: the element's own light or dark card (its `theme` prop), else the colour
 * scheme's (`Auto` follows the host, `Light` and `Dark` force it). White with near-black text, or the reverse.
 */
@Composable
internal fun cardColors(dark: Boolean?): Pair<Color, Color> {
    val on = dark ?: rememberThemeColors().dark
    return if (on) CardDark to InkDark else CardLight to InkLight
}

/** The card's corner radius and padding, as the web's `.ta-poll`. */
internal const val CARD_RADIUS = 0.018
internal const val CARD_PADDING = 0.016
internal const val CARD_FONT = 0.024

/**
 * A countdown (`renderCountdown`): an optional title over the days, hours, minutes and seconds left, each
 * a number over its unit's name (Days, Hours, Min, Sec), the numbers in tabular figures. It ticks each
 * second from [LocalTaleClock] until [DocumentElement.Countdown.endsAt]; then the ended text shows, and
 * [reporter] hears `ended` once per composition. Its units speak the minute, not each second: their
 * content description changes once a minute. The ticker stops when the countdown leaves composition.
 */
@Composable
internal fun CountdownElement(element: DocumentElement.Countdown, canvas: CanvasMetrics, reporter: ComponentReporter?, modifier: Modifier) {
    val t: Translate = LocalTaleartContext.current.translate
    val clock = LocalTaleClock.current
    val reduced = rememberTaleReducedMotion()
    val report by rememberUpdatedState(reporter)
    var now by remember(element.endsAt) { mutableStateOf(clock()) }
    LaunchedEffect(element.endsAt) {
        while (true) {
            now = clock()
            if (countdownLeft(element.endsAt, now) == null) break
            delay(1_000)
        }
    }
    val left = countdownLeft(element.endsAt, now)
    val ended = left == null
    LaunchedEffect(ended, element.id) {
        if (ended) report?.report(ComponentRef(element.id, "countdown"), "ended")
    }

    // The minute the countdown is in: what the units say changes only then.
    val minute = left?.let { it.days * 1_440 + it.hours * 60 + it.minutes } ?: -1L
    val spoken = remember(minute, t) {
        left?.let { "${it.days} ${t("countdown.days")} ${it.hours} ${t("countdown.hours")} ${it.minutes} ${t("countdown.minutes")}" }
    }

    val (card, ink) = cardColors(element.dark)
    val base = canvas.h(CARD_FONT)
    Column(
        modifier
            .clip(RoundedCornerShape(canvas.dp(canvas.h(CARD_RADIUS))))
            .background(card)
            .padding(canvas.dp(canvas.h(CARD_PADDING))),
        verticalArrangement = Arrangement.spacedBy(canvas.dp(canvas.h(0.012))),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        element.title?.let { title ->
            BasicText(
                title,
                style = TextStyle(color = ink.copy(alpha = 0.85f), fontSize = canvas.sp(base * 0.75f), fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        if (left != null) {
            // The number takes the smaller of 7.68 % of the canvas height and 11 % of its width (`.ta-cd-num`).
            val numberPx = minOf(canvas.h(0.0768), canvas.width * 0.11f)
            val units = listOf(
                countdownNumber(left.days) to t("countdown.days"),
                countdownNumber(left.hours) to t("countdown.hours"),
                countdownNumber(left.minutes) to t("countdown.minutes"),
                countdownNumber(left.seconds) to t("countdown.seconds"),
            )
            // The digits and their units run left to right whatever the direction (`dir="ltr"` in the Web SDK).
            LeftToRight {
                Row(Modifier.fillMaxWidth().clearAndSetSemantics { contentDescription = spoken.orEmpty() }) {
                    for ((number, label) in units) {
                        Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                            // Each number sits in a tile and flips when it changes (`tickA`); the tile is the card's ink at 8 %.
                            FlipDigit(
                                number,
                                reduced,
                                Modifier
                                    .clip(RoundedCornerShape(canvas.dp(canvas.h(0.012))))
                                    .background(ink.copy(alpha = 0.08f))
                                    .padding(horizontal = canvas.dp(numberPx * 0.12f), vertical = canvas.dp(numberPx * 0.08f)),
                            ) {
                                BasicText(
                                    number,
                                    style = TextStyle(
                                        color = ink,
                                        fontSize = canvas.sp(numberPx),
                                        fontWeight = FontWeight.Bold,
                                        fontFeatureSettings = "tnum",
                                        textAlign = TextAlign.Center,
                                    ),
                                    maxLines = 1,
                                    softWrap = false,
                                )
                            }
                            BasicText(
                                label,
                                style = TextStyle(color = ink.copy(alpha = 0.75f), fontSize = canvas.sp(base * 0.9f), textAlign = TextAlign.Center),
                                maxLines = 1,
                                softWrap = false,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                    }
                }
            }
        } else {
            BasicText(
                element.endedText ?: t("countdown.ended"),
                style = TextStyle(color = ink, fontSize = canvas.sp(base * 1.6f), fontWeight = FontWeight.Bold, textAlign = TextAlign.Center),
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            )
        }
    }
}

// What a Copy said: the toast's text, which clears after two seconds. A new one is a new object, so a
// second copy restarts the two seconds.
private class CopyStatus(val text: String)

/**
 * A promo code (`renderPromoCode`): an optional title, the code on a ticket (a card with notches at its seam
 * and a shine that sweeps across it), an optional note, and a Copy button of at least 48 dp. Copy puts the
 * code on the clipboard: a toast says `Copied` (or why it could not copy) for two seconds, and it is said
 * through a live region; [reporter] hears `copied` with the code as its value when the clipboard took it.
 * The code is visible to every visitor, so it is no secret. The code stays left to right in any direction.
 */
@Composable
internal fun PromoCodeElement(element: DocumentElement.PromoCode, canvas: CanvasMetrics, reporter: ComponentReporter?, modifier: Modifier) {
    val t: Translate = LocalTaleartContext.current.translate
    val copy = LocalClipboardCopy.current
    val reduced = rememberTaleReducedMotion()
    val report by rememberUpdatedState(reporter)
    var status by remember { mutableStateOf<CopyStatus?>(null) }
    LaunchedEffect(status) {
        if (status != null) {
            delay(2_000)
            status = null
        }
    }

    val palette = rememberThemeColors()
    val (card, ink) = cardColors(element.dark)
    val base = canvas.h(CARD_FONT)
    // The chip's code is 1.3 em, smaller for a long code so that its 32 characters fit the canvas width.
    val chipFont = minOf(base * 1.3f, canvas.width * 0.8f / (element.code.length * 0.62f))
    val edge = canvas.h(0.0025)
    val ticketRadius = canvas.dp(canvas.h(0.012))
    val notch = canvas.dp(base * 0.9f)
    val onCopy = {
        val copied = copy(element.code)
        status = CopyStatus(t(if (copied) "promo.copied" else "promo.copyFailed"))
        if (copied) report?.report(ComponentRef(element.id, "promo-code", element.code), "copied")
    }

    Column(
        modifier
            .clip(RoundedCornerShape(canvas.dp(canvas.h(CARD_RADIUS))))
            .background(card)
            .padding(canvas.dp(canvas.h(CARD_PADDING))),
        verticalArrangement = Arrangement.spacedBy(canvas.dp(canvas.h(0.012))),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        element.title?.let { title ->
            BasicText(
                title,
                style = TextStyle(color = ink.copy(alpha = 0.85f), fontSize = canvas.sp(base * 0.75f), fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        // The ticket: the code on a dashed stub, with a notch cut from each side at the seam and the shine over it.
        Box(
            Modifier
                .clip(RoundedCornerShape(ticketRadius))
                .background(ink.copy(alpha = 0.06f))
                .ticketShine(reduced)
                .drawBehind {
                    // The notches: half discs in the card's colour, cut into the ticket's sides at its middle.
                    val y = size.height / 2f
                    drawCircle(color = card, radius = notch.toPx(), center = Offset(0f, y))
                    drawCircle(color = card, radius = notch.toPx(), center = Offset(size.width, y))
                    drawRoundRect(
                        color = ink,
                        cornerRadius = CornerRadius(ticketRadius.toPx(), ticketRadius.toPx()),
                        style = Stroke(width = edge, pathEffect = PathEffect.dashPathEffect(floatArrayOf(canvas.h(0.008), canvas.h(0.006)))),
                    )
                }
                .padding(horizontal = canvas.dp(chipFont * 1.2f), vertical = canvas.dp(chipFont * 0.6f)),
        ) {
            // A code is written as it is, left to right, in any direction.
            LeftToRight {
                BasicText(
                    element.code,
                    style = TextStyle(
                        color = ink,
                        fontSize = canvas.sp(chipFont),
                        fontWeight = FontWeight.Bold,
                        fontFamily = FontFamily.Monospace,
                        letterSpacing = 0.08.em,
                        textAlign = TextAlign.Center,
                    ),
                    maxLines = 1,
                    softWrap = false,
                )
            }
        }
        element.note?.let { note ->
            BasicText(
                note,
                style = TextStyle(color = ink.copy(alpha = 0.8f), fontSize = canvas.sp(base * 0.8f), textAlign = TextAlign.Center),
            )
        }
        Box(
            Modifier
                .defaultMinSize(minWidth = MinTarget, minHeight = MinTarget)
                .clip(RoundedCornerShape(50))
                .border(canvas.dp(edge), ink, RoundedCornerShape(50))
                .clickable(role = Role.Button, onClick = onCopy)
                .padding(horizontal = canvas.dp(base * 1.4f), vertical = canvas.dp(base * 0.5f)),
            contentAlignment = Alignment.Center,
        ) {
            BasicText(
                t("promo.copy"),
                style = TextStyle(color = ink, fontSize = canvas.sp(base), fontWeight = FontWeight.Bold),
                maxLines = 1,
                softWrap = false,
            )
        }
        // The toast: the confirmation for two seconds, in the card's ink inverted, announced through its live region.
        AnimatedVisibility(
            visible = status != null,
            enter = if (reduced) EnterTransition.None else fadeIn() + slideInVertically(),
            exit = if (reduced) ExitTransition.None else fadeOut() + slideOutVertically(),
        ) {
            val text = status?.text.orEmpty()
            BasicText(
                text,
                style = TextStyle(color = card, fontSize = canvas.sp(base * 0.8f), fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center),
                modifier = Modifier
                    .clip(RoundedCornerShape(50))
                    .background(ink)
                    .padding(horizontal = canvas.dp(base * 0.9f), vertical = canvas.dp(base * 0.4f))
                    .semantics { liveRegion = LiveRegionMode.Polite },
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}
