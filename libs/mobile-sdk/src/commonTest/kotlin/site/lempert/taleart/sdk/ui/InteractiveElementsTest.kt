package site.lempert.taleart.sdk.ui

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import site.lempert.taleart.sdk.i18n.createTranslate
import site.lempert.taleart.sdk.delivery.ChoiceCount
import site.lempert.taleart.sdk.delivery.ChoiceResult
import site.lempert.taleart.sdk.delivery.RatingResult
import site.lempert.taleart.sdk.delivery.ReactionCount
import site.lempert.taleart.sdk.delivery.ReactionResult
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue
import androidx.compose.ui.input.key.Key

// Reading the poll, quiz, rating and reaction elements with the schemas' limits
// (libs/contract/tale-document/element-types/{poll,quiz,rating,reaction}.schema.json), and the wording
// and arithmetic of their results, as the Web SDK draws them (libs/web-sdk/src/lib/document/*.ts).
class InteractiveElementsTest {
    private fun layerOf(vararg elements: String): DocumentLayer = DocumentLayer.read(
        Json.parseToJsonElement("""{"version":1,"canvas":{"background":{"type":"color","color":"#000000"}},"elements":[${elements.joinToString(",")}]}""") as JsonObject,
    )

    private fun element(type: String, props: String, id: String = type) =
        """{"id":"$id","type":"$type","box":{"x":0.1,"y":0.2,"w":0.8,"h":0.2,"rotation":0},"a11y":{},"props":$props}"""

    private val tea = """{"id":"tea","label":"Tea"}"""
    private val coffee = """{"id":"coffee","label":"Coffee"}"""
    private val poll = """{"question":"Drink?","options":[$tea,$coffee],"theme":"light"}"""

    // -- poll -----------------------------------------------------------------------------------

    @Test
    fun aPollReadsItsQuestionAndItsTwoOptions() {
        val p = assertIs<DocumentElement.Poll>(layerOf(element("poll", poll)).elements.single())
        assertEquals("Drink?", p.question)
        assertEquals(listOf(Choice("tea", "Tea"), Choice("coffee", "Coffee")), p.options)
        assertEquals(null, p.title)
        assertEquals(false, p.dark)
    }

    @Test
    fun aPollWithOneOptionOrThreeOrDuplicateIdsIsSkipped() {
        val one = """{"question":"?","options":[$tea],"theme":"light"}"""
        val three = """{"question":"?","options":[$tea,$coffee,{"id":"x","label":"X"}],"theme":"light"}"""
        val dup = """{"question":"?","options":[$tea,{"id":"tea","label":"Again"}],"theme":"light"}"""
        for (props in listOf(one, three, dup)) assertTrue(layerOf(element("poll", props)).elements.isEmpty(), props)
    }

    @Test
    fun aPollWithAnUnusableTextOrIdIsSkipped() {
        val blankLabel = """{"question":"?","options":[{"id":"a","label":"  "},$coffee],"theme":"light"}"""
        val badId = """{"question":"?","options":[{"id":"has space","label":"A"},$coffee],"theme":"light"}"""
        val longQuestion = """{"question":"${"q".repeat(201)}","options":[$tea,$coffee],"theme":"light"}"""
        val badTheme = """{"question":"?","options":[$tea,$coffee],"theme":"neon"}"""
        val emptyTitle = """{"title":"","question":"?","options":[$tea,$coffee],"theme":"light"}"""
        for (props in listOf(blankLabel, badId, longQuestion, badTheme, emptyTitle)) {
            assertTrue(layerOf(element("poll", props)).elements.isEmpty(), props)
        }
    }

    @Test
    fun aPollKeepsItsTitleAndDarkTheme() {
        val p = assertIs<DocumentElement.Poll>(
            layerOf(element("poll", """{"title":"Survey","question":"?","options":[$tea,$coffee],"theme":"dark"}""")).elements.single(),
        )
        assertEquals("Survey", p.title)
        assertEquals(true, p.dark)
    }

    // -- quiz -----------------------------------------------------------------------------------

    @Test
    fun aQuizReadsItsAnswersAndItsCorrectAnswer() {
        val q = assertIs<DocumentElement.Quiz>(
            layerOf(element("quiz", """{"question":"2+2?","answers":[{"id":"a","label":"3"},{"id":"b","label":"4"}],"correctAnswerId":"b","theme":"light"}""")).elements.single(),
        )
        assertEquals("b", q.correctAnswerId)
        assertEquals(2, q.answers.size)
    }

    @Test
    fun aQuizWithAnAnswerIdThatIsNoneOfItsAnswersIsASurvey() {
        val q = assertIs<DocumentElement.Quiz>(
            layerOf(element("quiz", """{"question":"?","answers":[$tea,$coffee],"correctAnswerId":"nope","theme":"light"}""")).elements.single(),
        )
        assertNull(q.correctAnswerId)
    }

    @Test
    fun aQuizTakesTwoToFourAnswersOnly() {
        val four = (1..4).joinToString(",") { """{"id":"a$it","label":"L$it"}""" }
        val five = (1..5).joinToString(",") { """{"id":"a$it","label":"L$it"}""" }
        assertIs<DocumentElement.Quiz>(layerOf(element("quiz", """{"question":"?","answers":[$four],"theme":"light"}""")).elements.single())
        assertTrue(layerOf(element("quiz", """{"question":"?","answers":[$five],"theme":"light"}""")).elements.isEmpty())
        assertTrue(layerOf(element("quiz", """{"question":"?","answers":[$tea],"theme":"light"}""")).elements.isEmpty())
    }

