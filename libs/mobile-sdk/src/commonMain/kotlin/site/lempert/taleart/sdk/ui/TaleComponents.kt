package site.lempert.taleart.sdk.ui

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlin.time.Instant

// The components of a tale document that the native SDK draws (components, 2026-10-29): a countdown
// and a promo code, read with the contract's rules as the Web SDK reads them
// (libs/contract/tale-document/element-types/countdown.schema.json, promo-code.schema.json). A prop
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

// `theme`: light (the default) or dark. False for light, true for dark, null for anything else.
private fun themeIsDark(props: JsonObject): Boolean? {
    if (!props.containsKey("theme")) return false
    return when (props.stringOf("theme")) {
        "light" -> false
        "dark" -> true
        else -> null
    }
}

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
    val dark = themeIsDark(props) ?: return null
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
    val dark = themeIsDark(props) ?: return null
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
