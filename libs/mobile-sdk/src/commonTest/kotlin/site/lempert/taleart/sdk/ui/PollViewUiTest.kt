package site.lempert.taleart.sdk.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.test.ComposeUiTest
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.v2.runComposeUiTest
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import site.lempert.taleart.sdk.ComponentRef
import site.lempert.taleart.sdk.delivery.ChoiceCount
import site.lempert.taleart.sdk.delivery.ChoiceResult
import site.lempert.taleart.sdk.delivery.ResponseOutcome
import site.lempert.taleart.sdk.delivery.StoredResponse
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

// The poll views drawn (P6b) in left to right and right to left: each view's structure and semantics, the
// this-or-that split and divider from the nodes' bounds, the quiz marks, a preview's press, and reduced motion.
// A voted poll is a stored answer (no network); a preview has no responder and records nothing.
@OptIn(ExperimentalTestApi::class)
class PollViewUiTest : ComposeUiTestBase() {
    private fun layerOf(vararg elements: String): DocumentLayer = DocumentLayer.read(
        Json.parseToJsonElement("""{"version":1,"canvas":{"background":{"type":"color","color":"#000000"}},"elements":[${elements.joinToString(",")}]}""") as JsonObject,
    )

    private fun poll(view: String?, colors: Boolean = false): String {
        val viewMember = view?.let { ""","view":"$it"""" }.orEmpty()
        val tea = if (colors) """{"id":"tea","label":"Tea","color":"#0891b2"}""" else """{"id":"tea","label":"Tea"}"""
        val coffee = if (colors) """{"id":"coffee","label":"Coffee","color":"#ea580c"}""" else """{"id":"coffee","label":"Coffee"}"""
        return """{"id":"p","type":"poll","box":{"x":0,"y":0,"w":1,"h":1,"rotation":0},"a11y":{},"props":{"question":"Drink?","options":[$tea,$coffee],"theme":"light"$viewMember}}"""
    }

    private fun quiz(): String =
        """{"id":"q","type":"quiz","box":{"x":0,"y":0,"w":1,"h":1,"rotation":0},"a11y":{},"props":{"question":"Made of?","answers":[{"id":"cotton","label":"Organic cotton"},{"id":"linen","label":"Linen"}],"correctAnswerId":"cotton","theme":"light"}}"""

    private fun promo(): String =
        """{"id":"promo","type":"promo-code","box":{"x":0,"y":0,"w":1,"h":1,"rotation":0},"a11y":{},"props":{"code":"SAVE20","theme":"light"}}"""

    // A stored vote for Tea: 6 of 10 votes, so the split is 60 / 40.
    private val votedTea = FakeResponder(StoredResponse("tea", ChoiceResult(10, listOf(ChoiceCount("tea", 6, 60), ChoiceCount("coffee", 4, 40)))))

    private class FakeResponder(private val stored: StoredResponse?) : ElementResponder {
        override fun stored(elementId: String): StoredResponse? = stored
        override suspend fun send(component: ComponentRef, value: String): ResponseOutcome = ResponseOutcome.Failed("not in a test", null)
    }

    private fun ComposeUiTest.drawn(layer: DocumentLayer, responder: ElementResponder?, rtl: Boolean = false, reduced: Boolean = true) = setContent {
        CompositionLocalProvider(
            LocalLayoutDirection provides if (rtl) LayoutDirection.Rtl else LayoutDirection.Ltr,
            LocalTaleReducedMotion provides reduced,
            LocalElementResponder provides responder,
        ) {
            Box(Modifier.size(300.dp, 380.dp)) { DocumentElementsLayer(layer) }
        }
    }

    private fun ComposeUiTest.boundsOf(description: String): Rect = onNodeWithContentDescription(description).fetchSemanticsNode().boundsInRoot

    // -- the card grows ---------------------------------------------------------------------------------

    // A card's box is its minimum height: the inline poll's pills (48 dp targets) in a short box were cut off by the card.
    @Test
    fun anInlinePollInAShortBoxGrowsToShowItsPills() = runComposeUiTest {
        val short = poll("inline").replace(""""h":1""", """"h":0.05""")
        drawn(layerOf(short), null)
        waitForIdle()
        val card = onNodeWithTag(DOCUMENT_ELEMENT_TAG, useUnmergedTree = true).fetchSemanticsNode().boundsInRoot
        val pill = boundsOf("Tea")
        assertTrue(card.height > 380f * 0.05f * density.density, "the card is taller than its 5 % box")
        assertTrue(pill.bottom <= card.bottom + 1f, "the pills lie inside the card")
    }

    // The other views fill their box (the halves, the tiles): only the inline poll grows, the rest keep the box's height.
    @Test
    fun aThisOrThatPollKeepsItsBoxHeight() = runComposeUiTest {
        val boxed = poll("this-or-that", colors = true).replace(""""h":1""", """"h":0.4""")
        drawn(layerOf(boxed), null)
        waitForIdle()
        val card = onNodeWithTag(DOCUMENT_ELEMENT_TAG, useUnmergedTree = true).fetchSemanticsNode().boundsInRoot
        assertEquals(380f * 0.4f * density.density, card.height, 2f)
    }

    // -- this-or-that -------------------------------------------------------------------------------

    @Test
    fun thisOrThatSplitsAtTheVoteLeftToRight() = runComposeUiTest {
        drawn(layerOf(poll("this-or-that", colors = true)), votedTea, rtl = false)
        waitForIdle()
        val tea = boundsOf("Tea, 60%")
        val coffee = boundsOf("Coffee, 40%")
        assertTrue(tea.left < coffee.left, "tea starts on the left")
        assertEquals(0.6f, tea.width / (tea.width + coffee.width), 0.02f)
    }

    @Test
    fun thisOrThatSplitsAtTheVoteRightToLeft() = runComposeUiTest {
        drawn(layerOf(poll("this-or-that", colors = true)), votedTea, rtl = true)
        waitForIdle()
        val tea = boundsOf("Tea, 60%")
        val coffee = boundsOf("Coffee, 40%")
        assertTrue(tea.left > coffee.left, "tea starts on the right")
        assertEquals(0.6f, tea.width / (tea.width + coffee.width), 0.02f)
    }

    @Test
    fun theDividerSitsOnTheSeamLeftToRight() = runComposeUiTest {
        drawn(layerOf(poll("this-or-that")), votedTea, rtl = false)
        waitForIdle()
        val seam = boundsOf("Tea, 60%").right
        // The marker is found by its tag in the unmerged tree; its centre is the seam.
        val marker = onNodeWithTag(DIVIDER_TAG, useUnmergedTree = true).fetchSemanticsNode().boundsInRoot
        assertEquals(seam, (marker.left + marker.right) / 2f, 2f)
    }

    @Test
    fun theDividerSitsOnTheSeamRightToLeft() = runComposeUiTest {
        drawn(layerOf(poll("this-or-that")), votedTea, rtl = true)
        waitForIdle()
        val seam = boundsOf("Tea, 60%").left
        val marker = onNodeWithTag(DIVIDER_TAG, useUnmergedTree = true).fetchSemanticsNode().boundsInRoot
        assertEquals(seam, (marker.left + marker.right) / 2f, 2f)
    }

    // A half narrower than its share figure (the 40 % half on a phone, or one at its 12 % minimum) cut the figure at the box's edge;
    // the figure now steps down in size until it fits its half, and keeps its full 2.4em in a wide one.
    @Test
    fun aShareFigureStepsDownToFitItsHalf() = runComposeUiTest {
        var wide: TextLayoutResult? = null
        var narrow: TextLayoutResult? = null
        setContent {
            val canvas = CanvasMetrics(300f, 380f, LocalDensity.current)
            Box(Modifier.size(300.dp, 100.dp)) { ShareFigure(40, Color.Black, canvas.h(CARD_FONT), canvas) { wide = it } }
            Box(Modifier.size(34.dp, 100.dp)) { ShareFigure(40, Color.Black, canvas.h(CARD_FONT), canvas) { narrow = it } }
        }
        waitForIdle()
        assertTrue(wide != null && narrow != null)
        assertTrue(!wide!!.didOverflowWidth && !narrow!!.didOverflowWidth, "neither is cut at its box's edge")
        assertTrue(narrow!!.size.width < wide!!.size.width, "the narrow half's figure is drawn smaller")
    }

    @Test
    fun thisOrThatHalvesAreEqualBeforeAVote() = runComposeUiTest {
        drawn(layerOf(poll("this-or-that")), responder = null)
        waitForIdle()
        val tea = boundsOf("Tea")
        val coffee = boundsOf("Coffee")
        assertEquals(0.5f, tea.width / (tea.width + coffee.width), 0.02f)
    }

    @Test
    fun aPreviewPressOnAHalfSaysItIsNotRecorded() = runComposeUiTest {
        drawn(layerOf(poll("this-or-that")), responder = null)
        waitForIdle()
        onNodeWithContentDescription("Tea").performClick()
        waitForIdle()
        onNodeWithContentDescription("Votes are not recorded in the preview.", substring = true).assertIsDisplayed()
    }

    // -- grid -------------------------------------------------------------------------------------

    @Test
    fun gridDrawsTwoTilesWithTheirSharesLeftToRight() = runComposeUiTest {
        drawn(layerOf(poll("grid", colors = true)), votedTea, rtl = false)
        waitForIdle()
        val tea = boundsOf("Tea, 60%")
        val coffee = boundsOf("Coffee, 40%")
        assertTrue(tea.left < coffee.left)
        // Tiles share the row equally, whatever the vote.
        assertEquals(tea.width, coffee.width, 1f)
    }

    @Test
    fun gridDrawsTheTilesRightToLeft() = runComposeUiTest {
        drawn(layerOf(poll("grid", colors = true)), votedTea, rtl = true)
        waitForIdle()
        assertTrue(boundsOf("Tea, 60%").left > boundsOf("Coffee, 40%").left)
    }

    // -- embed and inline -------------------------------------------------------------------------

    @Test
    fun anEmbedSaysResultsAppearAfterAVote() = runComposeUiTest {
        drawn(layerOf(poll("embed")), responder = null)
        waitForIdle()
        onNodeWithText("Results appear after you vote").assertIsDisplayed()
    }

    @Test
    fun anEmbedShowsItsTotalAndTheSharesOnceVotedRightToLeft() = runComposeUiTest {
        drawn(layerOf(poll("embed")), votedTea, rtl = true)
        waitForIdle()
        onNodeWithText("votes", substring = true).assertIsDisplayed()
        onNodeWithContentDescription("Tea, 60%").assertIsDisplayed()
    }

    @Test
    fun anInlinePollDrawsCompactRowsWithTheirShares() = runComposeUiTest {
        drawn(layerOf(poll("inline")), votedTea, rtl = true)
        waitForIdle()
        onNodeWithContentDescription("Tea, 60%").assertIsDisplayed()
        onNodeWithContentDescription("Coffee, 40%").assertIsDisplayed()
    }

    @Test
    fun anInlinePollIsPillsInOneWrappingRowBeforeTheVoteAndTheBarWithItsLegendAfter() = runComposeUiTest {
        drawn(layerOf(poll("inline")), responder = null)
        waitForIdle()
        val tea = boundsOf("Tea")
        val coffee = boundsOf("Coffee")
        assertEquals(tea.top, coffee.top, 1f, "the pills share a row")
        assertTrue(tea.right <= coffee.left, "the pills sit side by side, not stacked full width")
        onNodeWithContentDescription("Tea").performClick()
        waitForIdle()
        // Once answered the pills give way to the stacked bar and its legend (a preview records nothing: 0 % each).
        assertTrue(onAllNodesWithContentDescription("Tea").fetchSemanticsNodes().isEmpty())
        onNodeWithContentDescription("Tea, 0%").assertIsDisplayed()
    }

    @Test
    fun aVotedInlinePollKeepsTheLegendInOneLinePerOptionWithTheirShares() = runComposeUiTest {
        drawn(layerOf(poll("inline")), votedTea)
        waitForIdle()
        onNodeWithContentDescription("Tea, 60%").assertIsDisplayed()
        onNodeWithContentDescription("Coffee, 40%").assertIsDisplayed()
    }

    @Test
    fun aStickerPollDrawsItsButtons() = runComposeUiTest {
        drawn(layerOf(poll(null)), votedTea, rtl = false)
        waitForIdle()
        onNodeWithContentDescription("Tea, 60%").assertIsDisplayed()
    }

    // -- quiz marks ---------------------------------------------------------------------------------

    @Test
    fun aWrongQuizAnswerIsMarkedAndTheCorrectOneToo() = runComposeUiTest {
        val wrong = FakeResponder(StoredResponse("linen", ChoiceResult(4, listOf(ChoiceCount("cotton", 2, 50), ChoiceCount("linen", 2, 50)))))
        drawn(layerOf(quiz()), wrong, rtl = true)
        waitForIdle()
        onNodeWithContentDescription("Organic cotton correct answer, 50%").assertIsDisplayed()
        onNodeWithContentDescription("Linen wrong, 50%").assertIsDisplayed()
    }

    @Test
    fun aQuizWithoutAnswerShowsNoMarks() = runComposeUiTest {
        drawn(layerOf(quiz()), responder = null)
        waitForIdle()
        onNodeWithContentDescription("Organic cotton").assertIsDisplayed()
        onNodeWithContentDescription("Linen").assertIsDisplayed()
    }

    // -- promo and motion ---------------------------------------------------------------------------

    @Test
    fun aPromoTicketDrawsItsCodeLeftToRightUnderReducedMotion() = runComposeUiTest {
        drawn(layerOf(promo()), responder = null, rtl = true, reduced = true)
        waitForIdle()
        onNodeWithText("SAVE20").assertIsDisplayed()
    }

    @Test
    fun aReactionsRisingEmojiIsNotDrawnUnderReducedMotion() = runComposeUiTest {
        var progress by mutableFloatStateOf(-1f)
        setContent {
            CompositionLocalProvider(LocalTaleReducedMotion provides true) {
                RisingEmoji(restart = 1, reduced = true) { progress = it }
            }
        }
        waitForIdle()
        assertEquals(-1f, progress, "no emoji rises under reduced motion")
    }

    @Test
    fun aRisingEmojiRisesAndEndsWhenMotionIsAllowed() = runComposeUiTest {
        var seen by mutableFloatStateOf(-1f)
        setContent {
            CompositionLocalProvider(LocalTaleReducedMotion provides false) {
                RisingEmoji(restart = 1, reduced = false) { seen = maxOf(seen, it) }
            }
        }
        waitUntil("the emoji rises", 5_000) { seen > 0.5f }
        waitUntil("the emoji has risen", 5_000) { seen > 0.9f }
    }
}
