package site.lempert.taleart.sdk.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.setProgress
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import kotlin.math.roundToInt
import kotlin.time.Clock
import kotlinx.coroutines.launch
import site.lempert.taleart.sdk.ComponentRef
import site.lempert.taleart.sdk.GroupRef
import site.lempert.taleart.sdk.TaleRef
import site.lempert.taleart.sdk.TaleartListener
import site.lempert.taleart.sdk.delivery.ChoiceResult
import site.lempert.taleart.sdk.delivery.DeliveryClient
import site.lempert.taleart.sdk.delivery.RatingResult
import site.lempert.taleart.sdk.delivery.ReactionResult
import site.lempert.taleart.sdk.delivery.ResponseOutcome
import site.lempert.taleart.sdk.delivery.ResponseResult
import site.lempert.taleart.sdk.delivery.StoredResponse
import site.lempert.taleart.sdk.delivery.keepResponse
import site.lempert.taleart.sdk.delivery.storedResponse
import site.lempert.taleart.sdk.deliver
import site.lempert.taleart.sdk.i18n.Translate
import site.lempert.taleart.sdk.storage.KeyValueStore
import site.lempert.taleart.sdk.storage.deviceKeyValueStoreOrNull

// The interactive components a visitor answers (components, 2026-10-29), as the Web SDK draws them
// (libs/web-sdk/src/lib/document/poll.ts, quiz.ts, rating.ts, reaction.ts): a poll and a quiz are a
// question over buttons that show each choice's share once answered; a Rating is a slider whose thumb
// is an emoji, posted on release; a Reaction is a row of emoji buttons with their counts. One answer
// per visitor and element: once answered (or kept from an earlier visit) the controls are disabled.
// A preview (inert links, the Tale Studio) marks the choice and sends nothing. A poll's five views are
// in TaleInteractivePoll.kt; the motion in TaleInteractiveMotion.kt.

/** The zone an answer is posted to: the API origin, the zone key and the client that posts it. */
internal data class ZoneResponses(val apiUrl: String, val key: String, val client: DeliveryClient)

/**
 * Sends and remembers the visitor's answers to the interactive elements of the tale on screen. The
 * viewer provides one to its elements; a preview gets none, so nothing is sent or kept.
 */
internal interface ElementResponder {
    /** The visitor's answer to the element [elementId] kept on this device, or null. */
    fun stored(elementId: String): StoredResponse?

    /** Posts the answer [value] to the element [component]; on acceptance it is kept and the listeners hear it. */
    suspend fun send(component: ComponentRef, value: String): ResponseOutcome
}

/** The responder of the tale on screen, or null in a preview. */
internal val LocalElementResponder = compositionLocalOf<ElementResponder?> { null }

/** The group and tale an answer belongs to, as the events name them. */
internal class CurrentTale(val group: GroupRef, val tale: TaleRef)

/**
 * The viewer's responder: posts through the zone's client, keeps each accepted answer on this device
 * and fires `userInteracted` and then `componentEvent` (`selected`) through [deliver], as the Web SDK
 * does. [current] names the tale on screen; null (nothing on screen) sends nothing.
 */
internal class TaleResponder(
    private val zone: ZoneResponses,
    private val context: TaleartContext,
    private val current: () -> CurrentTale?,
    /** The device store answers are kept in; the SDK's own by default. */
    private val store: () -> KeyValueStore? = ::deviceKeyValueStoreOrNull,
) : ElementResponder {
    override fun stored(elementId: String): StoredResponse? {
        val tale = current()?.tale ?: return null
        return storedResponse(store(), tale.id, elementId)
    }

    override suspend fun send(component: ComponentRef, value: String): ResponseOutcome {
        val at = current() ?: return ResponseOutcome.Failed("No tale is shown", null)
        val outcome = zone.client.postResponse(zone.apiUrl, zone.key, at.tale.id, component.id, value)
        if (outcome is ResponseOutcome.Answered) {
            val answer = outcome.response
            keepResponse(store(), at.tale.id, component.id, StoredResponse(answer.value, answer.result), Clock.System.now().toEpochMilliseconds())
            val answered = ComponentRef(component.id, component.type, answer.value)
            val interacted = context.event("userInteracted", group = at.group, tale = at.tale, component = answered)
            deliver(context.listener, interacted) { it.onUserInteracted(interacted) }
            val selected = context.event("componentEvent", group = at.group, tale = at.tale, component = answered, action = "selected")
            deliver(context.listener, selected) { it.onComponentEvent(selected) }
        }
        return outcome
    }
}

