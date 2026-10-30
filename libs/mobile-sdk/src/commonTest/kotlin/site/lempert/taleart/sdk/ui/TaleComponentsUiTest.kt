package site.lempert.taleart.sdk.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.v2.runComposeUiTest
import androidx.compose.ui.unit.dp
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.time.Duration.Companion.seconds
import kotlin.time.Instant

// The countdown and promo-code elements drawn on the native canvas (components, 2026-10-29): the time
// left from an injected clock, the ended text and its one `ended` report, and a promo code's Copy through
// a fake clipboard (its success and its refusal), with the toast for four seconds over the ticket.
@OptIn(ExperimentalTestApi::class)
class TaleComponentsUiTest : ComposeUiTestBase() {
    private val endsAt = Instant.parse("2026-12-31T21:00:00Z")
    private val reports = mutableListOf<String>()
    private val reporter = ComponentReporter { component, action -> reports += "${component.type}:$action:${component.value}" }

    private fun layerOf(vararg elements: String): DocumentLayer = DocumentLayer.read(
        Json.parseToJsonElement("""{"version":1,"canvas":{"background":{"type":"color","color":"#000000"}},"elements":[${elements.joinToString(",")}]}""") as JsonObject,
    )

    private fun countdown(props: String, id: String = "cd") =
        """{"id":"$id","type":"countdown","box":{"x":0.1,"y":0.2,"w":0.8,"h":0.6,"rotation":0},"a11y":{},"props":$props}"""

    private fun promo(code: String, props: String = "", id: String = "promo") =
        """{"id":"$id","type":"promo-code","box":{"x":0.1,"y":0.2,"w":0.8,"h":0.6,"rotation":0},"a11y":{},"props":{"code":"$code"$props}}"""

    @Test
    fun aCountdownShowsTheTimeLeftFromTheVisitorsClock() = runComposeUiTest {
        val layer = layerOf(countdown("""{"endsAt":"2026-12-31T21:00:00Z"}"""))
        // 2 days, 3 hours, 4 minutes and 5 seconds before the end.
        val now = endsAt - (2 * 86_400 + 3 * 3_600 + 4 * 60 + 5).seconds
        setContent {
            CompositionLocalProvider(LocalTaleReducedMotion provides true, LocalTaleClock provides { now }, LocalComponentReporter provides reporter) {
                Box(Modifier.size(180.dp, 320.dp)) { DocumentElementsLayer(layer) }
            }
        }
        waitForIdle()
        // The units speak the minute: days, hours and minutes.
        onNodeWithContentDescription("2 Days 3 Hours 4 Min").fetchSemanticsNode()
        assertTrue(reports.isEmpty(), "no end yet")
    }

    // A card's content sits in the middle of its box (the web's `justify-content: center`), not at its top.
    @Test
    fun aCountdownCentresItsContentInItsBox() = runComposeUiTest {
        val layer = layerOf(countdown("""{"endsAt":"2026-12-31T21:00:00Z","endedText":"Over"}"""))
        setContent {
            CompositionLocalProvider(LocalTaleReducedMotion provides true, LocalTaleClock provides { endsAt + 5.seconds }, LocalComponentReporter provides reporter) {
                Box(Modifier.size(180.dp, 320.dp)) { DocumentElementsLayer(layer) }
            }
        }
        waitForIdle()
        val card = onNodeWithTag(DOCUMENT_ELEMENT_TAG, useUnmergedTree = true).fetchSemanticsNode().boundsInRoot
        val text = onNodeWithText("Over", useUnmergedTree = true).fetchSemanticsNode().boundsInRoot
        assertEquals((card.top + card.bottom) / 2f, (text.top + text.bottom) / 2f, 2f)
    }

    @Test
    fun aPromoTicketSitsInTheMiddleOfItsCard() = runComposeUiTest {
        val layer = layerOf(promo("SAVE20"))
        setContent {
            CompositionLocalProvider(LocalTaleReducedMotion provides true, LocalComponentReporter provides reporter) {
                Box(Modifier.size(180.dp, 320.dp)) { DocumentElementsLayer(layer) }
            }
        }
        waitForIdle()
        val card = onNodeWithTag(DOCUMENT_ELEMENT_TAG, useUnmergedTree = true).fetchSemanticsNode().boundsInRoot
        val copy = onNodeWithText("Copy", useUnmergedTree = true).fetchSemanticsNode().boundsInRoot
        assertEquals((card.top + card.bottom) / 2f, (copy.top + copy.bottom) / 2f, 2f)
    }

