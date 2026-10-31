package site.lempert.taleart.sdk

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import site.lempert.taleart.sdk.delivery.DeliveryClient
import site.lempert.taleart.sdk.delivery.ZoneParse
import site.lempert.taleart.sdk.delivery.parseZoneJsonText
import site.lempert.taleart.sdk.i18n.Translate
import site.lempert.taleart.sdk.i18n.createTranslate

/** Shared TaleArt SDK core used by android-sdk and ios-sdk. */
object TaleartSdk {
    const val VERSION = "0.1.1"

    /**
     * The process's Delivery client, used by every zone not given its own. One client for the whole
     * app, as the Web SDK shares one module: zones that ask for the same zone at once share a request
     * and its ETag copy. It is never closed.
     */
    val sharedClient: DeliveryClient by lazy { DeliveryClient() }

    // Compose state: a view showing a zone reads it, so an init after the views are on screen reloads them.
    private var current by mutableStateOf(TaleartConfig())
    private var translated: Pair<TaleartConfig, Translate>? = null

    /**
     * Sets the SDK's configuration for every view, as `Taleart.init(config)`: the API origin, the
     * locale, the texts, the global listener and the viewer's values. It replaces the configuration
     * made before; views showing a zone read it again. Call it once, in `Application.onCreate` or the
     * app's start, before the views show.
     */
    fun init(config: TaleartConfig) {
        current = config
    }

    /**
     * Checks zone JSON the app holds, to show tales without a backend (`TaleartZone(zoneJson = ...)`,
     * `TaleartView.zoneJson`, `TaleartZoneView.zoneJson`): the zone, or the readable list of what is wrong.
     * The input is the body of `GET /delivery/v1/zone`. It reads nothing from the network and never throws.
     */
    fun parseZoneJson(json: String): ZoneParse = parseZoneJsonText(json)

    /** The configuration in use: the last [init], or the defaults. */
    val config: TaleartConfig get() = current

    /** The SDK's locale: the configured one, else the device's. */
    val locale: String get() = current.locale.trim().ifEmpty { deviceLocale() }

    /** The translate function of the SDK's configuration (the texts of a view with no overrides of its own). */
    val translate: Translate
        get() {
            val config = current
            translated?.takeIf { it.first === config }?.let { return it.second }
            return createTranslate(locale, config.strings, config.stringsForEveryLocale).also { translated = config to it }
        }
}
