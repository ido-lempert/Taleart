package site.lempert.taleart.sdk.i18n

/**
 * The texts the SDK shows or announces, English by default, as `DEFAULT_STRINGS` in
 * libs/web-sdk/src/lib/i18n.ts. The keys are the Web SDK's, so one translation file serves both;
 * a key only the native SDK shows (`links.open`) has no Web counterpart. `{name}` marks a value the
 * SDK fills in.
 */
object TaleartStrings {
    /** The English texts; every key the SDK looks up is here, so the fallback never shows a key. */
    val DEFAULTS: Map<String, String> = mapOf(
        "viewer.close" to "Close",
        "viewer.play" to "Play",
        "viewer.pause" to "Pause",
        "viewer.previousTale" to "Previous tale",
        "viewer.nextTale" to "Next tale",
        "viewer.progress" to "{group}, tale {tale} of {count}",
        "viewer.taleFallback" to "Tale {number}",

        "banner.label" to "Banner",
        "banner.carousel" to "carousel",
        "banner.slide" to "slide",
        "banner.slideOf" to "{index} of {count}",
        "banner.previousSlide" to "Previous slide",
        "banner.nextSlide" to "Next slide",
        "banner.showGroup" to "Show {name}",
        "banner.stopRotation" to "Stop automatic slide show",
        "banner.startRotation" to "Start automatic slide show",

        "bar.seen" to "{name}, seen",

        "load.failed" to "Stories could not be loaded.",
        "load.retry" to "Try again",

        "countdown.ended" to "Ended",
        "countdown.days" to "Days",
        "countdown.hours" to "Hours",
        "countdown.minutes" to "Min",
        "countdown.seconds" to "Sec",

        "promo.copy" to "Copy",
        "promo.copied" to "Copied",
        "promo.copyFailed" to "Could not copy. Select the code and copy it yourself.",

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

        // Native only: a link leaves the app for the browser (the Web SDK says the same with `links.newTab`).
        "links.open" to "Open in browser",
    )
}

/** Overrides of some texts for one locale, by key. */
typealias StringOverrides = Map<String, String>

/**
 * Looks a text up and fills its `{name}` values, as the Web SDK's `Translate`. Lookup order: the
 * strings for the full locale (`he-IL`), then for its language (`he`), then the strings for every
 * locale, then English. A key nobody defines shows English, never the key itself.
 */
class Translate internal constructor(
    /** The locale the texts are for, BCP 47 (`he-IL`). */
    val locale: String,
    private val byLocale: Map<String, StringOverrides>,
    private val forEveryLocale: StringOverrides,
) {
    /** The text for [key], with each `{name}` in [values] filled in. */
    operator fun invoke(key: String, values: Map<String, Any> = emptyMap()): String {
        val text = pick(key) ?: TaleartStrings.DEFAULTS[key] ?: return key
        return fill(text, values)
    }

    private fun pick(key: String): String? =
        byLocale[locale]?.get(key)
            ?: byLocale[language(locale)]?.get(key)
            ?: forEveryLocale[key]

    private fun fill(text: String, values: Map<String, Any>): String =
        PLACEHOLDER.replace(text) { match ->
            val name = match.groupValues[1]
            if (values.containsKey(name)) values.getValue(name).toString() else match.value
        }

    private companion object {
        val PLACEHOLDER = Regex("\\{(\\w+)\\}")
    }
}

/** The language part of a BCP 47 locale: `he` for `he-IL`, `he_IL` too. */
internal fun language(locale: String): String = locale.split('-', '_')[0]

/**
 * The translate function for [locale] (empty or blank means the device's locale, see
 * `TaleartSdk.init`), with [byLocale] overrides per locale and [forEveryLocale] overrides for all.
 */
fun createTranslate(
    locale: String,
    byLocale: Map<String, StringOverrides> = emptyMap(),
    forEveryLocale: StringOverrides = emptyMap(),
): Translate = Translate(locale.trim(), byLocale, forEveryLocale)

/**
 * Two sets of overrides as one, locale by locale: [own] wins over [base], as an element's strings
 * add to the SDK's.
 */
fun mergeStrings(
    base: Map<String, StringOverrides>,
    own: Map<String, StringOverrides>?,
): Map<String, StringOverrides> {
    if (own.isNullOrEmpty()) return base
    val merged = LinkedHashMap<String, StringOverrides>(base)
    for ((locale, texts) in own) merged[locale] = (merged[locale] ?: emptyMap()) + texts
    return merged
}

/** The English translate function: what the SDK uses before any configuration. */
val defaultTranslate: Translate = createTranslate("en")
