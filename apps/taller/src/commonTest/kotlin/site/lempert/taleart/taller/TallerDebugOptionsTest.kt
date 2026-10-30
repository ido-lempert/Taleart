package site.lempert.taleart.taller

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import site.lempert.taleart.sdk.FallbackMode
import site.lempert.taleart.sdk.FrequencyRule
import site.lempert.taleart.sdk.delivery.DeliveryFrame
import site.lempert.taleart.sdk.delivery.DeliveryZone
import site.lempert.taleart.sdk.ui.BarLayout
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertSame

class TallerDebugOptionsTest {
    @Test
    fun readsTheDebugKeysFromTheStore() {
        val store = InMemoryStore(
            mapOf(
                TallerDebugOptions.AUTO_OPEN_GROUP to "2",
                TallerDebugOptions.AUTO_OPEN_TALE to "1",
                TallerDebugOptions.FALLBACK to "message",
                TallerDebugOptions.FREQUENCY to "once",
            ),
        )
        assertEquals(
            TallerDebugOptions(autoOpenGroup = 2, autoOpenTale = 1, fallback = FallbackMode.Message, frequency = FrequencyRule.Once),
            TallerDebugOptions.load(store),
        )
    }

    @Test
    fun keepsTheSdkDefaultsWhenNothingIsSet() {
        assertEquals(TallerDebugOptions(), TallerDebugOptions.load(InMemoryStore()))
    }

    @Test
    fun launchExtrasWinOverTheStore() {
        val store = InMemoryStore(mapOf(TallerDebugOptions.FREQUENCY to "once"))
        val debug = TallerDebugOptions.load(store, mapOf(TallerDebugOptions.FREQUENCY to "3", TallerDebugOptions.AUTO_OPEN_GROUP to "0"))
        assertEquals(FrequencyRule.Count(3), debug.frequency)
        assertEquals(0, debug.autoOpenGroup)
    }

    @Test
    fun readsTheLocaleAndTheLayoutDirection() {
        val store = InMemoryStore(mapOf(TallerDebugOptions.LOCALE to "he-IL", TallerDebugOptions.LAYOUT_DIRECTION to "RTL"))
        val debug = TallerDebugOptions.load(store)
        assertEquals("he-IL", debug.locale)
        assertEquals("rtl", debug.layoutDirection)
        assertEquals(TallerDebugOptions(), TallerDebugOptions.load(InMemoryStore()))
    }

    @Test
    fun frequencyNamesMapToRules() {
        assertEquals(FrequencyRule.Daily, frequencyRule("daily"))
        assertEquals(FrequencyRule.Weekly, frequencyRule(" Weekly "))
        assertEquals(FrequencyRule.Count(50), frequencyRule("50"))
        assertNull(frequencyRule("none"))
        assertNull(frequencyRule("51"))
        assertNull(frequencyRule("sometimes"))
    }

    @Test
    fun readsTheBarLayoutAndIgnoresAnUnknownOne() {
        assertEquals(BarLayout.Chip, TallerDebugOptions.load(InMemoryStore(mapOf(TallerDebugOptions.BAR_LAYOUT to " Chip "))).barLayout)
        assertEquals(BarLayout.Stack, TallerDebugOptions.load(InMemoryStore(), mapOf(TallerDebugOptions.BAR_LAYOUT to "stack")).barLayout)
        assertNull(TallerDebugOptions.load(InMemoryStore(mapOf(TallerDebugOptions.BAR_LAYOUT to "tile"))).barLayout)
        assertNull(TallerDebugOptions.load(InMemoryStore()).barLayout)
    }

    @Test
    fun aZoneCanBeDrawnInAnotherBarLayout() {
        val bar = DeliveryZone(
            id = "z",
            frame = DeliveryFrame(id = "f", type = "bar", settings = JsonObject(mapOf("layout" to JsonPrimitive("ring"), "gap" to JsonPrimitive(8)))),
        )
        val poster = bar.withBarLayout(BarLayout.Poster)
        assertEquals(
            JsonObject(mapOf("layout" to JsonPrimitive("poster"), "gap" to JsonPrimitive(8))),
            poster.frame?.settings,
        )
        assertEquals(bar.taleGroups, poster.taleGroups)
    }

    @Test
    fun aZoneWithoutABarIsDrawnAsItIs() {
        val none = DeliveryZone(id = "z")
        assertSame(none, none.withBarLayout(BarLayout.Chip))
        val banner = DeliveryZone(id = "z", frame = DeliveryFrame(id = "f", type = "banner", settings = null))
        assertSame(banner, banner.withBarLayout(BarLayout.Chip))
    }

    @Test
    fun theHebrewBarTextsHaveEveryBarKey() {
        assertEquals(
            setOf("bar.loading", "bar.story", "bar.stories", "bar.newStory", "bar.newStories"),
            TallerStrings.bar.getValue("he").keys,
        )
    }
}
