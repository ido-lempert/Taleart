package site.lempert.taleart.sdk

/**
 * The options of [TaleartSdk.init], as `Taleart.init(config)` in the Web SDK. Every option is
 * optional: the defaults are the ones the SDK uses when none is given.
 *
 * [apiUrl] is the TaleArt API origin (`https://api.example.com`); a view's own `apiUrl` wins over
 * it. [locale] is the SDK's locale (BCP 47, `he-IL`); empty means the device's locale, then English.
 * [strings] are the texts per locale, and [stringsForEveryLocale] the texts for every locale (see
 * `i18n.Translate` for the lookup order). [listener] gets the hooks of every view. [externalUserId]
 * is sent with each zone read in the `X-TaleArt-External-User-Id` header (base64url, never in a URL),
 * so the Delivery API can show the tale groups targeted to user lists its ID is in. [tags] are the
 * viewer's targeting tags: a group whose tags do not pass its rule is left out on the device, the
 * tags are never sent (as in the Web SDK's `setTags`).
 *
 * [fallback] is what a view shows when its zone fails to load: nothing ([FallbackMode.None], the
 * default), or the translated `load.failed` text with a `load.retry` button ([FallbackMode.Message]).
 * A host's own placeholder (`TaleartView.setFallbackView`) wins over both.
 *
 * [frequency] caps how often a viewer sees a tale group (null, the default, for no cap); see
 * [FrequencyRule]. [analytics] turns the SDK's impressions, opens, views and clicks on (the default)
 * or off; a view's own setting wins over it.
 */
data class TaleartConfig(
    val apiUrl: String = "",
    val locale: String = "",
    val strings: Map<String, Map<String, String>> = emptyMap(),
    val stringsForEveryLocale: Map<String, String> = emptyMap(),
    val listener: TaleartListener? = null,
    val externalUserId: String? = null,
    val tags: List<String> = emptyList(),
    val fallback: FallbackMode = FallbackMode.None,
    val frequency: FrequencyRule? = null,
    val analytics: Boolean = true,
)

/** What a view shows when its zone fails to load (`fallback` in the Web SDK): nothing, or the message and a retry button. */
enum class FallbackMode {
    /** Nothing: the view stays empty, as the Web SDK's `fallback="none"`. */
    None,

    /** The translated `load.failed` text and a `load.retry` button that reads the zone again. */
    Message,
}
