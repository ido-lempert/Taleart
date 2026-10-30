package site.lempert.taleart.taller

import site.lempert.taleart.sdk.FallbackMode
import site.lempert.taleart.sdk.FrequencyRule
import site.lempert.taleart.sdk.delivery.DeliveryZone
import site.lempert.taleart.sdk.storage.InMemoryKeyValueStore
import site.lempert.taleart.sdk.ui.BannerVariant
import site.lempert.taleart.sdk.ui.BarLayout
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** The SDK's key-value storage on the device: SharedPreferences on Android, NSUserDefaults on iOS. */
typealias KeyValueStore = site.lempert.taleart.sdk.storage.KeyValueStore

/** A store kept in memory only, for previews and tests. */
typealias InMemoryStore = InMemoryKeyValueStore

/**
 * The API URL the debug settings start with: the host machine as the Android emulator
 * (10.0.2.2) or the iOS simulator (localhost) reaches it, on the API's default port.
 */
expect fun defaultApiUrl(): String

/** The API's default port (apps/api, PORT). */
const val DEFAULT_API_PORT = 3333

/** The zone Taller reads: the API URL and the zone's key (`tak_…`, issued in the dashboard). */
data class DebugSettings(val apiUrl: String, val zoneKey: String) {
    /** True when both fields are set, as the Web SDK waits until both are. */
    val complete: Boolean get() = apiUrl.isNotBlank() && zoneKey.isNotBlank()

    fun save(store: KeyValueStore) {
        store.set(API_URL, apiUrl.trim())
        store.set(ZONE_KEY, zoneKey.trim())
    }

    companion object {
        const val API_URL = "taller.apiUrl"
        const val ZONE_KEY = "taller.zoneKey"

        fun load(store: KeyValueStore): DebugSettings = DebugSettings(
            apiUrl = store.get(API_URL)?.takeIf { it.isNotBlank() } ?: defaultApiUrl(),
            zoneKey = store.get(ZONE_KEY).orEmpty(),
        )
    }
}

/**
 * Debug options that pick the state the app opens in, so the same screens can be shot on both platforms
 * without taps (the docs' screenshots). They are read from the same store as the settings, under `taller.*`
 * keys (Android also takes them as launch Intent extras, which win): `taller.autoOpenGroup` (the index of
 * the group the viewer opens on at start), `taller.autoOpenTale` (the tale in it, from 0), `taller.fallback`
 * (`none` or `message`), `taller.frequency` (see [frequencyRule]), `taller.locale` (the SDK's locale, BCP 47),
 * `taller.layoutDirection` (`ltr` or `rtl`, `TaleartConfig.layoutDirection`) and `taller.barLayout` (`ring`, `chip`,
 * `poster` or `stack`: the bar layout the zone's bar is drawn in, whatever the zone's own setting) and
 * `taller.bannerVariant` (`carousel`, `coverflow`, `peek`, `deck`, `sticky` or `strip`: the variant the zone's banner
 * is drawn in). An unset key keeps the SDK's default.
 */
data class TallerDebugOptions(
    val autoOpenGroup: Int? = null,
    val autoOpenTale: Int = 0,
    val fallback: FallbackMode = FallbackMode.None,
    val frequency: FrequencyRule? = null,
    val locale: String = "",
    val layoutDirection: String? = null,
    val barLayout: BarLayout? = null,
    val bannerVariant: BannerVariant? = null,
) {
    companion object {
        const val AUTO_OPEN_GROUP = "taller.autoOpenGroup"
        const val AUTO_OPEN_TALE = "taller.autoOpenTale"
        const val FALLBACK = "taller.fallback"
        const val FREQUENCY = "taller.frequency"
        const val LOCALE = "taller.locale"
        const val LAYOUT_DIRECTION = "taller.layoutDirection"
        const val BAR_LAYOUT = "taller.barLayout"
        const val BANNER_VARIANT = "taller.bannerVariant"

        fun load(store: KeyValueStore, extras: Map<String, String> = emptyMap()): TallerDebugOptions {
            fun read(key: String): String? = (extras[key] ?: store.get(key))?.trim()?.takeIf { it.isNotEmpty() }
            return TallerDebugOptions(
                autoOpenGroup = read(AUTO_OPEN_GROUP)?.toIntOrNull(),
                autoOpenTale = read(AUTO_OPEN_TALE)?.toIntOrNull() ?: 0,
                fallback = if (read(FALLBACK)?.lowercase() == "message") FallbackMode.Message else FallbackMode.None,
                frequency = read(FREQUENCY)?.let(::frequencyRule),
                locale = read(LOCALE).orEmpty(),
                layoutDirection = read(LAYOUT_DIRECTION)?.lowercase(),
                barLayout = read(BAR_LAYOUT)?.let(::barLayoutNamed),
                bannerVariant = read(BANNER_VARIANT)?.let(::bannerVariantNamed),
            )
        }
    }
}

/** A frequency cap as the debug option names it: `once`, `daily`, `weekly` or a view count from 1 to 50; null for `none` or anything else. */
fun frequencyRule(value: String): FrequencyRule? = when (value.trim().lowercase()) {
    "once" -> FrequencyRule.Once
    "daily" -> FrequencyRule.Daily
    "weekly" -> FrequencyRule.Weekly
    else -> value.trim().toIntOrNull()?.takeIf { it in 1..50 }?.let { FrequencyRule.Count(it) }
}

/** A bar layout as the debug option names it (`ring`, `chip`, `poster` or `stack`, any case); null for anything else. */
fun barLayoutNamed(value: String): BarLayout? = BarLayout.entries.firstOrNull { it.key == value.trim().lowercase() }

/** A banner variant as the debug option names it (`carousel`, `coverflow`, `peek`, `deck`, `sticky` or `strip`, any case); null for anything else. */
fun bannerVariantNamed(value: String): BannerVariant? = BannerVariant.entries.firstOrNull { it.key == value.trim().lowercase() }

/**
 * The zone with its bar drawn in [layout]: the frame's `layout` setting replaced, the rest of the zone as delivered.
 * A zone without a bar frame is returned as it is.
 */
fun DeliveryZone.withBarLayout(layout: BarLayout): DeliveryZone {
    val frame = frame ?: return this
    if (frame.type != "bar") return this
    val settings = (frame.settings as? JsonObject).orEmpty() + ("layout" to JsonPrimitive(layout.key))
    return copy(frame = frame.copy(settings = JsonObject(settings)))
}

/**
 * The zone with its banner drawn in [variant]: the frame's `variant` setting replaced, the rest of the zone as delivered.
 * A zone without a banner frame is returned as it is.
 */
fun DeliveryZone.withBannerVariant(variant: BannerVariant): DeliveryZone {
    val frame = frame ?: return this
    if (frame.type != "banner") return this
    val settings = (frame.settings as? JsonObject).orEmpty() + ("variant" to JsonPrimitive(variant.key))
    return copy(frame = frame.copy(settings = JsonObject(settings)))
}

/**
 * The zone as the debug options draw it: its bar in [TallerDebugOptions.barLayout] and its banner in
 * [TallerDebugOptions.bannerVariant], each when set; a zone of neither kind is returned as it is.
 */
fun TallerDebugOptions.drawn(zone: DeliveryZone): DeliveryZone {
    var shown = zone
    barLayout?.let { shown = shown.withBarLayout(it) }
    bannerVariant?.let { shown = shown.withBannerVariant(it) }
    return shown
}
