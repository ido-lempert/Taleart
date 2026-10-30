package site.lempert.taleart.sdk.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.v2.runComposeUiTest
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import site.lempert.taleart.sdk.TaleartConfig
import site.lempert.taleart.sdk.TaleartSdk
import site.lempert.taleart.sdk.delivery.DeliveryClient
import site.lempert.taleart.sdk.delivery.DeliveryZone
import site.lempert.taleart.sdk.delivery.readZone
import site.lempert.taleart.sdk.storage.InMemoryKeyValueStore
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.time.Instant
import kotlin.time.Duration.Companion.seconds

// The layout direction of the native views: the configured value, the tap zones and swipes of the viewer,
// the progress fill, the rating slider and its keys (pure, so they are checked without pixels), and the bar's
// order and the countdown's digits in a composition laid out right to left.
@OptIn(ExperimentalTestApi::class)
class TaleartDirectionTest : ComposeUiTestBase() {
    @Test
    fun aConfiguredDirectionIsLtrOrRtlAndAnythingElseIsThePlatformsOwn() {
        assertEquals(LayoutDirection.Ltr, layoutDirectionOf("ltr"))
        assertEquals(LayoutDirection.Rtl, layoutDirectionOf(" RTL "))
        assertNull(layoutDirectionOf(null))
        assertNull(layoutDirectionOf(""))
        assertNull(layoutDirectionOf("auto"))
    }

    @Test
    fun aTapInTheStartThirdIsThePreviousZoneInEachDirection() {
        // A stage 300 px wide: the start third is x < 100 left to right, and x > 200 right to left.
        assertTrue(tapIsBack(10f, 300f, rtl = false))
        assertFalse(tapIsBack(290f, 300f, rtl = false))
        assertTrue(tapIsBack(290f, 300f, rtl = true))
        assertFalse(tapIsBack(10f, 300f, rtl = true))
        assertFalse(tapIsBack(150f, 300f, rtl = false))
        assertFalse(tapIsBack(150f, 300f, rtl = true))
    }

    @Test
    fun aSwipeTowardTheStartOfTheLineShowsTheNextGroup() {
        assertTrue(swipeShowsNext(-80f, rtl = false))
        assertFalse(swipeShowsNext(80f, rtl = false))
        assertTrue(swipeShowsNext(80f, rtl = true))
        assertFalse(swipeShowsNext(-80f, rtl = true))
    }

    @Test
    fun aProgressFillStartsAtTheStartOfTheSegment() {
        assertEquals(0f, segmentFillLeft(120f, 300f, rtl = false))
        assertEquals(180f, segmentFillLeft(120f, 300f, rtl = true))
        assertEquals(300f, segmentFillLeft(0f, 300f, rtl = true))
    }

    @Test
    fun aRatingRunsFromTheStartEdgeToTheEndEdge() {
        // A track 200 px wide: 0 at the start edge, 100 at the end edge, mirrored in right to left.
        assertEquals(0, ratingAt(0f, 200f))
        assertEquals(100, ratingAt(200f, 200f))
        assertEquals(0, ratingAt(200f, 200f, rtl = true))
        assertEquals(100, ratingAt(0f, 200f, rtl = true))
        assertEquals(75, ratingAt(50f, 200f, rtl = true))
        assertEquals(50f, ratingLeft(25f, 200f, rtl = false))
        assertEquals(150f, ratingLeft(25f, 200f, rtl = true))
        assertEquals(200f, ratingLeft(0f, 200f, rtl = true))
    }

    @Test
    fun theRatingArrowTowardTheEndRaisesItInEachDirection() {
        assertEquals(60, ratingKey(50, Key.DirectionRight, rtl = false))
        assertEquals(40, ratingKey(50, Key.DirectionRight, rtl = true))
        assertEquals(60, ratingKey(50, Key.DirectionLeft, rtl = true))
        assertEquals(40, ratingKey(50, Key.DirectionLeft, rtl = false))
        assertEquals(0, ratingKey(50, Key.MoveHome, rtl = true))
        assertNull(ratingKey(50, Key.A, rtl = true))
    }

    private val bar = """{"id":"f","type":"bar","settings":{}}"""

    private fun zone(groups: String): DeliveryZone = readZone(
        Json.parseToJsonElement("""{"id":"z1","name":"Home top","slug":"home-top","theme":null,"frame":$bar,"taleGroups":$groups}""") as JsonObject,
    )

