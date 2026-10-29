package site.lempert.taleart.sdk

/**
 * The options of [TaleartSdk.init], as `Taleart.init(config)` in the Web SDK. Every option is
 * optional: the defaults are the ones the SDK uses when none is given.
 *
 * [apiUrl] is the TaleArt API origin (`https://api.example.com`); a view's own `apiUrl` wins over
 * it. [locale] is the SDK's locale (BCP 47, `he-IL`); empty means the device's locale, then English.
 * [strings] are the texts per locale, and [stringsForEveryLocale] the texts for every locale (see
 * `i18n.Translate` for the lookup order). [listener] gets the hooks of every view. [externalUserId]
 * and [tags] are the viewer's targeting values; the native SDK stores them but does not send them
 * yet.
 */
data class TaleartConfig(
    val apiUrl: String = "",
    val locale: String = "",
    val strings: Map<String, Map<String, String>> = emptyMap(),
    val stringsForEveryLocale: Map<String, String> = emptyMap(),
    val listener: TaleartListener? = null,
    val externalUserId: String? = null,
    val tags: List<String> = emptyList(),
)
