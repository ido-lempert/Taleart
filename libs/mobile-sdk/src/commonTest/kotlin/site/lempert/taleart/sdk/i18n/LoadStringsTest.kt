package site.lempert.taleart.sdk.i18n

import kotlin.test.Test
import kotlin.test.assertEquals

// The load-failure texts keep the Web SDK's keys and English words (libs/web-sdk/src/lib/i18n.ts).
class LoadStringsTest {
    @Test
    fun theLoadFailureKeysAreTheWebSdksWithItsEnglishText() {
        assertEquals("Stories could not be loaded.", TaleartStrings.DEFAULTS["load.failed"])
        assertEquals("Try again", TaleartStrings.DEFAULTS["load.retry"])
    }

    @Test
    fun aLocaleWithoutATableShowsTheEnglishLoadFailureTexts() {
        val hebrew = createTranslate("he-IL")
        assertEquals("Stories could not be loaded.", hebrew("load.failed"))
        assertEquals("Try again", hebrew("load.retry"))
    }

    @Test
    fun aTranslationOfTheLoadFailureKeysOverridesTheEnglish() {
        val translate = createTranslate("he-IL", byLocale = mapOf("he" to mapOf("load.retry" to "נסו שוב")))
        assertEquals("נסו שוב", translate("load.retry"))
        assertEquals("Stories could not be loaded.", translate("load.failed"))
    }
}