    @Test
    fun theBarStartsItsItemsOnTheRightInRightToLeft() = runComposeUiTest {
        val groups = zone("""[{"id":"a","name":"A","tales":[]},{"id":"b","name":"B","tales":[]},{"id":"c","name":"C","tales":[]}]""").taleGroups
        setContent {
            CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl) {
                TaleartBar(groups, BarSettings(), TaleartTheme.DEFAULT, emptySet(), onGroupClick = {})
            }
        }
        waitForIdle()
        val lefts = onAllNodesWithTag(BAR_ITEM_TAG).fetchSemanticsNodes().map { it.boundsInRoot.left }
        assertEquals(3, lefts.size)
        // The first group is the rightmost item: the lefts run from the end of the line to its start.
        assertEquals(lefts.sortedDescending(), lefts)
    }

    @Test
    fun theBarStartsItsItemsOnTheLeftInLeftToRight() = runComposeUiTest {
        val groups = zone("""[{"id":"a","name":"A","tales":[]},{"id":"b","name":"B","tales":[]},{"id":"c","name":"C","tales":[]}]""").taleGroups
        setContent {
            CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Ltr) {
                TaleartBar(groups, BarSettings(), TaleartTheme.DEFAULT, emptySet(), onGroupClick = {})
            }
        }
        waitForIdle()
        val lefts = onAllNodesWithTag(BAR_ITEM_TAG).fetchSemanticsNodes().map { it.boundsInRoot.left }
        assertEquals(lefts.sorted(), lefts)
    }

    @Test
    fun theCountdownDigitsRunLeftToRightInRightToLeft() = runComposeUiTest {
        val endsAt = Instant.parse("2026-12-31T21:00:00Z")
        val now = endsAt - (2 * 86_400 + 3 * 3_600 + 4 * 60 + 5).seconds
        val layer = DocumentLayer.read(
            Json.parseToJsonElement(
                """{"version":1,"canvas":{"background":{"type":"color","color":"#000000"}},"elements":[{"id":"cd","type":"countdown","box":{"x":0.1,"y":0.2,"w":0.8,"h":0.6,"rotation":0},"a11y":{},"props":{"endsAt":"2026-12-31T21:00:00Z"}}]}""",
            ) as JsonObject,
        )
        setContent {
            CompositionLocalProvider(
                LocalTaleClock provides { now },
                LocalLayoutDirection provides LayoutDirection.Rtl,
            ) {
                Box(Modifier.size(180.dp, 320.dp)) { DocumentElementsLayer(layer) }
            }
        }
        waitForIdle()
        val days = onNodeWithText("02", useUnmergedTree = true).getBoundsInRoot().left
        val seconds = onNodeWithText("05", useUnmergedTree = true).getBoundsInRoot().left
        assertTrue(days < seconds, "days stay at the start of the digits: $days < $seconds")
    }

    @Test
    fun theZoneReadThroughAControllerMirrorsWhenTheConfiguredDirectionArrivesAfterTheFirstComposition() = runComposeUiTest {
        // The taller app's order: the zone is on screen before TaleartSdk.init runs (in a LaunchedEffect).
        val zoneJson = """{"id":"z1","name":"Home top","slug":"home-top","theme":null,"frame":$bar,"taleGroups":[{"id":"a","name":"A","tales":[]},{"id":"b","name":"B","tales":[]},{"id":"c","name":"C","tales":[]}]}"""
        val controller = TaleartZoneController(
            DeliveryClient(HttpClient(MockEngine { respond(zoneJson, HttpStatusCode.OK, headersOf(HttpHeaders.ContentType, "application/json")) })),
        )
        controller.configure("http://api.test", "tak_key")
        try {
            setContent { TaleartZone(controller, seenGroups = SeenGroups(InMemoryKeyValueStore())) }
            waitUntil("the zone is read", 5_000) { controller.zone != null }
            waitForIdle()
            TaleartSdk.init(TaleartConfig(layoutDirection = "rtl"))
            waitForIdle()
            val lefts = onAllNodesWithTag(BAR_ITEM_TAG).fetchSemanticsNodes().map { it.boundsInRoot.left }
            assertEquals(3, lefts.size)
            assertEquals(lefts.sortedDescending(), lefts)
        } finally {
            controller.close()
            TaleartSdk.init(TaleartConfig())
        }
    }
}
