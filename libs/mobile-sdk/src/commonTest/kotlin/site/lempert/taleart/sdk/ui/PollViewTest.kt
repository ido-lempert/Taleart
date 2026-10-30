package site.lempert.taleart.sdk.ui

import androidx.compose.ui.graphics.Color
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import site.lempert.taleart.sdk.delivery.ChoiceCount
import site.lempert.taleart.sdk.delivery.ChoiceResult
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

// The poll views' pure logic (P6b): the view a poll reads (`view`, tolerant), each option's colour and its
// contrast-checked text, the this-or-that split and divider (mirrored in right to left), the quiz marks and
// the motion's arithmetic. The Compose drawing of the views is in PollViewUiTest.
class PollViewTest {
    private fun layerOf(vararg elements: String): DocumentLayer = DocumentLayer.read(
        Json.parseToJsonElement("""{"version":1,"canvas":{"background":{"type":"color","color":"#000000"}},"elements":[${elements.joinToString(",")}]}""") as JsonObject,
    )

    private fun poll(props: String) = """{"id":"p","type":"poll","box":{"x":0.1,"y":0.2,"w":0.8,"h":0.4,"rotation":0},"a11y":{},"props":$props}"""

    private fun pollProps(view: String?, color: String? = null): String {
        val colorA = color?.let { ""","color":"$it"""" }.orEmpty()
        val viewMember = view?.let { ""","view":"$it"""" }.orEmpty()
        return """{"question":"Drink?","options":[{"id":"tea","label":"Tea"$colorA},{"id":"coffee","label":"Coffee"}],"theme":"light"$viewMember}"""
    }

    private fun readPoll(props: String): DocumentElement.Poll = assertIs(layerOf(poll(props)).elements.single())

    // -- view ------------------------------------------------------------------------------------

    @Test
    fun eachPollViewKeyReadsItsView() {
        assertEquals(PollView.Sticker, readPoll(pollProps("sticker")).view)
        assertEquals(PollView.Embed, readPoll(pollProps("embed")).view)
        assertEquals(PollView.ThisOrThat, readPoll(pollProps("this-or-that")).view)
        assertEquals(PollView.Grid, readPoll(pollProps("grid")).view)
        assertEquals(PollView.Inline, readPoll(pollProps("inline")).view)
    }

    @Test
    fun aMissingUnknownOrNonStringViewIsTheSticker() {
        assertEquals(PollView.Sticker, readPoll(pollProps(null)).view)
        assertEquals(PollView.Sticker, readPoll(pollProps("carousel")).view)
        assertEquals(PollView.Sticker, readPoll(pollProps("Embed")).view)
        val numeric = """{"question":"Drink?","options":[{"id":"tea","label":"Tea"},{"id":"coffee","label":"Coffee"}],"theme":"light","view":42}"""
        assertEquals(PollView.Sticker, readPoll(numeric).view)
    }

    @Test
    fun aBadViewDoesNotSkipThePoll() {
        // A view the contract does not know is read as the sticker; the poll itself still draws.
        val p = readPoll(pollProps("gallery"))
        assertEquals("Drink?", p.question)
        assertEquals(2, p.options.size)
    }

    @Test
    fun theViewLeavesTheOtherPropsAsTheyWere() {
        val p = readPoll(pollProps("grid"))
        assertEquals(listOf(Choice("tea", "Tea"), Choice("coffee", "Coffee")), p.options)
        assertEquals(false, p.dark)
    }

    // -- option colour -----------------------------------------------------------------------------

    @Test
    fun anOptionReadsItsHexColourAndAnOthersAreNull() {
        val p = readPoll(pollProps("this-or-that", color = "#0891b2"))
        assertEquals("#0891b2", p.options[0].color)
        assertNull(p.options[1].color)
    }

    @Test
    fun aColourThatIsNotHexIsLeftOutAndThePollStillDraws() {
        val p = readPoll(pollProps("grid", color = "teal"))
        assertNull(p.options[0].color)
        assertEquals(2, p.options.size)
    }

    @Test
    fun aChoiceWithoutAColourIsEqualToTheOldShape() {
        assertEquals(Choice("tea", "Tea"), Choice("tea", "Tea", null))
    }

    @Test
    fun anOptionsColourIsItsOwnThenTheThemesFallback() {
        val palette = TaleartTheme.DEFAULT.colors(hostTitle = Color.Unspecified, systemDark = false)
        assertEquals(Color(0xFF0891B2), optionFill(Choice("a", "A", "#0891b2"), 0, palette))
        assertEquals(palette.live, optionFill(Choice("a", "A"), 0, palette))
        assertEquals(palette.title, optionFill(Choice("b", "B"), 1, palette))
    }

    @Test
    fun theTextOnAnyColourReadsAtFourAndAHalfToOneOrMore() {
        // A sweep of the colour cube: every colour's text (white or black) is at 4.5:1 or more.
        val levels = (0..255 step 17)
        for (r in levels) for (g in levels) for (b in levels) {
            val colour = Color(r / 255f, g / 255f, b / 255f)
            val text = textOn(colour)
            assertTrue(contrastRatio(text, colour) >= 4.5, "colour $r,$g,$b")
        }
    }

    @Test
    fun theTextOnAMidToneColourIsBlackOrWhite() {
        // A mid-tone colour contrasts about equally with both; the text is then one of the two, and it reads.
        val mid = Color(0xFF777777)
        assertTrue(textOn(mid) == Color.White || textOn(mid) == Color.Black)
        assertTrue(contrastRatio(textOn(mid), mid) >= 4.5)
        assertEquals(Color.Black, textOn(Color.White))
    }

    @Test
    fun contrastOfBlackAndWhiteIsTwentyOne() {
        assertEquals(21.0, contrastRatio(Color.Black, Color.White), 0.01)
    }

    // -- this-or-that split and divider -------------------------------------------------------------

    private val tea = Choice("tea", "Tea")
    private val coffee = Choice("coffee", "Coffee")

    @Test
    fun beforeAVoteTheHalvesAreEqual() {
        assertEquals(50, thisOrThatPercentA(null, tea, coffee))
    }

    @Test
    fun afterAVoteTheSplitIsTheVoteShare() {
        val result = ChoiceResult(10, listOf(ChoiceCount("tea", 6, 60), ChoiceCount("coffee", 4, 40)))
        assertEquals(60, thisOrThatPercentA(result, tea, coffee))
    }

    @Test
    fun aVoteWithNoSharesIsEqualHalves() {
        val result = ChoiceResult(0, listOf(ChoiceCount("tea", 0, 0), ChoiceCount("coffee", 0, 0)))
        assertEquals(50, thisOrThatPercentA(result, tea, coffee))
    }

    @Test
    fun theDividerSitsAtTheSplitFromTheStartEdge() {
        // Left to right: option A starts on the left, so the divider is at 60 % of the width from the left.
        assertEquals(120f, dividerCenterX(60, 200f, rtl = false), 0.01f)
        // Right to left: option A starts on the right, so the divider is at 60 % from the right, 80 px from the left.
        assertEquals(80f, dividerCenterX(60, 200f, rtl = true), 0.01f)
    }

    @Test
    fun theDividerIsMirroredInRightToLeftAroundTheMiddle() {
        for (p in listOf(0, 25, 50, 73, 100)) {
            val ltr = dividerCenterX(p, 300f, rtl = false)
            val rtl = dividerCenterX(p, 300f, rtl = true)
            assertEquals(300f, ltr + rtl, 0.01f, "share $p")
        }
    }

    @Test
    fun theDividerClampsAShareOutsideZeroToHundred() {
        assertEquals(0f, dividerCenterX(-5, 200f, rtl = false), 0.01f)
        assertEquals(200f, dividerCenterX(140, 200f, rtl = false), 0.01f)
    }

    // -- quiz marks ------------------------------------------------------------------------------

    private fun stateWith(shown: String?, quiz: Boolean = true, correct: String? = "cotton") = ChoiceState(
        shown = shown,
        result = null,
        busy = false,
        live = "",
        spoken = "",
        quiz = quiz,
        correctId = correct,
        onPress = {},
    )

    private val cotton = Choice("cotton", "Organic cotton")
    private val linen = Choice("linen", "Linen")

    @Test
    fun aQuizMarksNothingBeforeAnAnswer() {
        val s = stateWith(shown = null)
        assertNull(s.markOf(cotton))
        assertNull(s.markOf(linen))
    }

    @Test
    fun aRightAnswerMarksTheCorrectOneRight() {
        val s = stateWith(shown = "cotton")
        assertEquals(Mark.Right, s.markOf(cotton))
        assertNull(s.markOf(linen))
    }

    @Test
    fun aWrongAnswerMarksItWrongAndTheCorrectOneRight() {
        val s = stateWith(shown = "linen")
        assertEquals(Mark.Wrong, s.markOf(linen))
        // The correct answer is highlighted after a wrong pick.
        assertEquals(Mark.Right, s.markOf(cotton))
    }

    @Test
    fun aSurveyOrAPollMarksNoChoice() {
        assertNull(stateWith(shown = "linen", correct = null).markOf(linen))
        assertNull(stateWith(shown = "linen", quiz = false, correct = null).markOf(linen))
    }

    @Test
    fun aLockedChoiceIsOneAnswerPerVisitor() {
        assertTrue(stateWith(shown = "linen").locked)
        assertTrue(!stateWith(shown = null).locked)
    }

    // -- motion arithmetic ------------------------------------------------------------------------

    @Test
    fun theThumbGrowsWithTheRating() {
        assertTrue(ratingThumbScale(0f) < ratingThumbScale(50f))
        assertTrue(ratingThumbScale(50f) < ratingThumbScale(100f))
        assertEquals(0.8f, ratingThumbScale(0f), 0.001f)
        assertEquals(1.3f, ratingThumbScale(100f), 0.001f)
    }

    @Test
    fun aRisingEmojiFadesInThenOut() {
        assertEquals(0f, risingAlpha(0f), 0.001f)
        assertEquals(1f, risingAlpha(0.15f), 0.001f)
        assertEquals(0f, risingAlpha(1f), 0.001f)
        assertTrue(risingAlpha(0.5f) in 0.3f..0.8f)
    }
}
