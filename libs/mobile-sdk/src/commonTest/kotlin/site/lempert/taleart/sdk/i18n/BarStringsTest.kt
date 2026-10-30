package site.lempert.taleart.sdk.i18n

import kotlin.test.Test
import kotlin.test.assertEquals

// The bar layouts' texts: English in the SDK's table, Hebrew through the per-locale overrides a host passes
// (TaleartConfig.strings), the same mechanism as every other text.
class BarStringsTest {
    private val hebrew = mapOf(
        "he" to mapOf(
            "bar.loading" to "טוענים סיפורים",
            "bar.story" to "{count} סיפור",
            "bar.stories" to "{count} סיפורים",
            "bar.newStory" to "{count} סיפור חדש",
            "bar.newStories" to "{count} סיפורים חדשים",
        ),
    )

    @Test
    fun theEnglishBarTextsAreInTheTable() {
        val translate = createTranslate("en")
        assertEquals("Loading stories", translate("bar.loading"))
        assertEquals("1 story", translate("bar.story", mapOf("count" to 1)))
        assertEquals("3 stories", translate("bar.stories", mapOf("count" to 3)))
        assertEquals("1 new story", translate("bar.newStory", mapOf("count" to 1)))
        assertEquals("2 new stories", translate("bar.newStories", mapOf("count" to 2)))
    }

    @Test
    fun theHebrewTextsReplaceTheEnglishOnes() {
        val translate = createTranslate("he-IL", hebrew)
        assertEquals("טוענים סיפורים", translate("bar.loading"))
        assertEquals("3 סיפורים", translate("bar.stories", mapOf("count" to 3)))
        assertEquals("2 סיפורים חדשים", translate("bar.newStories", mapOf("count" to 2)))
    }

    @Test
    fun aLocaleWithoutTheHebrewTableShowsEnglish() {
        assertEquals("2 new stories", createTranslate("fr-FR", hebrew)("bar.newStories", mapOf("count" to 2)))
    }
}
