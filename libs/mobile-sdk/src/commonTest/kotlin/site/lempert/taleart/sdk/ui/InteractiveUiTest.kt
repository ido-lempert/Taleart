package site.lempert.taleart.sdk.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.v2.runComposeUiTest
import androidx.compose.ui.unit.dp
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import site.lempert.taleart.sdk.ComponentRef
import site.lempert.taleart.sdk.delivery.ChoiceCount
import site.lempert.taleart.sdk.delivery.ChoiceResult
import site.lempert.taleart.sdk.delivery.InteractiveResponse
import site.lempert.taleart.sdk.delivery.RatingResult
import site.lempert.taleart.sdk.delivery.ReactionCount
import site.lempert.taleart.sdk.delivery.ReactionResult
import site.lempert.taleart.sdk.delivery.ResponseOutcome
import site.lempert.taleart.sdk.delivery.StoredResponse
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

// The interactive elements drawn on the native canvas (components, 2026-10-29): a poll's and a quiz's
// options as buttons that show the shares once answered, the quiz's marks, a rating's slider and count,
// a reaction's row of counts; one answer per element, a refused answer that leaves the element open, a
// kept answer shown at once, and no request at all in a preview.
@OptIn(ExperimentalTestApi::class)
class InteractiveUiTest : ComposeUiTestBase() {
    /** A responder that records what it was asked to post and answers as [outcome] says. */
    private class FakeResponder(
        var outcome: ResponseOutcome = ResponseOutcome.Failed("unset", null),
        private val kept: StoredResponse? = null,
    ) : ElementResponder {
        val sent = mutableListOf<String>()
        override fun stored(elementId: String): StoredResponse? = kept
        override suspend fun send(component: ComponentRef, value: String): ResponseOutcome {
            sent += "${component.type}:$value"
            return outcome
        }
    }

    private fun answered(value: String, result: site.lempert.taleart.sdk.delivery.ResponseResult) =
        ResponseOutcome.Answered(InteractiveResponse("el", value, recorded = true, result = result))

    private fun layerOf(vararg elements: String): DocumentLayer = DocumentLayer.read(
        Json.parseToJsonElement("""{"version":1,"canvas":{"background":{"type":"color","color":"#000000"}},"elements":[${elements.joinToString(",")}]}""") as JsonObject,
    )

    private fun element(type: String, props: String, id: String = "el", h: Double = 0.9) =
        """{"id":"$id","type":"$type","box":{"x":0.1,"y":0.05,"w":0.8,"h":$h,"rotation":0},"a11y":{},"props":$props}"""

    private val pollProps = """{"question":"Drink?","options":[{"id":"tea","label":"Tea"},{"id":"coffee","label":"Coffee"}],"theme":"light"}"""

    @Test
    fun aPollVoteIsSentOnceAndShowsTheSharesAndTheVote() = runComposeUiTest {
        val responder = FakeResponder(answered("tea", ChoiceResult(3, listOf(ChoiceCount("tea", 2, 67), ChoiceCount("coffee", 1, 33)))))
        setContent {
            CompositionLocalProvider(LocalElementResponder provides responder) {
                Box(Modifier.size(180.dp, 320.dp)) { DocumentElementsLayer(layerOf(element("poll", pollProps)).elements.let { DocumentLayer(it, ReadingDirection.Ltr) }) }
            }
        }
        waitForIdle()
        onNodeWithContentDescription("Tea").performClick()
        waitUntil("the result", 5_000) { onAllNodesWithText("You voted Tea. Tea 67%, Coffee 33%").fetchSemanticsNodes().isNotEmpty() }
        assertEquals(listOf("poll:tea"), responder.sent)
        onNodeWithContentDescription("Tea, 67%").assertIsSelected().assertIsNotEnabled()
        onNodeWithContentDescription("Coffee, 33%").assertIsNotEnabled()
        // A second press takes no second answer.
        onNodeWithContentDescription("Coffee, 33%").performClick()
        waitForIdle()
        assertEquals(listOf("poll:tea"), responder.sent)
    }

    @Test
    fun aRefusedVoteSaysSoAndLeavesTheOptionsOpen() = runComposeUiTest {
        val responder = FakeResponder(ResponseOutcome.Failed("no", 422))
        setContent {
            CompositionLocalProvider(LocalElementResponder provides responder) {
                Box(Modifier.size(180.dp, 320.dp)) { DocumentElementsLayer(layerOf(element("poll", pollProps))) }
            }
        }
        waitForIdle()
        onNodeWithContentDescription("Tea").performClick()
        waitUntil("the failure", 5_000) { onAllNodesWithText("Your vote could not be sent. Try again.").fetchSemanticsNodes().isNotEmpty() }
        onNodeWithContentDescription("Tea").assertIsEnabled()
        onNodeWithContentDescription("Coffee").assertIsEnabled()
    }

