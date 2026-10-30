package site.lempert.taleart.taller

/**
 * Taller's own texts for the bar, in Hebrew, as the SDK's per-locale overrides (`TaleartConfig.strings`): they show
 * when the locale is Hebrew, and the English texts of the SDK otherwise. The keys are the SDK's `bar.*` keys.
 */
object TallerStrings {
    /** The Hebrew bar texts, keyed by the Hebrew language (`he`, also `he-IL`). */
    val bar: Map<String, Map<String, String>> = mapOf(
        "he" to mapOf(
            "bar.loading" to "טוענים סיפורים",
            "bar.story" to "{count} סיפור",
            "bar.stories" to "{count} סיפורים",
            "bar.newStory" to "{count} סיפור חדש",
            "bar.newStories" to "{count} סיפורים חדשים",
        ),
    )
}