// ---- Results (pure; the same wording as the Web SDK) ------------------------------------------

/** The tag of the share's fill inside a poll or quiz choice that shows its result. */
internal const val CHOICE_FILL_TAG = "taleart.choiceFill"

/** A choice's share as a whole percentage from 0 to 100; 0 for a result that is no choice result. */
internal fun percentOf(result: ResponseResult?, id: String): Int {
    val choice = (result as? ChoiceResult)?.choices?.firstOrNull { it.id == id } ?: return 0
    return choice.percent.coerceIn(0, 100)
}

/** The start of a poll's result: the visitor's vote in the poll's words; empty when the vote is no option. */
internal fun pollStart(options: List<Choice>, value: String, t: Translate): String =
    options.firstOrNull { it.id == value }?.let { t("poll.voted", mapOf("label" to it.label)) }.orEmpty()

/**
 * The start of a quiz's result: whether the answer was right, wrong (with the correct answer), or, for a
 * survey without a correct answer, only the answer. Empty when the answer is no answer of the quiz.
 */
internal fun quizStart(answers: List<Choice>, correctId: String?, value: String, t: Translate): String {
    val mine = answers.firstOrNull { it.id == value } ?: return ""
    val correct = answers.firstOrNull { it.id == correctId } ?: return t("quiz.answered", mapOf("label" to mine.label))
    return when (mine.id) {
        correct.id -> t("quiz.right", mapOf("label" to mine.label))
        else -> t("quiz.wrongAnswer", mapOf("label" to mine.label, "correct" to correct.label))
    }
}

/** What a choice card says once answered: its start, then each choice's share ("Tea 60%, Coffee 40%"). */
internal fun choiceSaying(start: String, choices: List<Choice>, result: ResponseResult?): String {
    val shares = choices.joinToString(", ") { "${it.label} ${percentOf(result, it.id)}%" }
    return if (start.isEmpty()) shares else "$start $shares"
}

/** A Rating's result as the Web SDK says it: the average from the count of ratings. */
internal fun ratingSummary(result: RatingResult, t: Translate): String = t(
    "rating.summary",
    mapOf(
        "average" to result.average,
        "total" to result.total,
        "count" to t(if (result.total == 1) "rating.singular" else "rating.plural"),
    ),
)

/** One emoji's count of a Reaction's result; 0 for a result that is no Reaction's. */
internal fun reactionCount(result: ResponseResult?, emoji: String): Int =
    (result as? ReactionResult)?.reactions?.firstOrNull { it.emoji == emoji }?.count?.coerceAtLeast(0) ?: 0

// ---- Shared look ------------------------------------------------------------------------------

/** The minimum tap target, 48 dp (WCAG 2.5.5). */
internal val MinTarget: Dp = 48.dp

