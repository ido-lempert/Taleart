package site.lempert.taleart.sdk.i18n

import kotlin.test.Test
import kotlin.test.assertEquals

// The poll, quiz, rating and reaction texts keep the Web SDK's keys and English words
// (libs/web-sdk/src/lib/i18n.ts, DEFAULT_STRINGS). A native table with a key the Web SDK lacks, or one
// that differs, is a parity break.
class InteractiveStringsTest {
    private val webEnglish = mapOf(
        "poll.voted" to "You voted {label}.",
        "poll.chose" to "You chose {label}.",
        "poll.previewNotRecorded" to "Votes are not recorded in the preview.",
        "poll.failed" to "Your vote could not be sent. Try again.",
        "quiz.answered" to "You answered {label}.",
        "quiz.right" to "Right! You answered {label}.",
        "quiz.wrongAnswer" to "Wrong: you answered {label}. The correct answer is {correct}.",
        "quiz.correct" to " correct answer",
        "quiz.wrong" to " wrong",
        "quiz.previewNotRecorded" to "Answers are not recorded in the preview.",
        "quiz.failed" to "Your answer could not be sent. Try again.",
        "rating.sliderLabel" to "Your rating",
        "rating.valueText" to "{value} out of {max}",
        "rating.ratedValueText" to "You rated {value} out of {max}",
        "rating.sent" to "You rated {value}.",
        "rating.previewRated" to "You rated {value}. Ratings are not recorded in the preview.",
        "rating.failed" to "Your rating could not be sent. Try again.",
        "rating.summary" to "Average {average} from {total} {count}",
        "rating.singular" to "rating",
        "rating.plural" to "ratings",
        "reaction.count" to "Reactions: {count}",
        "reaction.failed" to "Your reaction could not be sent. Try again.",
    )

    @Test
    fun theNativeTableHasTheWebKeysAndEnglishWords() {
        for ((key, text) in webEnglish) assertEquals(text, TaleartStrings.DEFAULTS[key], key)
    }

    @Test
    fun theNativeTableHasNoInteractiveKeyTheWebSdkLacks() {
        val native = TaleartStrings.DEFAULTS.keys.filter { it.substringBefore('.') in setOf("poll", "quiz", "rating", "reaction") }
        assertEquals(webEnglish.keys.sorted(), native.sorted())
    }

    @Test
    fun aLocaleWithoutATableShowsTheEnglishTexts() {
        val translate = createTranslate("he-IL")
        assertEquals("You rated 80 out of 100", translate("rating.ratedValueText", mapOf("value" to 80, "max" to 100)))
        assertEquals("Reactions: 3", translate("reaction.count", mapOf("count" to 3)))
    }
}
