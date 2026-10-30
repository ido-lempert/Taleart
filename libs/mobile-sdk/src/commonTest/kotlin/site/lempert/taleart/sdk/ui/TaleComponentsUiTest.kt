package site.lempert.taleart.sdk.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
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
// a fake clipboard (its success and its refusal), with the status line for two seconds.
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
    fun theStatusLineClearsAfterTwoSeconds() = runComposeUiTest {
        val layer = layerOf(promo("SAVE20"))
        setContent {
            CompositionLocalProvider(LocalTaleReducedMotion provides true, LocalClipboardCopy provides { true }, LocalComponentReporter provides reporter) {
                Box(Modifier.size(180.dp, 320.dp)) { DocumentElementsLayer(layer) }
            }
        }
        waitForIdle()
        onNodeWithText("Copy").performClick()
        waitUntil("the status line", 5_000) { onAllNodesWithText("Copied").fetchSemanticsNodes().isNotEmpty() }
        waitUntil("the status line clears", 5_000) { onAllNodesWithText("Copied").fetchSemanticsNodes().isEmpty() }
        assertTrue(onAllNodesWithText("Copy").fetchSemanticsNodes().isNotEmpty(), "the button stays")
    }
}