    @Test
    fun aQuizCorrectIdThatBreaksTheIdPatternSkipsTheElement() {
        assertTrue(layerOf(element("quiz", """{"question":"?","answers":[$tea,$coffee],"correctAnswerId":"no good","theme":"light"}""")).elements.isEmpty())
    }

    // -- rating ---------------------------------------------------------------------------------

    @Test
    fun aRatingReadsItsQuestionAndItsEmoji() {
        val r = assertIs<DocumentElement.Rating>(
            layerOf(element("rating", """{"question":"How was it?","emoji":"🔥","theme":"light"}""")).elements.single(),
        )
        assertEquals("How was it?", r.question)
        assertEquals("🔥", r.emoji)
    }

    @Test
    fun aRatingWithoutAnEmojiOrAQuestionIsSkipped() {
        assertTrue(layerOf(element("rating", """{"question":"?","emoji":"","theme":"light"}""")).elements.isEmpty())
        assertTrue(layerOf(element("rating", """{"question":"","emoji":"🔥","theme":"light"}""")).elements.isEmpty())
        assertTrue(layerOf(element("rating", """{"emoji":"🔥","theme":"light"}""")).elements.isEmpty())
    }

    // -- reaction -------------------------------------------------------------------------------

    @Test
    fun aReactionReadsItsEmojiInOrder() {
        val r = assertIs<DocumentElement.Reaction>(
            layerOf(element("reaction", """{"question":"Feel?","emojis":["❤️","😂","😮"]}""")).elements.single(),
        )
        assertEquals(listOf("❤️", "😂", "😮"), r.emojis)
        assertEquals(null, r.dark)
    }

    @Test
    fun aReactionNeedsTwoToSixDifferentEmoji() {
        val one = """{"question":"?","emojis":["😂"]}"""
        val seven = """{"question":"?","emojis":["1","2","3","4","5","6","7"]}"""
        val twice = """{"question":"?","emojis":["😂","😂"]}"""
        val blank = """{"question":"?","emojis":["😂",""]}"""
        val notText = """{"question":"?","emojis":["😂",3]}"""
        for (props in listOf(one, seven, twice, blank, notText)) assertTrue(layerOf(element("reaction", props)).elements.isEmpty(), props)
        assertIs<DocumentElement.Reaction>(layerOf(element("reaction", """{"question":"?","emojis":["1","2","3","4","5","6"]}""")).elements.single())
    }

    // -- results ----------------------------------------------------------------------------------

    @Test
    fun aPollsShareOfAChoiceAndItsStartAreWorded() {
        val choices = listOf(Choice("tea", "Tea"), Choice("coffee", "Coffee"))
        val result = ChoiceResult(total = 5, choices = listOf(ChoiceCount("tea", 3, 60), ChoiceCount("coffee", 2, 40)))
        val t = createTranslate("en")
        assertEquals(60, percentOf(result, "tea"))
        assertEquals(0, percentOf(result, "gone"))
        assertEquals(0, percentOf(RatingResult(1, 80), "tea"))
        assertEquals("You voted Tea.", pollStart(choices, "tea", t))
        assertEquals("", pollStart(choices, "gone", t))
        assertEquals("You voted Tea. Tea 60%, Coffee 40%", choiceSaying(pollStart(choices, "tea", t), choices, result))
    }

    @Test
    fun aQuizSaysRightWrongOrOnlyTheAnswerAsAnswered() {
        val answers = listOf(Choice("a", "3"), Choice("b", "4"))
        val t = createTranslate("en")
        assertEquals("Right! You answered 4.", quizStart(answers, "b", "b", t))
        assertEquals("Wrong: you answered 3. The correct answer is 4.", quizStart(answers, "b", "a", t))
        assertEquals("You answered 3.", quizStart(answers, null, "a", t))
        assertEquals("", quizStart(answers, "b", "zz", t))
    }

    @Test
    fun aRatingSummaryPluralisesAndWordsTheAverage() {
        val t = createTranslate("en")
        assertEquals("Average 80 from 1 rating", ratingSummary(RatingResult(1, 80), t))
        assertEquals("Average 60 from 3 ratings", ratingSummary(RatingResult(3, 60), t))
    }

    @Test
    fun aReactionCountIsTheCountOfItsEmoji() {
        val result = ReactionResult(total = 3, reactions = listOf(ReactionCount("❤️", 2), ReactionCount("😂", 1)))
        assertEquals(2, reactionCount(result, "❤️"))
        assertEquals(0, reactionCount(result, "😮"))
        assertEquals("Reactions: 2", createTranslate("en")("reaction.count", mapOf("count" to 2)))
    }

    @Test
    fun aRatingFromATouchIsItsShareOfTheTrackFromZeroToOneHundred() {
        assertEquals(0, ratingAt(0f, 200f))
        assertEquals(50, ratingAt(100f, 200f))
        assertEquals(100, ratingAt(260f, 200f))
        assertEquals(50, ratingAt(10f, 0f))
    }

    @Test
    fun aRatingKeyStepsByTenAndGoesToTheEnds() {
        assertEquals(60, ratingKey(50, Key.DirectionUp))
        assertEquals(40, ratingKey(50, Key.DirectionLeft))
        assertEquals(100, ratingKey(95, Key.PageUp))
        assertEquals(0, ratingKey(5, Key.PageDown))
        assertEquals(0, ratingKey(50, Key.MoveHome))
        assertEquals(100, ratingKey(50, Key.MoveEnd))
        assertNull(ratingKey(50, Key.A))
        assertTrue(ratingKey(50, Key.Enter) == null)
    }
}