    @Test
    fun aKeptAnswerShowsAtOnceWithItsResultAndSendsNothing() = runComposeUiTest {
        val responder = FakeResponder(kept = StoredResponse("coffee", ChoiceResult(2, listOf(ChoiceCount("tea", 1, 50), ChoiceCount("coffee", 1, 50)))))
        setContent {
            CompositionLocalProvider(LocalElementResponder provides responder) {
                Box(Modifier.size(180.dp, 320.dp)) { DocumentElementsLayer(layerOf(element("poll", pollProps))) }
            }
        }
        waitForIdle()
        onNodeWithContentDescription("Coffee, 50%").assertIsSelected().assertIsNotEnabled()
        assertTrue(responder.sent.isEmpty())
    }

    @Test
    fun aPreviewSendsNothingAndSaysItIsNotRecorded() = runComposeUiTest {
        val responder = FakeResponder(answered("tea", ChoiceResult(1, listOf(ChoiceCount("tea", 1, 100)))))
        setContent {
            CompositionLocalProvider(LocalElementResponder provides responder) {
                Box(Modifier.size(180.dp, 320.dp)) { DocumentElementsLayer(layerOf(element("poll", pollProps)), inertLinks = true) }
            }
        }
        waitForIdle()
        onNodeWithContentDescription("Tea").performClick()
        waitUntil("the preview note", 5_000) { onAllNodesWithText("You chose Tea. Votes are not recorded in the preview.").fetchSemanticsNodes().isNotEmpty() }
        assertTrue(responder.sent.isEmpty(), "no request in a preview")
    }

    @Test
    fun aQuizMarksTheCorrectAnswerAndTheVisitorsWrongOne() = runComposeUiTest {
        val props = """{"question":"2+2?","answers":[{"id":"a","label":"3"},{"id":"b","label":"4"}],"correctAnswerId":"b","theme":"light"}"""
        val responder = FakeResponder(answered("a", ChoiceResult(1, listOf(ChoiceCount("a", 1, 100), ChoiceCount("b", 0, 0)))))
        setContent {
            CompositionLocalProvider(LocalElementResponder provides responder) {
                Box(Modifier.size(180.dp, 320.dp)) { DocumentElementsLayer(layerOf(element("quiz", props))) }
            }
        }
        waitForIdle()
        onNodeWithContentDescription("3").performClick()
        waitUntil("the wrong answer", 5_000) {
            onAllNodesWithText("Wrong: you answered 3. The correct answer is 4. 3 100%, 4 0%").fetchSemanticsNodes().isNotEmpty()
        }
        onNodeWithContentDescription("3 wrong, 100%").assertIsSelected()
        onNodeWithContentDescription("4 correct answer, 0%").assertIsNotEnabled()
        assertEquals(listOf("quiz:a"), responder.sent)
    }

    @Test
    fun aRatingIsPostedOnReleaseAndShowsTheAverage() = runComposeUiTest {
        val props = """{"question":"How was it?","emoji":"🔥","theme":"light"}"""
        val responder = FakeResponder(answered("50", RatingResult(total = 2, average = 60)))
        setContent {
            CompositionLocalProvider(LocalElementResponder provides responder) {
                Box(Modifier.size(180.dp, 320.dp)) { DocumentElementsLayer(layerOf(element("rating", props, h = 0.5))) }
            }
        }
        waitForIdle()
        onNodeWithContentDescription("Your rating").performClick()
        waitUntil("the average", 5_000) { onAllNodesWithText("Average 60 from 2 ratings").fetchSemanticsNodes().isNotEmpty() }
        assertEquals(1, responder.sent.size)
        assertTrue(responder.sent.single().startsWith("rating:"))
        onNodeWithContentDescription("Your rating").assertIsNotEnabled()
    }

    @Test
    fun aReactionTapShowsEveryCountAndMarksTheTappedEmoji() = runComposeUiTest {
        val props = """{"question":"Feel?","emojis":["😂","❤️"]}"""
        val responder = FakeResponder(answered("😂", ReactionResult(total = 2, reactions = listOf(ReactionCount("😂", 2), ReactionCount("❤️", 0)))))
        setContent {
            CompositionLocalProvider(LocalElementResponder provides responder) {
                Box(Modifier.size(180.dp, 320.dp)) { DocumentElementsLayer(layerOf(element("reaction", props, h = 0.4))) }
            }
        }
        waitForIdle()
        onNodeWithContentDescription("😂").performClick()
        waitUntil("the counts", 5_000) { onAllNodesWithText("😂 Reactions: 2, ❤️ Reactions: 0").fetchSemanticsNodes().isNotEmpty() }
        onNodeWithContentDescription("😂, Reactions: 2").assertIsSelected().assertIsNotEnabled()
        onNodeWithContentDescription("❤️, Reactions: 0").assertIsNotEnabled()
        assertEquals(listOf("reaction:😂"), responder.sent)
    }

    @Test
    fun aPollShowsItsQuestionAsTheGroupName() = runComposeUiTest {
        setContent {
            Box(Modifier.size(180.dp, 320.dp)) { DocumentElementsLayer(layerOf(element("poll", pollProps))) }
        }
        waitForIdle()
        onNodeWithContentDescription("Drink?").fetchSemanticsNode()
        onNodeWithText("Tea").fetchSemanticsNode()
    }
}