    @Test
    fun aCountdownShowsItsEndedTextAndReportsTheEndOnce() = runComposeUiTest {
        val layer = layerOf(countdown("""{"endsAt":"2026-12-31T21:00:00Z","endedText":"Over"}"""))
        setContent {
            CompositionLocalProvider(LocalTaleReducedMotion provides true, LocalTaleClock provides { endsAt + 1.seconds }, LocalComponentReporter provides reporter) {
                Box(Modifier.size(180.dp, 320.dp)) { DocumentElementsLayer(layer) }
            }
        }
        waitUntil("the ended text", 5_000) { onAllNodesWithText("Over").fetchSemanticsNodes().isNotEmpty() }
        waitForIdle()
        assertEquals(listOf("countdown:ended:null"), reports)
    }

    @Test
    fun aCountdownWithoutEndedTextSaysEnded() = runComposeUiTest {
        val layer = layerOf(countdown("""{"endsAt":"2026-12-31T21:00:00Z"}"""))
        setContent {
            CompositionLocalProvider(LocalTaleReducedMotion provides true, LocalTaleClock provides { endsAt }, LocalComponentReporter provides reporter) {
                Box(Modifier.size(180.dp, 320.dp)) { DocumentElementsLayer(layer) }
            }
        }
        waitUntil("the default ended text", 5_000) { onAllNodesWithText("Ended").fetchSemanticsNodes().isNotEmpty() }
        assertEquals(1, reports.size)
    }

    @Test
    fun aCountdownTicksUntilItsEnd() = runComposeUiTest {
        val layer = layerOf(countdown("""{"endsAt":"2026-12-31T21:00:00Z","endedText":"Over"}"""))
        var now = endsAt - 2.seconds
        setContent {
            CompositionLocalProvider(LocalTaleReducedMotion provides true, LocalTaleClock provides { now }, LocalComponentReporter provides reporter) {
                Box(Modifier.size(180.dp, 320.dp)) { DocumentElementsLayer(layer) }
            }
        }
        waitForIdle()
        assertTrue(onAllNodesWithText("Over").fetchSemanticsNodes().isEmpty())
        now = endsAt + 1.seconds
        waitUntil("the ticker reaches the end", 5_000) { onAllNodesWithText("Over").fetchSemanticsNodes().isNotEmpty() }
        assertEquals(listOf("countdown:ended:null"), reports)
    }

    @Test
    fun aPreviewReportsNoComponentEvent() = runComposeUiTest {
        val layer = layerOf(countdown("""{"endsAt":"2026-12-31T21:00:00Z","endedText":"Over"}"""))
        setContent {
            CompositionLocalProvider(LocalTaleReducedMotion provides true, LocalTaleClock provides { endsAt + 1.seconds }, LocalComponentReporter provides reporter) {
                Box(Modifier.size(180.dp, 320.dp)) { DocumentElementsLayer(layer, inertLinks = true) }
            }
        }
        waitUntil("the ended text", 5_000) { onAllNodesWithText("Over").fetchSemanticsNodes().isNotEmpty() }
        assertTrue(reports.isEmpty())
    }

