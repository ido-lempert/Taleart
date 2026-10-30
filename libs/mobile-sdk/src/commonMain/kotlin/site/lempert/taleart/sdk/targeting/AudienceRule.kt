package site.lempert.taleart.sdk.targeting

/**
 * The audience rule (epic viewer properties): which tale groups a viewer sees, from the properties
 * the app passed in `TaleartConfig.properties` (segments, plan, age, ...). It is the native port of
 * `audienceRulePasses` and `viewerPropertiesFrom` in libs/contract/src/lib/audience-rule.ts, which
 * the Web SDK and the dashboard preview run; the shared test table is
 * libs/contract/targeting/audience-rule.cases.json, copied into commonTest (AudienceRuleTest). The
 * properties never leave the device; the server only sends the rule.
 *
 * Values as the rule reads them: a string, a number (every number is a Double, as in JavaScript),
 * a boolean, or a list of strings. Any other value is invalid.
 */

/** One test on one viewer property: `operator` names how it compares, `value` is what it compares with (none for `exists` and `notExists`). */
data class AudienceCondition(val property: String, val operator: String, val value: Any? = null)

/** A tale group's audience rule: `match` (`all` needs every condition, any other value one) over its conditions. */
data class AudienceRule(val match: String, val conditions: List<AudienceCondition>)

/** Longest property name (characters). */
internal const val MAX_PROPERTY_NAME_LENGTH = 64

/** Longest string value, in a property or in a rule (UTF-16 code units). */
internal const val MAX_PROPERTY_STRING_LENGTH = 256

/** Most items in a list value. */
internal const val MAX_PROPERTY_LIST_ITEMS = 50

/** Most properties a viewer passes; the first valid ones in the order given are kept. */
internal const val MAX_VIEWER_PROPERTIES = 50

private val PROPERTY_NAME = Regex("[A-Za-z][A-Za-z0-9_.-]{0,${MAX_PROPERTY_NAME_LENGTH - 1}}")

/**
 * The viewer's properties as the rule reads them: the valid entries, in the order given. A name must
 * match `^[A-Za-z][A-Za-z0-9_.-]{0,63}$` (case-sensitive, stored as given); a value must be a string
 * of at most 256 characters, a finite number, a boolean, or a list of at most 50 such strings. Other
 * entries are dropped, and only the first 50 valid ones are kept. Null (the app passed none) stays null:
 * every rule passes then.
 */
fun viewerPropertiesFrom(input: Map<String, Any?>?): Map<String, Any>? {
    if (input == null) return null
    val out = LinkedHashMap<String, Any>()
    for ((name, raw) in input) {
        if (out.size >= MAX_VIEWER_PROPERTIES) break
        if (!PROPERTY_NAME.matches(name)) continue
        out[name] = viewerValue(foundationValue(raw)) ?: continue
    }
    return out
}

/**
 * A value as the platform passed it, in the Kotlin form the rule reads: on iOS, a Swift value that
 * arrives as a Foundation object (an NSString, an NSNumber, an NSArray) becomes a String, a number or a
 * boolean, or a list. Any other value is returned as it is (Android and common values).
 */
internal expect fun foundationValue(raw: Any?): Any?

// One viewer value as the rule keeps it, or null when the entry is invalid.
private fun viewerValue(raw: Any?): Any? = when (raw) {
    is String -> raw.takeIf { it.length <= MAX_PROPERTY_STRING_LENGTH }
    is Boolean -> raw
    is Number -> raw.toDouble().takeIf { it.isFinite() }
    is List<*> -> if (raw.size <= MAX_PROPERTY_LIST_ITEMS && raw.all { it is String && it.length <= MAX_PROPERTY_STRING_LENGTH }) {
        raw.map { it as String }
    } else {
        null
    }
    else -> null
}

/**
 * True when a tale group's audience rule shows it to a viewer with [properties]. A group with no rule,
 * or a rule with no conditions, passes. Properties that were never passed (null) make every rule
 * pass. Otherwise the properties are normalised with [viewerPropertiesFrom] and each condition is
 * tested: a missing property fails, except for `neq`, `notIn` and `notExists`; a value of another
 * kind than the property's fails; an unknown operator fails.
 */
fun audienceRulePasses(rule: AudienceRule?, properties: Map<String, Any?>?): Boolean {
    if (rule == null || rule.conditions.isEmpty()) return true
    val viewer = viewerPropertiesFrom(properties) ?: return true
    return if (rule.match == "all") rule.conditions.all { conditionPasses(it, viewer) } else rule.conditions.any { conditionPasses(it, viewer) }
}

// Viewer and rule strings compare as the tag rule compares tags: NFC, trimmed, lower case.
private fun sameText(a: String, b: String): Boolean = normalizeTargetingTag(a) == normalizeTargetingTag(b)

// Whether a viewer value equals a rule value: strings ignore case (see sameText), numbers and booleans compare strictly.
private fun equal(viewer: Any, value: Any?): Boolean = when (viewer) {
    is String -> value is String && sameText(viewer, value)
    is Double -> value is Number && viewer == value.toDouble()
    is Boolean -> value is Boolean && viewer == value
    else -> false
}

// The kind a value has in the rule's terms (what JavaScript's typeof told the TypeScript rule apart).
private fun kindOf(value: Any?): String? = when (value) {
    is String -> "string"
    is Number -> "number"
    is Boolean -> "boolean"
    else -> null
}

private fun numberOf(value: Any?): Double? = (value as? Number)?.toDouble()

// One condition against the viewer's properties (the normalised ones).
private fun conditionPasses(condition: AudienceCondition, viewer: Map<String, Any>): Boolean {
    val present = viewer.containsKey(condition.property)
    when (condition.operator) {
        "exists" -> return present
        "notExists" -> return !present
    }
    // A missing property fails every test except the negated ones.
    if (!present) return condition.operator == "neq" || condition.operator == "notIn"
    val v = viewer.getValue(condition.property)
    val value = condition.value
    return when (condition.operator) {
        "eq" -> equal(v, value)
        // A value of another kind than the property's is a mismatch, false for every operator.
        "neq" -> v !is List<*> && kindOf(v) == kindOf(value) && !equal(v, value)
        "in" -> v is String && value is List<*> && value.any { equal(v, it) }
        "notIn" -> v is String && value is List<*> && value.none { equal(v, it) }
        "gt" -> numberOf(v)?.let { n -> numberOf(value)?.let { n > it } } ?: false
        "gte" -> numberOf(v)?.let { n -> numberOf(value)?.let { n >= it } } ?: false
        "lt" -> numberOf(v)?.let { n -> numberOf(value)?.let { n < it } } ?: false
        "lte" -> numberOf(v)?.let { n -> numberOf(value)?.let { n <= it } } ?: false
        "contains" -> contains(v, value)
        // An operator this version does not know fails closed.
        else -> false
    }
}

// A string contains the rule's text (ignoring case); a list holds an item equal to it (ignoring case).
private fun contains(v: Any, value: Any?): Boolean {
    if (value !is String) return false
    return when (v) {
        is String -> normalizeTargetingTag(v).contains(normalizeTargetingTag(value))
        is List<*> -> v.any { it is String && sameText(it, value) }
        else -> false
    }
}
