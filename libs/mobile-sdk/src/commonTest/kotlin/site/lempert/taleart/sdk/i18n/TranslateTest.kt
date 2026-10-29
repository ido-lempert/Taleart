package site.lempert.taleart.sdk.i18n

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

// The lookup of createTranslate, as the Web SDK's createTranslate (libs/web-sdk/src/lib/i18n.ts).
class TranslateTest {
    private val he = mapOf("he" to mapOf("viewer.close" to "סגור"))

    @Test
    fun aKeyNobodyOverridesShowsTheEnglishText() {
        assertEquals("Close", createTranslate("he-IL").invoke("viewer.close"))
        assertEquals("Next tale", defaultTranslate("viewer.nextTale"))
    }

    @Test
    fun looksUpTheFullLocaleThenItsLanguageThenEveryLocaleThenEnglish() {
        val full = mapOf("he-IL" to mapOf("viewer.close" to "full"))
        assertEquals("full", createTranslate("he-IL", full + he).invoke("viewer.close"))
        assertEquals("סגור", createTranslate("he-IL", he).invoke("viewer.close"))
        assertEquals("flat", createTranslate("he-IL", he, mapOf("viewer.play" to "flat")).invoke("viewer.play"))
        assertEquals("סגור", createTranslate("he-IL", he, mapOf("viewer.close" to "flat")).invoke("viewer.close"))
        // The language's text is not used for another locale of the same language.
        assertEquals("Close", createTranslate("en-US", he).invoke("viewer.close"))
    }

    @Test
    fun aBlankOrUnderscoredLocaleStillFindsItsLanguage() {
        assertEquals("סגור", createTranslate("he_IL", he).invoke("viewer.close"))
    }

    @Test
    fun fillsTheValuesOfTheText() {
        val t = createTranslate("en")
        assertEquals("Summer, tale 2 of 3", t("viewer.progress", mapOf("group" to "Summer", "tale" to 2, "count" to 3)))
        assertEquals("Show Winter", t("banner.showGroup", mapOf("name" to "Winter")))
        // A value that was not given stays as written, never blank.
        assertEquals("Show {name}", t("banner.showGroup"))
    }

    @Test
    fun everyKeyTheSdkLooksUpHasAnEnglishText() {
        for (key in listOf("viewer.close", "viewer.play", "viewer.pause", "viewer.previousTale", "viewer.nextTale",
            "viewer.progress", "viewer.taleFallback", "banner.label", "banner.slideOf", "banner.previousSlide",
            "banner.nextSlide", "banner.showGroup", "banner.stopRotation", "banner.startRotation", "bar.seen", "links.open")) {
            assertTrue(key in TaleartStrings.DEFAULTS, key)
        }
    }

    @Test
    fun mergeStringsLetsTheViewWinLocaleByLocale() {
        val base = mapOf("he" to mapOf("viewer.close" to "sdk", "viewer.play" to "sdk-play"))
        val own = mapOf("he" to mapOf("viewer.close" to "view"))
        val merged = mergeStrings(base, own)
        assertEquals("view", merged["he"]?.get("viewer.close"))
        assertEquals("sdk-play", merged["he"]?.get("viewer.play"))
    }
}
