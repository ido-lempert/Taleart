package site.lempert.taleart.sdk.ui

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlin.time.Instant

// The components of a tale document that the native SDK draws (components, 2026-10-29): a countdown,
// a promo code, and the interactive components a visitor answers (a poll, a quiz, a rating and a
// reaction), read with the contract's rules as the Web SDK reads them
// (libs/contract/tale-document/element-types/countdown.schema.json, promo-code.schema.json, poll,
// quiz, rating and reaction schemas). A prop
// that is there and breaks its rule makes the element invalid, so the element is skipped, as an
// element of an unknown type is; a prop left out takes its default.

// A prop's text, or null when it is not a string (the same reading as the document's own props).
private fun JsonObject.stringOf(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content

/** An optional prop: left out, its value, or there and breaking its rule. */
private sealed interface Optional<out T> {
    data object Absent : Optional<Nothing>
    data object Invalid : Optional<Nothing>
    class Value<T>(val value: T) : Optional<T>
}

// A plain line of text as the schema allows it: from 1 to [max] code points, with no C0 or C1 control
// characters and no bidi embedding or isolate (U+202A to U+202E, U+2066 to U+2069).
internal fun isPlainLine(value: String, max: Int): Boolean {
    val length = codePointLength(value)
    if (length !in 1..max) return false
    return value.none { c ->
        val code = c.code
        code <= 0x1F || code in 0x7F..0x9F || code in 0x202A..0x202E || code in 0x2066..0x2069
    }
}

private fun codePointLength(value: String): Int {
    var count = 0
    var i = 0
    while (i < value.length) {
        i += if (value[i].isHighSurrogate() && i + 1 < value.length && value[i + 1].isLowSurrogate()) 2 else 1
        count++
    }
    return count
}

private fun optionalPlain(props: JsonObject, key: String, max: Int): Optional<String> {
    if (!props.containsKey(key)) return Optional.Absent
    val value = props.stringOf(key) ?: return Optional.Invalid
    return if (isPlainLine(value, max)) Optional.Value(value) else Optional.Invalid
}

// `theme`: light or dark; absent, the card follows the colour scheme (null). A refused value is not drawn (`themeRefused`).
private fun themeIsDark(props: JsonObject): Boolean? = when (props.stringOf("theme")) {
    "light" -> false
    "dark" -> true
    else -> null
}

private fun themeRefused(props: JsonObject): Boolean =
    props.containsKey("theme") && props.stringOf("theme") !in setOf("light", "dark")

// An ISO 8601 instant in UTC with a `Z` (the schema's pattern, at most 40 characters).
private val ENDS_AT = Regex("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]{1,9})?Z$")

/** The instant an `endsAt` prop names, or null when it is not a real date and time in that form. */
internal fun readInstant(value: String): Instant? =
    if (value.length <= 40 && ENDS_AT.matches(value)) runCatching { Instant.parse(value) }.getOrNull() else null

/** A countdown from its props (`countdown.schema.json`); null when the element is invalid. */
internal fun readCountdown(id: String, box: ElementBox, layer: Int, props: JsonObject): DocumentElement.Countdown? {
    val endsAt = props.stringOf("endsAt")?.let(::readInstant) ?: return null
    val title = optionalPlain(props, "title", 80)
    val endedText = optionalPlain(props, "endedText", 80)
    if (themeRefused(props)) return null
    val dark = themeIsDark(props)
    if (title === Optional.Invalid || endedText === Optional.Invalid) return null
    return DocumentElement.Countdown(
        id = id,
        box = box,
        layer = layer,
        title = (title as? Optional.Value)?.value,
        endsAt = endsAt,
        endedText = (endedText as? Optional.Value)?.value,
        dark = dark,
    )
}

// A promo code: 1 to 32 letters, digits, underscores or hyphens.
private val PROMO_CODE = Regex("^[A-Za-z0-9_-]{1,32}$")

/** A promo code from its props (`promo-code.schema.json`); null when the element is invalid. */
internal fun readPromoCode(id: String, box: ElementBox, layer: Int, props: JsonObject): DocumentElement.PromoCode? {
    val code = props.stringOf("code")?.takeIf { PROMO_CODE.matches(it) } ?: return null
    val title = optionalPlain(props, "title", 80)
    val note = optionalPlain(props, "note", 120)
    if (themeRefused(props)) return null
    val dark = themeIsDark(props)
    if (title === Optional.Invalid || note === Optional.Invalid) return null
    return DocumentElement.PromoCode(
        id = id,
        box = box,
        layer = layer,
        title = (title as? Optional.Value)?.value,
        code = code,
        note = (note as? Optional.Value)?.value,
        dark = dark,
    )
}

/** The time left until a countdown's end: whole days, hours, minutes and seconds, rounded up to the second. */
internal data class CountdownLeft(val days: Long, val hours: Long, val minutes: Long, val seconds: Long)

/**
 * The time from [now] to [endsAt], as the Web SDK's `timeLeft`: rounded up to the second, so the last
 * second shows until the end. Null at and after [endsAt].
 */
internal fun countdownLeft(endsAt: Instant, now: Instant): CountdownLeft? {
    val ms = endsAt.toEpochMilliseconds() - now.toEpochMilliseconds()
    if (ms <= 0) return null
    val total = (ms + 999) / 1000
    return CountdownLeft(
        days = total / 86_400,
        hours = (total % 86_400) / 3_600,
        minutes = (total % 3_600) / 60,
        seconds = total % 60,
    )
}

/** A countdown's number: two digits at least, as the Web SDK shows it (`03`, `12`, `100`). */
internal fun countdownNumber(value: Long): String = value.toString().padStart(2, '0')

/** A plain line of text the schema allows, required: from 1 to [max] code points, else null. */
private fun requiredPlain(props: JsonObject, key: String, max: Int): String? =
    props.stringOf(key)?.takeIf { isPlainLine(it, max) }

// A choice id as the schema allows it: one to 64 letters, digits, underscores or hyphens.
private val CHOICE_ID = Regex("^[A-Za-z0-9_-]{1,64}$")

/**
 * A poll's options or a quiz's answers from `{ id, label }` items (`options`, `answers`): [min] to [max]
 * of them, each id by its pattern and unique, each label a plain line that is not blank. Null when any
 * breaks its rule.
 */
private fun readChoices(props: JsonObject, key: String, min: Int, max: Int): List<Choice>? {
    val items = props[key] as? JsonArray ?: return null
    if (items.size !in min..max) return null
    val choices = items.map { item ->
        val o = item as? JsonObject ?: return null
        val choiceId = o.stringOf("id")?.takeIf { CHOICE_ID.matches(it) } ?: return null
        val label = o.stringOf("label")?.takeIf { isPlainLine(it, 60) && it.isNotBlank() } ?: return null
        Choice(choiceId, label)
    }
    return if (choices.map { it.id }.toSet().size == choices.size) choices else null
}

/** A poll from its props (`poll.schema.json`): two options; null when the element is invalid. */
internal fun readPoll(id: String, box: ElementBox, layer: Int, props: JsonObject): DocumentElement.Poll? {
    val question = requiredPlain(props, "question", 200) ?: return null
    val title = optionalPlain(props, "title", 80)
    val options = readChoices(props, "options", 2, 2) ?: return null
    if (themeRefused(props)) return null
    val dark = themeIsDark(props)
    if (title === Optional.Invalid) return null
    return DocumentElement.Poll(id, box, layer, (title as? Optional.Value)?.value, question, options, dark)
}

/**
 * A quiz from its props (`quiz.schema.json`): two to four answers and an optional correct answer. A
 * correct answer id that is none of the answers reads as no correct answer (a survey), as the Web SDK
 * reads it; one that breaks the id pattern makes the element invalid.
 */
internal fun readQuiz(id: String, box: ElementBox, layer: Int, props: JsonObject): DocumentElement.Quiz? {
    val question = requiredPlain(props, "question", 200) ?: return null
    val title = optionalPlain(props, "title", 80)
    val answers = readChoices(props, "answers", 2, 4) ?: return null
    val correct = if (props.containsKey("correctAnswerId")) {
        props.stringOf("correctAnswerId")?.takeIf { CHOICE_ID.matches(it) } ?: return null
    } else {
        null
    }
    if (themeRefused(props)) return null
    val dark = themeIsDark(props)
    if (title === Optional.Invalid) return null
    return DocumentElement.Quiz(
        id, box, layer, (title as? Optional.Value)?.value, question, answers,
        correctAnswerId = correct?.takeIf { c -> answers.any { it.id == c } },
        dark = dark,
    )
}

/** A Rating from its props (`rating.schema.json`): one emoji for the thumb; null when the element is invalid. */
internal fun readRating(id: String, box: ElementBox, layer: Int, props: JsonObject): DocumentElement.Rating? {
    val question = requiredPlain(props, "question", 200) ?: return null
    val title = optionalPlain(props, "title", 80)
    val emoji = props.stringOf("emoji")?.takeIf { isPlainLine(it, 64) && it.isNotBlank() } ?: return null
    if (themeRefused(props)) return null
    val dark = themeIsDark(props)
    if (title === Optional.Invalid) return null
    return DocumentElement.Rating(id, box, layer, (title as? Optional.Value)?.value, question, emoji, dark)
}

/**
 * A Reaction from its props (`reaction.schema.json`): two to six different emoji, each a plain line of
 * up to 64 code points; null when the element is invalid.
 */
internal fun readReaction(id: String, box: ElementBox, layer: Int, props: JsonObject): DocumentElement.Reaction? {
    val question = requiredPlain(props, "question", 200) ?: return null
    val title = optionalPlain(props, "title", 80)
    val items = props["emojis"] as? JsonArray ?: return null
    if (items.size !in 2..6) return null
    val emojis = items.map { item -> (item as? JsonPrimitive)?.takeIf { it.isString }?.content?.takeIf { isPlainLine(it, 64) && it.isNotBlank() } ?: return null }
    if (emojis.toSet().size != emojis.size) return null
    if (themeRefused(props)) return null
    val dark = themeIsDark(props)
    if (title === Optional.Invalid) return null
    return DocumentElement.Reaction(id, box, layer, (title as? Optional.Value)?.value, question, emojis, dark)
}
