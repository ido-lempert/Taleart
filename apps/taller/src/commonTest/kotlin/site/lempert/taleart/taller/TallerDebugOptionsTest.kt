package site.lempert.taleart.taller

import site.lempert.taleart.sdk.FallbackMode
import site.lempert.taleart.sdk.FrequencyRule
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

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
    fun frequencyNamesMapToRules() {
        assertEquals(FrequencyRule.Daily, frequencyRule("daily"))
        assertEquals(FrequencyRule.Weekly, frequencyRule(" Weekly "))
        assertEquals(FrequencyRule.Count(50), frequencyRule("50"))
        assertNull(frequencyRule("none"))
        assertNull(frequencyRule("51"))
        assertNull(frequencyRule("sometimes"))
    }
}
