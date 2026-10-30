package site.lempert.taleart.sdk.ui

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import site.lempert.taleart.sdk.ComponentRef
import site.lempert.taleart.sdk.TaleartEvent
import site.lempert.taleart.sdk.TaleartListener
import site.lempert.taleart.sdk.deliver
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.time.Duration.Companion.milliseconds
import kotlin.time.Duration.Companion.seconds
import kotlin.time.Instant

// Reading the countdown and promo-code elements (components, 2026-10-29) with the contract's limits, and
// the countdown's time left as the Web SDK computes it (libs/web-sdk/src/lib/document/countdown.ts).
class TaleComponentsTest {
    private fun layerOf(vararg elements: String): DocumentLayer = DocumentLayer.read(
        Json.parseToJsonElement("""{"version":1,"canvas":{"background":{"type":"color","color":"#000000"}},"elements":[${elements.joinToString(",")}]}""") as JsonObject,
    )

    private fun element(type: String, props: String, id: String = type) =
        """{"id":"$id","type":"$type","box":{"x":0.1,"y":0.2,"w":0.8,"h":0.2,"rotation":0},"a11y":{},"props":$props}"""

    // A props object of the given JSON members; a text member is `text("key", "value")`, a number is written as is.
    private fun props(vararg members: String) = "{" + members.joinToString(",") + "}"

    private fun text(key: String, value: String) = "\"$key\":\"$value\""

    private val endsAt = text("endsAt", "2026-12-31T21:00:00Z")
    private val code = text("code", "SAVE20")

    private fun countdowns(layer: DocumentLayer) = layer.elements.filterIsInstance<DocumentElement.Countdown>()

    private fun promos(layer: DocumentLayer) = layer.elements.filterIsInstance<DocumentElement.PromoCode>()

    @Test
    fun aCountdownReadsItsValidProps() {
        val layer = layerOf(element("countdown", props(endsAt, text("title", "Sale ends"), text("endedText", "Over"), text("theme", "dark"))))
        val c = assertIs<DocumentElement.Countdown>(layer.elements.single())
        assertEquals("Sale ends", c.title)
        assertEquals(Instant.parse("2026-12-31T21:00:00Z"), c.endsAt)
        assertEquals("Over", c.endedText)
        assertEquals(true, c.dark)
        assertFalse(c.decorative)
        assertEquals(emptyList(), layer.skipped)
    }

    @Test
    fun aCountdownTakesItsDefaultsWhenPropsAreLeftOut() {
        val c = countdowns(layerOf(element("countdown", props(endsAt)))).single()
        assertNull(c.title)
        assertNull(c.endedText, "the SDK's ended string is used at render time")
        assertEquals(null, c.dark, "follows the colour scheme when left out")
    }

    @Test
    fun aCountdownKeepsFractionalSecondsOfEndsAt() {
        val c = countdowns(layerOf(element("countdown", props(text("endsAt", "2026-12-31T21:00:00.123456789Z"))))).single()
        assertEquals(Instant.parse("2026-12-31T21:00:00.123456789Z"), c.endsAt)
    }

    @Test
    fun aCountdownWithABadEndsAtIsSkipped() {
        val badInstants = listOf(
            "2026-12-31T21:00:00",        // no Z: not UTC
            "2026-12-31T21:00:00+02:00",  // an offset, not Z
            "2026-02-30T21:00:00Z",       // not a real date
            "2026-13-01T00:00:00Z",       // month 13
            "2026-12-31T25:00:00Z",       // hour 25
            "2026-12-31 21:00:00Z",       // a space, not T
            "tomorrow",
        )
        for (bad in badInstants) {
            val layer = layerOf(element("countdown", props(text("endsAt", "$bad"))))
            assertTrue(layer.elements.isEmpty(), "skipped: $bad")
        }
        assertTrue(layerOf(element("countdown", props(text("title", "no end")))).elements.isEmpty(), "a countdown without endsAt is skipped")
    }

    @Test
    fun aCountdownWithAnInvalidTitleEndedTextOrThemeIsSkipped() {
        fun withTitle(value: String) = element("countdown", props(endsAt, text("title", "$value")))
        fun withEnded(value: String) = element("countdown", props(endsAt, text("endedText", "$value")))
        assertEquals(1, countdowns(layerOf(withTitle("a".repeat(80)))).size, "80 characters is the most")
        assertTrue(layerOf(withTitle("a".repeat(81))).elements.isEmpty(), "81 characters is too many")
        assertTrue(layerOf(withTitle("")).elements.isEmpty(), "a title needs one character")
        assertTrue(layerOf(withTitle("Sale\\u0007")).elements.isEmpty(), "no control characters")
        assertTrue(layerOf(withTitle("a\\u202eb")).elements.isEmpty(), "no bidi override")
        assertTrue(layerOf(withEnded("a".repeat(81))).elements.isEmpty(), "endedText has the same limit")
        assertTrue(layerOf(element("countdown", props(endsAt, text("theme", "blue")))).elements.isEmpty(), "theme is light or dark")
        assertTrue(layerOf(element("countdown", props(endsAt, "\"title\":42"))).elements.isEmpty(), "a title is text")
    }

    @Test
    fun aTaleMayHoldSeveralCountdowns() {
        val layer = layerOf(
            element("countdown", props(endsAt), id = "a"),
            element("countdown", props(endsAt), id = "b"),
        )
        assertEquals(listOf("a", "b"), countdowns(layer).map { it.id })
    }