// The card every interactive element draws on: a title, the question, then its controls and a live line. A reaction's
// card is the one that casts no shadow (`.ta-reaction`; the poll's and the rating's `.ta-poll` do).
@Composable
internal fun CardColumn(
    title: String?,
    question: String,
    dark: Boolean?,
    canvas: CanvasMetrics,
    modifier: Modifier,
    shadowed: Boolean = true,
    content: @Composable ColumnScope.() -> Unit,
) {
    val (card, ink) = cardColors(dark)
    val base = canvas.h(CARD_FONT)
    val shape = RoundedCornerShape(canvas.dp(canvas.h(CARD_RADIUS)))
    Column(
        modifier
            // The web's card shadow, `0 1cqh 3cqh -1.6cqh` in the ink at 35 %: a soft lift under the card.
            .then(
                if (shadowed) Modifier.shadow(canvas.dp(canvas.h(0.01)), shape, ambientColor = ink.copy(alpha = 0.35f), spotColor = ink.copy(alpha = 0.35f))
                else Modifier,
            )
            .clip(shape)
            .background(card)
            .padding(canvas.dp(canvas.h(CARD_PADDING)))
            .semantics { contentDescription = question },
        // The card's content sits in the middle of its box (`justify-content: center`), as the web's card does.
        verticalArrangement = Arrangement.spacedBy(canvas.dp(canvas.h(0.012)), Alignment.CenterVertically),
    ) {
        title?.let {
            BasicText(
                it,
                style = TextStyle(color = ink.copy(alpha = 0.85f), fontSize = canvas.sp(base * 0.75f), fontWeight = FontWeight.SemiBold),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        BasicText(
            question,
            style = TextStyle(color = ink, fontSize = canvas.sp(base * 1.1f), fontWeight = FontWeight.Bold, textAlign = TextAlign.Start),
        )
        content()
    }
}

// The line the live region says (`aria-live="polite"`): the result, a refusal or a preview's note. Like the web's
// visually hidden `.ta-sr` line it is said, never drawn: the options already show the result, and a sentence in the card
// would be clipped. A 1 dp node carries it as its description.
@Composable
internal fun LiveLine(text: String, ink: Color, canvas: CanvasMetrics) = SpokenLine(text)

// The line screen readers say and nothing draws (the web SDK's visually hidden live region): a reaction's counts
// read out in one sentence would be a long clipped line on screen. A 1 dp node carries it as its description.
@Composable
internal fun SpokenLine(text: String) {
    Box(
        Modifier
            .size(1.dp)
            .semantics {
                liveRegion = LiveRegionMode.Polite
                if (text.isNotEmpty()) contentDescription = text
            },
    )
}

// ---- Poll and quiz ----------------------------------------------------------------------------

// A quiz's mark on a choice: right (the correct answer) or wrong (the visitor's wrong answer).
internal enum class Mark { Right, Wrong }

/**
 * A poll (`renderPoll`): its question over its options, drawn in the poll's `view`. Once voted the options
 * show each option's share with the vote selected, and the result is said in the live line; without a
 * response (a preview) the choice is marked and nothing is recorded.
 */
@Composable
internal fun PollElement(element: DocumentElement.Poll, canvas: CanvasMetrics, responder: ElementResponder?, modifier: Modifier) {
    ChoiceCardElement(
        id = element.id,
        type = "poll",
        title = element.title,
        question = element.question,
        dark = element.dark,
        choices = element.options,
        quiz = false,
        correctId = null,
        view = element.view,
        canvas = canvas,
        responder = responder,
        modifier = modifier,
    )
}

/**
 * A quiz (`renderQuiz`): as a poll, with the answer marked once answered: a correct answer with a tick,
 * a wrong one with a cross (a glyph and words as well as colour), and what the visitor answered. A quiz
 * without a correct answer is a survey and shows only the shares. A quiz is always drawn as a sticker.
 */
@Composable
internal fun QuizElement(element: DocumentElement.Quiz, canvas: CanvasMetrics, responder: ElementResponder?, modifier: Modifier) {
    ChoiceCardElement(
        id = element.id,
        type = "quiz",
        title = element.title,
        question = element.question,
        dark = element.dark,
        choices = element.answers,
        quiz = true,
        correctId = element.correctAnswerId,
        view = PollView.Sticker,
        canvas = canvas,
        responder = responder,
        modifier = modifier,
    )
}

/**
 * The state of a poll's or quiz's choices: the answer shown (the visitor's, or a preview's press), the result,
 * whether a send is in flight, and the lines said for it. [press] takes a choice, as a tap does.
 */
internal class ChoiceState(
    /** The choice shown as the visitor's: their answer, or a preview's press; null when none. */
    val shown: String?,
    /** The result the server gave with the answer; null before it. */
    val result: ResponseResult?,
    val busy: Boolean,
    /** The live line: the result, a refusal or a preview's note. */
    val live: String,
    /** The announcement with the shares, said to screen readers only. */
    val spoken: String,
    /** Whether the choices are a quiz's answers. */
    val quiz: Boolean,
    private val correctId: String?,
    private val onPress: (Choice) -> Unit,
) {
    /** Locked once a choice is shown: one answer per visitor and element. */
    val locked: Boolean get() = shown != null

    /** The quiz's mark on [choice]: right on the correct answer always, wrong on the visitor's wrong answer. */
    fun markOf(choice: Choice): Mark? = when {
        shown == null || !quiz || correctId == null -> null
        choice.id == correctId -> Mark.Right
        choice.id == shown -> Mark.Wrong
        else -> null
    }

    fun press(choice: Choice) = onPress(choice)
}

/** The choices' state of one element: its kept answer, its preview press and the send of a press. */
@Composable
internal fun rememberChoiceState(
    id: String,
    type: String,
    choices: List<Choice>,
    quiz: Boolean,
    correctId: String?,
    responder: ElementResponder?,
): ChoiceState {
    val t = LocalTaleartContext.current.translate
    val scope = rememberCoroutineScope()
    // The visitor's kept answer, read once; a press here marks a preview's choice and records nothing.
    var answer by remember(id) { mutableStateOf(responder?.stored(id)) }
    var preview by remember(id) { mutableStateOf<String?>(null) }
    var busy by remember(id) { mutableStateOf(false) }
    var live by remember(id) { mutableStateOf("") }
    var spoken by remember(id) { mutableStateOf("") }
    val shown = answer?.value ?: preview

    fun start(value: String) = if (quiz) quizStart(choices, correctId, value, t) else pollStart(choices, value, t)
    val failed = if (quiz) t("quiz.failed") else t("poll.failed")

    fun press(choice: Choice) {
        if (shown != null || busy) return
        if (responder == null) {
            preview = choice.id
            // The web preview words a poll's press "You chose", and a quiz's as an answer.
            val begin = if (quiz) quizStart(choices, correctId, choice.id, t) else t("poll.chose", mapOf("label" to choice.label))
            val note = t(if (quiz) "quiz.previewNotRecorded" else "poll.previewNotRecorded")
            live = if (begin.isEmpty()) note else "$begin $note"
            return
        }
        busy = true
        scope.launch {
            when (val outcome = responder.send(ComponentRef(id, type), choice.id)) {
                is ResponseOutcome.Answered -> {
                    val response = outcome.response
                    answer = StoredResponse(response.value, response.result)
                    live = start(response.value)
                    spoken = choiceSaying(start(response.value), choices, response.result)
                }
                is ResponseOutcome.Failed -> live = failed
            }
            busy = false
        }
    }

    return ChoiceState(
        shown = shown,
        result = answer?.result,
        busy = busy,
        live = live,
        spoken = spoken,
        quiz = quiz,
        correctId = correctId,
        onPress = ::press,
    )
}

@Composable
private fun ChoiceCardElement(
    id: String,
    type: String,
    title: String?,
    question: String,
    dark: Boolean?,
    choices: List<Choice>,
    quiz: Boolean,
    correctId: String?,
    view: PollView,
    canvas: CanvasMetrics,
    responder: ElementResponder?,
    modifier: Modifier,
) {
    val state = rememberChoiceState(id, type, choices, quiz, correctId, responder)
    val reduced = rememberTaleReducedMotion()
    val (_, ink) = cardColors(dark)
    // A quiz is always a sticker: its marks read on the buttons, as the Web SDK draws it.
    val drawn = if (quiz) PollView.Sticker else view
    CardColumn(title, question, dark, canvas, modifier) {
        // The card lays its own rows out in the host's direction, as the canvas places it left to right.
        HostDirection {
        when (drawn) {
            PollView.Sticker -> ChoiceButtons(state, choices, dark, canvas, reduced, ChoiceShape.Pill)
            PollView.Embed -> {
                EmbedHeader(state, ink, canvas)
                ChoiceButtons(state, choices, dark, canvas, reduced, ChoiceShape.Card)
            }
            PollView.Inline -> InlineView(state, choices, dark, canvas, reduced)
            PollView.ThisOrThat -> if (choices.size == 2) {
                ThisOrThatView(state, choices[0], choices[1], canvas, reduced)
            } else {
                ChoiceButtons(state, choices, dark, canvas, reduced, ChoiceShape.Pill)
            }
            PollView.Grid -> if (choices.size == 2) {
                GridView(state, choices, canvas, reduced)
            } else {
                ChoiceButtons(state, choices, dark, canvas, reduced, ChoiceShape.Pill)
            }
        }
        }
        LiveLine(state.live, ink, canvas)
        SpokenLine(state.spoken)
    }
}

// The buttons of a choice card, one per choice, in the shape the view draws them in.
@Composable
private fun ChoiceButtons(state: ChoiceState, choices: List<Choice>, dark: Boolean?, canvas: CanvasMetrics, reduced: Boolean, shape: ChoiceShape) {
    for (choice in choices) {
        ChoiceButton(
            label = choice.label,
            percent = state.result?.let { percentOf(it, choice.id) },
            selected = state.shown == choice.id,
            mark = state.markOf(choice),
            enabled = !state.locked && !state.busy,
            dark = dark,
            canvas = canvas,
            reduced = reduced,
            shape = shape,
            onClick = { state.press(choice) },
        )
    }
}

/** A choice button's shape and size: a pill (the sticker and quiz), a rounded card row (embed) or a compact row (inline). */
internal enum class ChoiceShape { Pill, Card, Compact }

// One choice as a button of at least 48 dp: its label, its share once answered (a bar behind it, filled with a
// spring), the quiz's mark (a glyph and words as well as colour, and a shake on a wrong answer). Selected is
// the visitor's choice (it pops once); a disabled button is one that took no press.
@Composable
internal fun ChoiceButton(
    label: String,
    percent: Int?,
    selected: Boolean,
    mark: Mark?,
    enabled: Boolean,
    dark: Boolean?,
    canvas: CanvasMetrics,
    reduced: Boolean,
    shape: ChoiceShape,
    onClick: () -> Unit,
    modifier: Modifier = Modifier.fillMaxWidth(),
) {
    val t = LocalTaleartContext.current.translate
    val (_, ink) = cardColors(dark)
    val base = canvas.h(CARD_FONT)
    val radius = when (shape) {
        ChoiceShape.Pill -> RoundedCornerShape(50)
        ChoiceShape.Card -> RoundedCornerShape(canvas.dp(base * 0.8f))
        ChoiceShape.Compact -> RoundedCornerShape(50)
    }
    val palette = rememberThemeColors()
    // As the Web SDK: a card drawn light or dark on purpose uses that card's mark; an automatic one the scheme's.
    val markColor = when (mark) {
        Mark.Right -> when (dark) { true -> palette.successOnDark; false -> palette.success; null -> palette.successInk }
        Mark.Wrong -> when (dark) { true -> palette.errorOnDark; false -> palette.error; null -> palette.errorInk }
        null -> ink
    }
    val markWord = when (mark) {
        Mark.Right -> t("quiz.correct")
        Mark.Wrong -> t("quiz.wrong")
        null -> ""
    }
    val glyph = when (mark) {
        Mark.Right -> "✓"
        Mark.Wrong -> "\u2715"
        null -> ""
    }
    val fill = rememberFill((percent ?: 0) / 100f, reduced)
    val pop = rememberPop(selected, reduced)
    val shake = rememberShake(mark == Mark.Wrong, reduced)
    val spoken = buildString {
        append(label).append(markWord)
        if (percent != null) append(", ").append(percent).append('%')
    }
    // The web's border: 0.25cqh at 35 % of the ink while idle, 0.5cqh in the ink once chosen, in the mark's colour on a mark.
    val edge = canvas.h(0.0025)
    val borderColor = if (mark != null) markColor else if (selected) ink else ink.copy(alpha = 0.35f)
    // Min height max(2.4em, 44px) (2.8em in the embed), never under the 48 dp target.
    val minHeight = maxOf(canvas.dp(base * if (shape == ChoiceShape.Card) 2.8f else 2.4f), MinTarget)
    Box(
        modifier
            .defaultMinSize(minHeight = minHeight)
            .graphicsLayer {
                translationX = shake * density
                scaleX = pop
                scaleY = pop
            }
            .clip(radius)
            .border(canvas.dp(if (selected || mark != null) edge * 2 else edge), borderColor, radius)
            .selectable(selected = selected, enabled = enabled, role = Role.RadioButton, onClick = onClick)
            .semantics(mergeDescendants = true) {
                contentDescription = spoken
                if (!enabled) disabled()
            },
        contentAlignment = Alignment.CenterStart,
    ) {
        if (percent != null) {
            // The button's own box, not the column's (a fill that takes the free height pushed the other options out); inside it
            // the fill is the share's width from the start. (A fraction width followed by matchParentSize drew it full width.)
            Box(Modifier.matchParentSize()) {
                Box(
                    Modifier
                        .fillMaxHeight()
                        .fillMaxWidth(fill.coerceIn(0f, 1f))
                        .background(markColor.copy(alpha = 0.22f))
                        .testTag(CHOICE_FILL_TAG),
                )
            }
        }
        Row(
            Modifier.padding(horizontal = canvas.dp(base * if (shape == ChoiceShape.Compact) 1.0f else 0.9f), vertical = canvas.dp(base * if (shape == ChoiceShape.Compact) 0.3f else 0.4f)),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(canvas.dp(base * 0.5f)),
        ) {
            BasicText(
                label,
                style = TextStyle(color = ink, fontSize = canvas.sp(base), fontWeight = FontWeight.SemiBold),
                // A compact pill is as wide as its label (`inline-size: auto`); the others fill their row.
                modifier = if (shape == ChoiceShape.Compact) Modifier else Modifier.weight(1f),
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            if (glyph.isNotEmpty()) {
                BasicText(glyph, style = TextStyle(color = markColor, fontSize = canvas.sp(base), fontWeight = FontWeight.ExtraBold), modifier = Modifier.clearAndSetSemantics { })
            }
            if (percent != null) {
                // A percentage reads left to right in any direction: the number, then its sign.
                LeftToRight {
                    BasicText("$percent%", style = TextStyle(color = ink, fontSize = canvas.sp(base), fontWeight = FontWeight.Bold), modifier = Modifier.clearAndSetSemantics { })
                }
            }
        }
    }
}

// ---- Rating -----------------------------------------------------------------------------------

/**
 * The Rating's value from its tap or drag position [x] (from the left edge) along a track [width] wide: 0 at
 * the track's start and 100 at its end, which is the right in right to left ([rtl]) and the left otherwise.
 */
internal fun ratingAt(x: Float, width: Float, rtl: Boolean = false): Int {
    if (width <= 0f) return 50
    val fromStart = if (rtl) width - x else x
    return (fromStart / width * 100f).roundToInt().coerceIn(0, 100)
}

/** The distance from the left edge of a track [width] wide to the point of [value] (0 to 100) on it: mirrored in right to left. */
internal fun ratingLeft(value: Float, width: Float, rtl: Boolean = false): Float {
    val fromStart = value.coerceIn(0f, 100f) / 100f * width
    return if (rtl) width - fromStart else fromStart
}

/**
 * The emoji thumb's size in ems of the card: it grows with the value, from 1.6em at 0 to 2.8em at 100
 * (`calc(1.6em + var(--ta-v) * 0.012em)`, the thumb grows as the rating does).
 */
internal fun ratingThumbEm(value: Float): Float = 1.6f + 0.012f * value.coerceIn(0f, 100f)

/**
 * The Rating's value after a key: arrows and Page keys step by 10, Home and End go to the ends. The arrow
 * toward the end of the track raises it: right, or left in right to left ([rtl]). Null for another key.
 */
internal fun ratingKey(value: Int, key: Key, rtl: Boolean = false): Int? {
    val up = if (rtl) Key.DirectionLeft else Key.DirectionRight
    val down = if (rtl) Key.DirectionRight else Key.DirectionLeft
    return when (key) {
        Key.DirectionUp, up, Key.PageUp -> (value + 10).coerceAtMost(100)
        Key.DirectionDown, down, Key.PageDown -> (value - 10).coerceAtLeast(0)
        Key.MoveHome -> 0
        Key.MoveEnd -> 100
        else -> null
    }
}

/**
 * A Rating (`renderRating`): a question over a slider from 0 to 100 whose thumb is the emoji, and which grows
 * with the value. The visitor drags the emoji or taps the track, or moves it with the arrow keys and Enter;
 * the rating is posted on release (or Enter). Once rated the track marks the average and the count and average show.
 */
@Composable
internal fun RatingElement(element: DocumentElement.Rating, canvas: CanvasMetrics, responder: ElementResponder?, modifier: Modifier) {
    val t = LocalTaleartContext.current.translate
    val scope = rememberCoroutineScope()
    var answer by remember(element.id) { mutableStateOf(responder?.stored(element.id)) }
    var value by remember(element.id) { mutableFloatStateOf(answer?.value?.toFloatOrNull() ?: 50f) }
    var previewed by remember(element.id) { mutableStateOf(false) }
    var busy by remember(element.id) { mutableStateOf(false) }
    var live by remember(element.id) { mutableStateOf("") }
    var width by remember(element.id) { mutableStateOf(0) }
    val locked = answer != null || previewed
    val result = answer?.result as? RatingResult
    val (_, ink) = cardColors(element.dark)
    val base = canvas.h(CARD_FONT)

    fun set(next: Int) {
        if (locked || busy) return
        value = next.coerceIn(0, 100).toFloat()
    }

    fun submit() {
        if (locked || busy) return
        val rated = value.roundToInt()
        if (responder == null) {
            previewed = true
            live = t("rating.previewRated", mapOf("value" to rated))
            return
        }
        busy = true
        scope.launch {
            when (val outcome = responder.send(ComponentRef(element.id, "rating"), rated.toString())) {
                is ResponseOutcome.Answered -> {
                    val response = outcome.response
                    answer = StoredResponse(response.value, response.result)
                    value = response.value.toFloatOrNull() ?: rated.toFloat()
                    val summary = (response.result as? RatingResult)?.let { ratingSummary(it, t) + "." }.orEmpty()
                    live = "${t("rating.sent", mapOf("value" to rated))} $summary".trimEnd()
                }
                is ResponseOutcome.Failed -> live = t("rating.failed")
            }
            busy = false
        }
    }

    // The track runs from its start edge (the left, or the right in right to left) to its end edge.
    val rtl = LocalHostLayoutDirection.current == LayoutDirection.Rtl
    val thumbPx = base * ratingThumbEm(value)
    CardColumn(element.title, element.question, element.dark, canvas, modifier) {
        // The track: its bar, the fill to the value, the average once rated, and the emoji thumb.
        Box(
            Modifier
                .fillMaxWidth()
                // `margin: 0 1.2em; block-size: max(2.4em, 44px)`, never under the 48 dp target.
                .padding(horizontal = canvas.dp(base * 1.2f))
                .height(maxOf(canvas.dp(base * 2.4f), MinTarget))
                .onSizeChanged { width = it.width }
                .semantics {
                    contentDescription = t("rating.sliderLabel")
                    stateDescription = t(
                        if (locked) "rating.ratedValueText" else "rating.valueText",
                        mapOf("value" to value.roundToInt(), "max" to 100),
                    )
                    progressBarRangeInfo = ProgressBarRangeInfo(value / 100f, 0f..1f)
                    if (locked) disabled()
                    setProgress { fraction ->
                        if (locked) false else {
                            set((fraction * 100f).roundToInt())
                            true
                        }
                    }
                    // A screen reader moves the value with setProgress but cannot press Enter or release a drag: a
                    // click action (double-tap) sends it, also listed as a custom action. Locked or busy: none.
                    if (!locked && !busy) {
                        val sendLabel = t("rating.send")
                        onClick(label = sendLabel) { submit(); true }
                        customActions = listOf(CustomAccessibilityAction(sendLabel) { submit(); true })
                    }
                }
                .focusable(enabled = !locked)
                .onKeyEvent { event ->
                    if (locked || event.type != KeyEventType.KeyDown) return@onKeyEvent false
                    if (event.key == Key.Enter) {
                        submit()
                        return@onKeyEvent true
                    }
                    val next = ratingKey(value.roundToInt(), event.key, rtl) ?: return@onKeyEvent false
                    set(next)
                    true
                }
                .pointerInput(locked) {
                    if (!locked) detectTapGestures(onTap = { position ->
                        set(ratingAt(position.x, width.toFloat(), rtl))
                        submit()
                    })
                }
                .pointerInput(locked) {
                    if (!locked) detectHorizontalDragGestures(
                        onDragStart = { position -> set(ratingAt(position.x, width.toFloat(), rtl)) },
                        onHorizontalDrag = { change, _ -> set(ratingAt(change.position.x, width.toFloat(), rtl)) },
                        onDragEnd = { submit() },
                    )
                },
            contentAlignment = Alignment.CenterStart,
        ) {
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(canvas.dp(base * 0.6f))
                    .clearAndSetSemantics { }
                    .background(ink.copy(alpha = 0.2f), RoundedCornerShape(50)),
            )
            Box(
                Modifier
                    .fillMaxWidth(value.coerceIn(0f, 100f) / 100f)
                    .height(canvas.dp(base * 0.6f))
                    .clearAndSetSemantics { }
                    .background(ink.copy(alpha = 0.6f), RoundedCornerShape(50)),
            )
            result?.let { r ->
                // The average mark: 0.3em by 1.6em, rounded, with a halo (`0 0 0 .12em` in the ink at 30 %).
                val halo = base * 0.12f
                Box(
                    Modifier
                        .offset { IntOffset((ratingLeft(r.average.toFloat(), width.toFloat(), rtl) - (base * 0.15f + halo)).roundToInt(), 0) }
                        .width(canvas.dp(base * 0.3f + 2 * halo))
                        .height(canvas.dp(base * 1.6f + 2 * halo))
                        .clearAndSetSemantics { }
                        .background(ink.copy(alpha = 0.3f), RoundedCornerShape(50))
                        .padding(canvas.dp(halo))
                        .background(ink, RoundedCornerShape(50)),
                )
            }
            BasicText(
                element.emoji,
                style = TextStyle(color = ink, fontSize = canvas.sp(thumbPx)),
                modifier = Modifier
                    .offset { IntOffset((ratingLeft(value, width.toFloat(), rtl) - thumbPx / 2f).roundToInt(), 0) }
                    .clearAndSetSemantics { },
                softWrap = false,
                maxLines = 1,
            )
        }
        result?.let { r -> BasicText(ratingSummary(r, t), style = TextStyle(color = ink, fontSize = canvas.sp(base * 0.85f), fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center), modifier = Modifier.fillMaxWidth()) }
        LiveLine(live, ink, canvas)
    }
}

// ---- Reaction ---------------------------------------------------------------------------------

/**
 * A Reaction (`renderReaction`): a question over a row of emoji buttons, each at least 48 dp. The visitor
 * taps one; the emoji rises from its button and fades, and the row then shows each emoji's count with the
 * tapped one selected, and the counts are said in the live line. No second tap is taken.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun ReactionElement(element: DocumentElement.Reaction, canvas: CanvasMetrics, responder: ElementResponder?, modifier: Modifier) {
    val t = LocalTaleartContext.current.translate
    val scope = rememberCoroutineScope()
    var answer by remember(element.id) { mutableStateOf(responder?.stored(element.id)) }
    var previewed by remember(element.id) { mutableStateOf<String?>(null) }
    var busy by remember(element.id) { mutableStateOf(false) }
    var live by remember(element.id) { mutableStateOf("") }
    // The emoji that rises: the last one tapped, and a count of taps that restarts its rise each time.
    var risen by remember(element.id) { mutableStateOf<String?>(null) }
    var taps by remember(element.id) { mutableIntStateOf(0) }
    val reduced = rememberTaleReducedMotion()
    val shown = answer?.value ?: previewed
    val locked = shown != null
    val result = answer?.result
    val (_, ink) = cardColors(element.dark)
    val base = canvas.h(CARD_FONT)
    val emojiPx = base * 2f

    fun press(emoji: String) {
        if (locked || busy) return
        risen = emoji
        taps += 1
        if (responder == null) {
            previewed = emoji
            return
        }
        busy = true
        scope.launch {
            when (val outcome = responder.send(ComponentRef(element.id, "reaction"), emoji)) {
                is ResponseOutcome.Answered -> {
                    val response = outcome.response
                    answer = StoredResponse(response.value, response.result)
                    live = element.emojis.joinToString(", ") { "$it ${t("reaction.count", mapOf("count" to reactionCount(response.result, it)))}" }
                }
                is ResponseOutcome.Failed -> live = t("reaction.failed")
            }
            busy = false
        }
    }

    CardColumn(element.title, element.question, element.dark, canvas, modifier, shadowed = false) {
        // `.ta-reaction-row`: wrapping, centred, a gap of 1cqh.
        FlowRow(
            Modifier.fillMaxWidth().selectableGroup(),
            horizontalArrangement = Arrangement.spacedBy(canvas.dp(canvas.h(0.01)), Alignment.CenterHorizontally),
            verticalArrangement = Arrangement.spacedBy(canvas.dp(canvas.h(0.01))),
        ) {
            for (emoji in element.emojis) {
                val pressed = shown == emoji
                val count = if (result != null) reactionCount(result, emoji) else null
                val spoken = if (count != null) "$emoji, ${t("reaction.count", mapOf("count" to count))}" else emoji
                val shape = RoundedCornerShape(canvas.dp(base))
                val pop = rememberPop(pressed, reduced)
                Box(contentAlignment = Alignment.TopCenter) {
                    Column(
                        Modifier
                            .defaultMinSize(minWidth = maxOf(canvas.dp(base * 3.4f), MinTarget), minHeight = MinTarget)
                            .graphicsLayer { scaleX = pop; scaleY = pop }
                            .clip(shape)
                            // A pressed emoji fills the ink at 30 %.
                            .background(if (pressed) ink.copy(alpha = 0.3f) else Color.Transparent, shape)
                            .border(canvas.dp(canvas.h(if (pressed) 0.005 else 0.0025)), ink, shape)
                            .clickable(enabled = !locked && !busy, role = Role.Button) { press(emoji) }
                            .semantics(mergeDescendants = true) {
                                selected = pressed
                                contentDescription = spoken
                                if (locked) disabled()
                            }
                            .padding(horizontal = canvas.dp(base * 0.5f), vertical = canvas.dp(base * 0.3f)),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        BasicText(emoji, style = TextStyle(fontSize = canvas.sp(emojiPx), textAlign = TextAlign.Center), softWrap = false, maxLines = 1)
                        // The count's line is kept before the result (`min-height: 1.2em`), so the buttons do not grow when it comes.
                        Box(Modifier.height(canvas.dp(base * 0.8f * 1.2f)).clearAndSetSemantics { }, contentAlignment = Alignment.Center) {
                            if (count != null) {
                                LeftToRight { BasicText("$count", style = TextStyle(color = ink, fontSize = canvas.sp(base * 0.8f), fontWeight = FontWeight.Bold)) }
                            }
                        }
                    }
                    if (risen == emoji) {
                        RisingEmoji(restart = taps, reduced = reduced) { progress ->
                            BasicText(
                                emoji,
                                style = TextStyle(fontSize = canvas.sp(base * 1.6f), textAlign = TextAlign.Center),
                                softWrap = false,
                                maxLines = 1,
                                modifier = Modifier
                                    .clearAndSetSemantics { }
                                    .offset { IntOffset(0, -(canvas.h(0.12) * progress).roundToInt()) }
                                    .graphicsLayer { alpha = risingAlpha(progress) },
                            )
                        }
                    }
                }
            }
        }
        SpokenLine(live)
    }
}
