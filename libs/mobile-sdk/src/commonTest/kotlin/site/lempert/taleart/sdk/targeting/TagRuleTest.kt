package site.lempert.taleart.sdk.targeting

import kotlin.test.Test
import kotlin.test.assertEquals

// The tag rule's shared table (libs/contract/targeting/tag-rule.cases.json), run here as the Web SDK
// and the dashboard run it: a case holds when the rule's answer equals `passes`.
class TagRuleTest {
    private data class Case(val name: String, val groupTags: List<String>, val tagMatch: String, val viewerTags: List<String>?, val passes: Boolean)

    private val cases = listOf(
        Case("no group tags, no setTags call", listOf(), "any", null, true),
        Case("no group tags, viewer tags", listOf(), "any", listOf("summer"), true),
        Case("no group tags with All, viewer tags", listOf(), "all", listOf("summer"), true),
        Case("Any, no setTags call", listOf("summer"), "any", null, true),
        Case("All, no setTags call", listOf("summer", "vip"), "all", null, true),
        Case("Any, empty viewer tags", listOf("summer"), "any", listOf(), true),
        Case("All, only blank viewer tags", listOf("summer", "vip"), "all", listOf("", "  "), true),
        Case("Any, one of two matching", listOf("summer", "vip"), "any", listOf("vip"), true),
        Case("Any, none matching", listOf("summer", "vip"), "any", listOf("winter"), false),
        Case("Any, all matching", listOf("summer", "vip"), "any", listOf("vip", "summer"), true),
        Case("All, one missing", listOf("summer", "vip"), "all", listOf("summer"), false),
        Case("All, all present", listOf("summer", "vip"), "all", listOf("vip", "summer"), true),
        Case("All, all present among others", listOf("summer", "vip"), "all", listOf("winter", "vip", "summer"), true),
        Case("All, one group tag present", listOf("vip"), "all", listOf("vip"), true),
        Case("Any, case differs", listOf("Summer"), "any", listOf("SUMMER"), true),
        Case("Any, surrounding spaces", listOf("summer"), "any", listOf("  summer "), true),
        Case("All, case and spaces differ", listOf("summer", "VIP"), "all", listOf("SUMMER ", " vip"), true),
        Case("Any, inner spaces still count", listOf("summer sale"), "any", listOf("summersale"), false),
        Case("Any, repeated viewer tags none matching", listOf("summer"), "any", listOf("winter", "winter"), false),
        Case("unknown match mode reads as Any", listOf("summer", "vip"), "some", listOf("vip"), true),
        Case("non-ASCII: accented letters match ignoring case", listOf("Été"), "any", listOf("été"), true),
        Case("non-ASCII: accents are not folded away", listOf("café"), "any", listOf("cafe"), false),
        Case("non-ASCII: NFD viewer tag matches an NFC group tag", listOf("café"), "any", listOf("café"), true),
        Case("non-ASCII: NFC viewer tag matches an NFD group tag under All", listOf("café", "vip"), "all", listOf("CAFÉ", "vip"), true),
        Case("non-ASCII: Turkish dotted capital I is not plain i", listOf("İstanbul"), "any", listOf("istanbul"), false),
        Case("non-ASCII: Turkish dotted capital I matches itself in any case", listOf("İstanbul"), "any", listOf("İSTANBUL"), true),
        Case("non-ASCII: plain capital I lowers to plain i", listOf("ISTANBUL"), "any", listOf("istanbul"), true),
    )

    @Test
    fun everySharedCaseHolds() {
        for (c in cases) {
            val viewer = viewerTagSet(c.viewerTags)
            assertEquals(c.passes, tagRulePasses(c.groupTags, c.tagMatch, viewer), c.name)
        }
    }

    @Test
    fun aGroupWithoutTagsAlwaysShows() {
        assertEquals(true, tagRulePasses(emptyList(), "all", setOf("vip")))
    }
}