    @Test
    fun aPromoCodeReadsItsValidProps() {
        val layer = layerOf(element("promo-code", props(text("code", "SAVE-20_x"), text("title", "Welcome"), text("note", "Once per visitor"), text("theme", "dark"))))
        val p = assertIs<DocumentElement.PromoCode>(layer.elements.single())
        assertEquals("SAVE-20_x", p.code)
        assertEquals("Welcome", p.title)
        assertEquals("Once per visitor", p.note)
        assertEquals(true, p.dark)
        assertEquals(emptyList(), layer.skipped)
    }

    @Test
    fun aPromoCodeAcceptsThirtyTwoCharactersAndRejectsMore() {
        val full = "A".repeat(32)
        assertEquals(full, promos(layerOf(element("promo-code", props(text("code", "$full"))))).single().code)
        assertTrue(layerOf(element("promo-code", props(text("code", "A".repeat(33))))).elements.isEmpty())
    }

    @Test
    fun aPromoCodeWithBadCharactersIsSkipped() {
        // Each code as it is written in the JSON (a backslash escape is a character the JSON carries).
        val bad = listOf("", "SAVE 20", "SAVE.20", "\\u00c4BC", "A\\u0000", "A/B", "A+B")
        for (code in bad) {
            val layer = layerOf(element("promo-code", props(text("code", "$code"))))
            assertTrue(layer.elements.isEmpty(), "skipped: $code")
        }
        assertTrue(layerOf(element("promo-code", props(text("note", "no code")))).elements.isEmpty(), "a promo code without a code is skipped")
    }

    @Test
    fun aPromoCodeWithAnInvalidNoteOrThemeIsSkipped() {
        assertEquals(1, promos(layerOf(element("promo-code", props(code, text("note", "n".repeat(120)))))).size)
        assertTrue(layerOf(element("promo-code", props(code, text("note", "n".repeat(121))))).elements.isEmpty())
        assertTrue(layerOf(element("promo-code", props(code, text("theme", "neon")))).elements.isEmpty())
    }

    @Test
    fun theNativeSdkDrawsTheComponentTypesAndStillSkipsUnknownOnesByName() {
        assertTrue("countdown" in DOCUMENT_ELEMENT_TYPES)
        assertTrue("promo-code" in DOCUMENT_ELEMENT_TYPES)
        assertTrue("poll" in DOCUMENT_ELEMENT_TYPES)
        assertTrue("quiz" in DOCUMENT_ELEMENT_TYPES)
        assertTrue("rating" in DOCUMENT_ELEMENT_TYPES)
        assertTrue("reaction" in DOCUMENT_ELEMENT_TYPES)
        // A type this SDK does not know is skipped, and named.
        val layer = layerOf(element("spinner", """{"question":"?"}""", id = "p"))
        assertTrue(layer.elements.isEmpty())
        assertEquals(listOf("spinner"), layer.skipped)
    }

    @Test
    fun theTimeLeftRoundsUpToTheSecondAndEndsAtTheInstant() {
        val end = Instant.parse("2026-12-31T21:00:00Z")
        assertEquals(CountdownLeft(0, 0, 0, 1), countdownLeft(end, end - 1.milliseconds), "a millisecond left shows one second")
        assertEquals(CountdownLeft(0, 0, 0, 1), countdownLeft(end, end - 1.seconds))
        assertEquals(CountdownLeft(0, 0, 0, 2), countdownLeft(end, end - 1500.milliseconds), "1.5 seconds rounds up to 2")
        assertNull(countdownLeft(end, end), "at the end, ended")
        assertNull(countdownLeft(end, end + 1.seconds), "after the end, ended")
    }

    @Test
    fun theTimeLeftSplitsIntoDaysHoursMinutesAndSeconds() {
        val end = Instant.parse("2026-12-31T21:00:00Z")
        // 1 day, 1 hour, 1 minute and 1 second.
        assertEquals(CountdownLeft(1, 1, 1, 1), countdownLeft(end, end - 90_061.seconds))
        // 12 days, 23 hours, 59 minutes and 59 seconds: 1,123,199 seconds.
        assertEquals(CountdownLeft(12, 23, 59, 59), countdownLeft(end, end - 1_123_199.seconds))
    }

    @Test
    fun aCountdownNumberHasTwoDigitsAtLeast() {
        assertEquals("00", countdownNumber(0))
        assertEquals("07", countdownNumber(7))
        assertEquals("59", countdownNumber(59))
        assertEquals("100", countdownNumber(100))
    }

    @Test
    fun aHostListenerHearsAComponentEventAndTheGenericOne() {
        val heard = mutableListOf<String>()
        val listener = object : TaleartListener {
            override fun onComponentEvent(event: TaleartEvent) {
                heard += "component:${event.component?.type}:${event.action}:${event.component?.value}"
            }

            override fun onEvent(event: TaleartEvent) {
                heard += "event:${event.name}"
            }
        }
        val event = TaleartEvent(
            name = "componentEvent",
            zoneKeyPrefix = "tak_9f3c",
            component = ComponentRef("promo-1", "promo-code", value = "SAVE20"),
            action = "copied",
        )
        deliver(listener, event) { it.onComponentEvent(event) }
        assertEquals(listOf("component:promo-code:copied:SAVE20", "event:componentEvent"), heard)
    }

    @Test
    fun theUnitsOfASmallCountdownAreWhatIsLeft() {
        val start = Instant.parse("2026-01-01T00:00:00Z")
        assertNull(countdownLeft(start, start))
        assertEquals(CountdownLeft(0, 0, 0, 1), countdownLeft(start + 1.seconds, start))
        assertEquals(CountdownLeft(0, 0, 5, 0), countdownLeft(start + 300.seconds, start))
    }
}
