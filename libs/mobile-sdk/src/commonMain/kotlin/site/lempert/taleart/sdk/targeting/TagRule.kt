package site.lempert.taleart.sdk.targeting

/**
 * The tag rule (epic targeting R2): which tale groups a viewer sees, from the tags the app passed in
 * `TaleartConfig.tags`. The Web SDK applies the same rule (`tagRulePasses` in
 * libs/contract/src/lib/targeting.ts) to the zone it reads; the server never sees the tags. The
 * shared test table is libs/contract/targeting/tag-rule.cases.json, copied into TagRuleTest.
 */

/** Unicode NFC normalization of [value] (a composed and a decomposed letter are one). */
internal expect fun normalizeNfc(value: String): String

/** A tag as the rule compares it: NFC, trimmed and in lower case (locale-independent). */
internal fun normalizeTargetingTag(tag: String): String = normalizeNfc(tag).trim().lowercase()

/** The viewer's tags as the rule compares them: blank values left out, each once. Null when the app set none. */
internal fun viewerTagSet(tags: List<String>?): Set<String>? {
    if (tags == null) return null
    return tags.map(::normalizeTargetingTag).filter { it.isNotEmpty() }.toSet()
}

/**
 * True when a group with [groupTags] and [tagMatch] shows to a viewer with [viewerTags]: no group
 * tags passes; no viewer tags (null or none left) passes; `all` needs every group tag, any other
 * match mode (the default `any`) one of them.
 */
internal fun tagRulePasses(groupTags: List<String>, tagMatch: String?, viewerTags: Set<String>?): Boolean {
    val tags = groupTags.map(::normalizeTargetingTag).filter { it.isNotEmpty() }
    if (tags.isEmpty()) return true
    if (viewerTags.isNullOrEmpty()) return true
    return if (tagMatch == "all") tags.all { it in viewerTags } else tags.any { it in viewerTags }
}
