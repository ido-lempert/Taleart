package site.lempert.taleart.sdk.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.setProgress
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
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
// A preview (inert links, the Tale Studio) marks the choice and sends nothing.

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
private val MinTarget: Dp = 48.dp

// The card every interactive element draws on: a title, the question, then its controls and a live line.
@Composable
private fun CardColumn(
    title: String?,
    question: String,
    dark: Boolean,
    canvas: CanvasMetrics,
    modifier: Modifier,
    content: @Composable () -> Unit,
) {
    val (card, ink) = cardColors(dark)
    val base = canvas.h(CARD_FONT)
    Column(
        modifier
            .clip(RoundedCornerShape(canvas.dp(canvas.h(CARD_RADIUS))))
            .background(card)
            .padding(canvas.dp(canvas.h(CARD_PADDING)))
            .semantics { contentDescription = question },
        verticalArrangement = Arrangement.spacedBy(canvas.dp(canvas.h(0.012))),
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

// The line the live region says (`aria-live="polite"`): the result, a refusal or a preview's note.
@Composable
private fun LiveLine(text: String, ink: androidx.compose.ui.graphics.Color, canvas: CanvasMetrics) {
    BasicText(
        text,
        style = TextStyle(color = ink, fontSize = canvas.sp(canvas.h(CARD_FONT) * 0.8f), fontWeight = FontWeight.SemiBold),
        modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
    )
}

// ---- Poll and quiz ----------------------------------------------------------------------------

// A quiz's mark on a choice: right (the correct answer) or wrong (the visitor's wrong answer).
private enum class Mark { Right, Wrong }

/**
 * A poll (`renderPoll`): its question over two option buttons. Once voted the buttons show each option's
 * share with the vote selected, and the result is said in the live line; without a response (a preview)
 * the choice is marked and nothing is recorded.
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
        canvas = canvas,
        responder = responder,
        modifier = modifier,
    )
}

/**
 * A quiz (`renderQuiz`): as a poll, with the answer marked once answered: a correct answer with a tick,
 * a wrong one with a cross (a glyph and words as well as colour), and what the visitor answered. A quiz
 * without a correct answer is a survey and shows only the shares.
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
        canvas = canvas,
        responder = responder,
        modifier = modifier,
    )
}

@Composable
private fun ChoiceCardElement(
    id: String,
    type: String,
    title: String?,
    question: String,
    dark: Boolean,
    choices: List<Choice>,
    quiz: Boolean,
    correctId: String?,
    canvas: CanvasMetrics,
    responder: ElementResponder?,
    modifier: Modifier,
) {
    val t = LocalTaleartContext.current.translate
    val scope = rememberCoroutineScope()
    // The visitor's kept answer, read once; a press here marks a preview's choice and records nothing.
    var answer by remember(id) { mutableStateOf(responder?.stored(id)) }
    var preview by remember(id) { mutableStateOf<String?>(null) }
    var busy by remember(id) { mutableStateOf(false) }
    var live by remember(id) { mutableStateOf("") }
    val shown = answer?.value ?: preview
    val locked = shown != null
    val result = answer?.result
    val (_, ink) = cardColors(dark)

    fun start(value: String) = if (quiz) quizStart(choices, correctId, value, t) else pollStart(choices, value, t)
    val failed = if (quiz) t("quiz.failed") else t("poll.failed")

    fun press(choice: Choice) {
        if (locked || busy) return
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
                    live = choiceSaying(start(response.value), choices, response.result)
                }
                is ResponseOutcome.Failed -> live = failed
            }
            busy = false
        }
    }

    CardColumn(title, question, dark, canvas, modifier, content = {
        for (choice in choices) {
            val mark = when {
                shown == null || !quiz || correctId == null -> null
                choice.id == correctId -> Mark.Right
                choice.id == shown -> Mark.Wrong
                else -> null
            }
            ChoiceButton(
                label = choice.label,
                percent = if (result != null) percentOf(result, choice.id) else null,
                selected = shown == choice.id,
                mark = mark,
                enabled = !locked && !busy,
                dark = dark,
                canvas = canvas,
                onClick = { press(choice) },
            )
        }
        LiveLine(live, ink, canvas)
    })
}

// One choice as a button of at least 48 dp: its label, its share once answered (a bar behind it), the
// quiz's mark. Selected is the visitor's choice; a disabled button is one that took no press.
@Composable
private fun ChoiceButton(
    label: String,
    percent: Int?,
    selected: Boolean,
    mark: Mark?,
    enabled: Boolean,
    dark: Boolean,
    canvas: CanvasMetrics,
    onClick: () -> Unit,
) {
    val t = LocalTaleartContext.current.translate
    val (_, ink) = cardColors(dark)
    val base = canvas.h(CARD_FONT)
    val shape = RoundedCornerShape(50)
    val markColor = when (mark) {
        Mark.Right -> if (dark) androidx.compose.ui.graphics.Color(0xFF6EE7B7) else androidx.compose.ui.graphics.Color(0xFF065F46)
        Mark.Wrong -> if (dark) androidx.compose.ui.graphics.Color(0xFFFCA5A5) else androidx.compose.ui.graphics.Color(0xFF991B1B)
        null -> ink
    }
    val markWord = when (mark) {
        Mark.Right -> t("quiz.correct")
        Mark.Wrong -> t("quiz.wrong")
        null -> ""
    }
    val glyph = when (mark) {
        Mark.Right -> "✓"
        Mark.Wrong -> "✗"
        null -> ""
    }
    val spoken = buildString {
        append(label).append(markWord)
        if (percent != null) append(", ").append(percent).append('%')
    }
    val edge = canvas.h(0.0025)
    Box(
        Modifier
            .fillMaxWidth()
            .defaultMinSize(minHeight = MinTarget)
            .clip(shape)
            .border(canvas.dp(if (selected || mark != null) edge * 2 else edge), if (mark != null) markColor else ink, shape)
            .selectable(selected = selected, enabled = enabled, role = Role.RadioButton, onClick = onClick)
            .semantics(mergeDescendants = true) {
                contentDescription = spoken
                if (!enabled) disabled()
            },
        contentAlignment = Alignment.CenterStart,
    ) {
        if (percent != null) {
            Box(
                Modifier
                    .fillMaxWidth(percent.coerceIn(0, 100) / 100f)
                    .fillMaxHeight()
                    .background(ink.copy(alpha = 0.22f)),
            )
        }
        Row(
            Modifier.padding(horizontal = canvas.dp(base * 0.9f), vertical = canvas.dp(base * 0.5f)),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(canvas.dp(base * 0.5f)),
        ) {
            BasicText(
                label,
                style = TextStyle(color = ink, fontSize = canvas.sp(base), fontWeight = FontWeight.SemiBold),
                modifier = Modifier.weight(1f),
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            if (glyph.isNotEmpty()) {
                BasicText(glyph, style = TextStyle(color = markColor, fontSize = canvas.sp(base), fontWeight = FontWeight.ExtraBold), modifier = Modifier.clearAndSetSemantics { })
            }
            if (percent != null) {
                BasicText("$percent%", style = TextStyle(color = ink, fontSize = canvas.sp(base), fontWeight = FontWeight.Bold), modifier = Modifier.clearAndSetSemantics { })
            }
        }
    }
}

// ---- Rating -----------------------------------------------------------------------------------

/** The Rating's value from its tap or drag position, along the track from 0 to 100. */
internal fun ratingAt(x: Float, width: Float): Int {
    if (width <= 0f) return 50
    return (x / width * 100f).roundToInt().coerceIn(0, 100)
}

/** The Rating's value after a key: arrows and Page keys step by 10, Home and End go to the ends. Null for another key. */
internal fun ratingKey(value: Int, key: Key): Int? = when (key) {
    Key.DirectionUp, Key.DirectionRight, Key.PageUp -> (value + 10).coerceAtMost(100)
    Key.DirectionDown, Key.DirectionLeft, Key.PageDown -> (value - 10).coerceAtLeast(0)
    Key.MoveHome -> 0
    Key.MoveEnd -> 100
    else -> null
}

/**
 * A Rating (`renderRating`): a question over a slider from 0 to 100 whose thumb is the emoji. The visitor
 * drags the emoji or taps the track, or moves it with the arrow keys and Enter; the rating is posted on
 * release (or Enter). Once rated the track marks the average and the count and average show.
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

    val thumbPx = canvas.h(CARD_FONT) * 1.8f
    CardColumn(element.title, element.question, element.dark, canvas, modifier, content = {
        // The track: its bar, the fill to the value, the average once rated, and the emoji thumb.
        Box(
            Modifier
                .fillMaxWidth()
                .height(MinTarget)
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
                }
                .focusable(enabled = !locked)
                .onKeyEvent { event ->
                    if (locked || event.type != KeyEventType.KeyDown) return@onKeyEvent false
                    if (event.key == Key.Enter) {
                        submit()
                        return@onKeyEvent true
                    }
                    val next = ratingKey(value.roundToInt(), event.key) ?: return@onKeyEvent false
                    set(next)
                    true
                }
                .pointerInput(locked) {
                    if (!locked) detectTapGestures(onTap = { position ->
                        set(ratingAt(position.x, width.toFloat()))
                        submit()
                    })
                }
                .pointerInput(locked) {
                    if (!locked) detectHorizontalDragGestures(
                        onDragStart = { position -> set(ratingAt(position.x, width.toFloat())) },
                        onHorizontalDrag = { change, _ -> set(ratingAt(change.position.x, width.toFloat())) },
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
                    .background(ink.copy(alpha = 0.2f)),
            )
            Box(
                Modifier
                    .fillMaxWidth(value.coerceIn(0f, 100f) / 100f)
                    .height(canvas.dp(base * 0.6f))
                    .clearAndSetSemantics { }
                    .background(ink.copy(alpha = 0.6f)),
            )
            result?.let { r ->
                Box(
                    Modifier
                        .offset { IntOffset((r.average / 100f * width - base * 0.15f).roundToInt(), 0) }
                        .width(canvas.dp(base * 0.3f))
                        .height(canvas.dp(base * 1.4f))
                        .clearAndSetSemantics { }
                        .background(ink),
                )
            }
            BasicText(
                element.emoji,
                style = TextStyle(color = ink, fontSize = canvas.sp(thumbPx)),
                modifier = Modifier
                    .offset { IntOffset((value / 100f * width - thumbPx / 2f).roundToInt(), 0) }
                    .clearAndSetSemantics { },
                softWrap = false,
                maxLines = 1,
            )
        }
        result?.let { r -> BasicText(ratingSummary(r, t), style = TextStyle(color = ink, fontSize = canvas.sp(base * 0.85f), fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center), modifier = Modifier.fillMaxWidth()) }
        LiveLine(live, ink, canvas)
    })
}

// ---- Reaction ---------------------------------------------------------------------------------

/**
 * A Reaction (`renderReaction`): a question over a row of emoji buttons, each at least 48 dp. The visitor
 * taps one; the row then shows each emoji's count with the tapped one selected, and the counts are said
 * in the live line. No second tap is taken.
 */
@Composable
internal fun ReactionElement(element: DocumentElement.Reaction, canvas: CanvasMetrics, responder: ElementResponder?, modifier: Modifier) {
    val t = LocalTaleartContext.current.translate
    val scope = rememberCoroutineScope()
    var answer by remember(element.id) { mutableStateOf(responder?.stored(element.id)) }
    var previewed by remember(element.id) { mutableStateOf<String?>(null) }
    var busy by remember(element.id) { mutableStateOf(false) }
    var live by remember(element.id) { mutableStateOf("") }
    val shown = answer?.value ?: previewed
    val locked = shown != null
    val result = answer?.result
    val (_, ink) = cardColors(element.dark)
    val base = canvas.h(CARD_FONT)
    val emojiPx = canvas.h(CARD_FONT) * 2f

    fun press(emoji: String) {
        if (locked || busy) return
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

    CardColumn(element.title, element.question, element.dark, canvas, modifier, content = {
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(canvas.dp(base * 0.5f), Alignment.CenterHorizontally),
        ) {
            for (emoji in element.emojis) {
                val pressed = shown == emoji
                val count = if (result != null) reactionCount(result, emoji) else null
                val spoken = if (count != null) "$emoji, ${t("reaction.count", mapOf("count" to count))}" else emoji
                val shape = RoundedCornerShape(canvas.dp(canvas.h(0.02)))
                Column(
                    Modifier
                        .defaultMinSize(minWidth = MinTarget, minHeight = MinTarget)
                        .clip(shape)
                        .border(canvas.dp(canvas.h(if (pressed) 0.005 else 0.0025)), ink, shape)
                        .clickable(enabled = !locked && !busy, role = Role.Button) { press(emoji) }
                        .semantics(mergeDescendants = true) {
                            selected = pressed
                            contentDescription = spoken
                            if (locked) disabled()
                        }
                        .padding(horizontal = canvas.dp(base * 0.4f), vertical = canvas.dp(base * 0.3f)),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    BasicText(emoji, style = TextStyle(fontSize = canvas.sp(emojiPx * 0.6f), textAlign = TextAlign.Center), softWrap = false, maxLines = 1)
                    if (count != null) {
                        BasicText("$count", style = TextStyle(color = ink, fontSize = canvas.sp(base * 0.8f), fontWeight = FontWeight.Bold), modifier = Modifier.clearAndSetSemantics { })
                    }
                }
            }
        }
        LiveLine(live, ink, canvas)
    })
}
