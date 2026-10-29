package site.lempert.taleart.sdk.i18n

import kotlin.test.Test
import kotlin.test.assertEquals

// The countdown and promo-code texts keep the Web SDK's keys and English words (libs/web-sdk/src/lib/i18n.ts,
// DEFAULT_STRINGS: countdown.*, promo.*).
class ComponentStringsTest {
    private val webEnglish = mapOf(
        "countdown.ended" to "Ended",
        "countdown.days" to "Days",
        "countdown.hours" to "Hours",
        "countdown.minutes" to "Min",
        "countdown.seconds" to "Sec",
        "promo.copy" to "Copy",
        "promo.copied" to "Copied",
        "promo.copyFailed" to "Could not copy. Select the code and copy it yourself.",
    )

    @Test
    fun theNativeTableHasTheWebKeysAndEnglishWords() {
        for ((key, text) in webEnglish) assertEquals(text, TaleartStrings.DEFAULTS[key], key)
    }

    @Test
    fun aLocaleWithoutATableShowsTheEnglishComponentTexts() {
        val translate = createTranslate("he-IL")
        for ((key, text) in webEnglish) assertEquals(text, translate(key), key)
    }

    @Test
    fun aTranslationOfACountdownUnitOverridesTheEnglish() {
        val translate = createTranslate("he-IL", byLocale = mapOf("he" to mapOf("countdown.days" to "ימים")))
        assertEquals("ימים", translate("countdown.days"))
        assertEquals("Hours", translate("countdown.hours"))
    }
}