    @Test
    fun aPromoCodeShowsItsCodeAndCopiesItThroughTheClipboard() = runComposeUiTest {
        val copied = mutableListOf<String>()
        val layer = layerOf(promo("SAVE20", ""","title":"Welcome","note":"Once per visitor""""))
        setContent {
            CompositionLocalProvider(
                LocalTaleReducedMotion provides true,
                LocalClipboardCopy provides { text -> copied += text; true },
                LocalComponentReporter provides reporter,
            ) {
                Box(Modifier.size(180.dp, 320.dp)) { DocumentElementsLayer(layer) }
            }
        }
        waitForIdle()
        onNodeWithText("SAVE20").fetchSemanticsNode()
        onNodeWithText("Welcome").fetchSemanticsNode()
        onNodeWithText("Once per visitor").fetchSemanticsNode()
        onNodeWithText("Copy").performClick()
        waitUntil("the status line", 5_000) { onAllNodesWithText("Copied").fetchSemanticsNodes().isNotEmpty() }
        assertEquals(listOf("SAVE20"), copied)
        assertEquals(listOf("promo-code:copied:SAVE20"), reports)
    }

    @Test
    fun aRefusedClipboardSaysSoAndReportsNothing() = runComposeUiTest {
        val layer = layerOf(promo("SAVE20"))
        setContent {
            CompositionLocalProvider(LocalTaleReducedMotion provides true, LocalClipboardCopy provides { false }, LocalComponentReporter provides reporter) {
                Box(Modifier.size(180.dp, 320.dp)) { DocumentElementsLayer(layer) }
            }
        }
        waitForIdle()
        onNodeWithText("Copy").performClick()
        waitUntil("the refusal", 5_000) { onAllNodesWithText("Could not copy. Select the code and copy it yourself.").fetchSemanticsNodes().isNotEmpty() }
        assertTrue(reports.isEmpty(), "a copy that failed reports no event")
    }

    @Test
    fun theToastStaysFourSecondsThenClearsAndTheButtonStays() = runComposeUiTest {
        assertEquals(4_000L, PROMO_TOAST_MS)
        val layer = layerOf(promo("SAVE20"))
        setContent {
            CompositionLocalProvider(LocalTaleReducedMotion provides true, LocalClipboardCopy provides { true }, LocalComponentReporter provides reporter) {
                Box(Modifier.size(180.dp, 320.dp)) { DocumentElementsLayer(layer) }
            }
        }
        waitForIdle()
        mainClock.autoAdvance = false
        onNodeWithText("Copy").performClick()
        mainClock.advanceTimeBy(100)
        assertTrue(onAllNodesWithText("Copied").fetchSemanticsNodes().isNotEmpty(), "the toast shows")
        mainClock.advanceTimeBy(3_700)
        assertTrue(onAllNodesWithText("Copied").fetchSemanticsNodes().isNotEmpty(), "still shown at 3.8 s")
        mainClock.advanceTimeBy(400)
        assertTrue(onAllNodesWithText("Copied").fetchSemanticsNodes().isEmpty(), "gone after 4 s")
        assertTrue(onAllNodesWithText("Copy").fetchSemanticsNodes().isNotEmpty(), "the button stays")
    }

    @Test
    fun theToastOverlaysTheCardAndDoesNotMoveTheTicket() = runComposeUiTest {
        val layer = layerOf(promo("SAVE20", ""","title":"Welcome""""))
        setContent {
            CompositionLocalProvider(LocalTaleReducedMotion provides true, LocalClipboardCopy provides { true }, LocalComponentReporter provides reporter) {
                Box(Modifier.size(180.dp, 320.dp)) { DocumentElementsLayer(layer) }
            }
        }
        waitForIdle()
        val before = onNodeWithText("SAVE20").fetchSemanticsNode().boundsInRoot
        val stubBefore = onNodeWithText("Copy").fetchSemanticsNode().boundsInRoot
        onNodeWithText("Copy").performClick()
        waitUntil("the toast", 5_000) { onAllNodesWithText("Copied").fetchSemanticsNodes().isNotEmpty() }
        assertEquals(before, onNodeWithText("SAVE20").fetchSemanticsNode().boundsInRoot, "the code did not move")
        // The toast sits by the card's top inline end, over the title's row: above the ticket.
        val toast = onNodeWithText("Copied").fetchSemanticsNode().boundsInRoot
        assertTrue(toast.top < before.top, "the toast is over the card's top, not in the flow")
        assertTrue(toast.left > before.left, "left to right: the toast is at the right of the code")
        // The stub is one row with the code, at the inline end.
        assertTrue(stubBefore.left > before.left, "left to right: the stub follows the code")
        assertEquals(before.center.y, stubBefore.center.y, 2f, "one row")
    }

    @Test
    fun theStubIsAtTheStartSideInRightToLeft() = runComposeUiTest {
        val layer = layerOf(promo("SAVE20"))
        setContent {
            CompositionLocalProvider(
                androidx.compose.ui.platform.LocalLayoutDirection provides androidx.compose.ui.unit.LayoutDirection.Rtl,
                LocalHostLayoutDirection provides androidx.compose.ui.unit.LayoutDirection.Rtl,
                LocalTaleReducedMotion provides true,
            ) {
                Box(Modifier.size(180.dp, 320.dp)) { DocumentElementsLayer(layer) }
            }
        }
        waitForIdle()
        val code = onNodeWithText("SAVE20").fetchSemanticsNode().boundsInRoot
        val stub = onNodeWithText("Copy").fetchSemanticsNode().boundsInRoot
        assertTrue(stub.right < code.right && stub.left < code.left, "right to left: the Copy stub is at the left (the inline end)")
    }
}
