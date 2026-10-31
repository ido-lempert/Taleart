package site.lempert.taleart.taller

import site.lempert.taleart.sdk.FallbackMode
import site.lempert.taleart.sdk.FrequencyRule
import site.lempert.taleart.sdk.delivery.DeliveryZone
import site.lempert.taleart.sdk.storage.InMemoryKeyValueStore
import site.lempert.taleart.sdk.ui.BannerVariant
import site.lempert.taleart.sdk.ui.BarLayout
import kotlinx.serialization.json.JsonArray
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
 * is drawn in), and `taller.pollView` (`sticker`, `embed`, `this-or-that`, `grid` or `inline`: the view every poll of the
 * zone's tales is drawn in, whatever the document's own `view`). An unset key keeps the SDK's default.
 *
 * `taller.noBackend` (`true`) shows [NO_BACKEND_ZONE_JSON], zone JSON held in the app, with no API URL, key or request at all
 * (`TaleartZoneController.configureLocalJson`); the settings screen is skipped.
 *
 * `taller.zoneOnly` (`true`) shows only the zone on a plain page: no title, Settings, Reload line, group list or spinner,
 * as the Web SDK's bare sample page does, so a screenshot or a clip frames the SDK's own output. The timed actions act on
 * the screen without a tap, so a clip needs no finger: [DebugAction]s run in this order, each [autoDelayMs] (default 700 ms)
 * after the one before, the first that long after the zone is shown: `taller.autoOpenItem=<index>` (opens the zone's
 * item at that index, as a tap does), `taller.autoVote=<index>` (the choice at that index of the poll or quiz on the
 * tale), `taller.autoPress=<index>` (the emoji at that index of a reaction), `taller.autoCopy=true` (the promo code's
 * Copy) and `taller.autoSwipeNext=true` (the viewer's Next tale, which at the last tale of a group goes on to the next group).
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
    val pollView: String? = null,
    val zoneOnly: Boolean = false,
    val autoOpenItem: Int? = null,
    val autoVote: Int? = null,
    val autoPress: Int? = null,
    val autoCopy: Boolean = false,
    val autoSwipeNext: Boolean = false,
    val autoDelayMs: Long = DEFAULT_AUTO_DELAY_MS,
    val noBackend: Boolean = false,
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
        const val POLL_VIEW = "taller.pollView"
        const val ZONE_ONLY = "taller.zoneOnly"
        const val AUTO_OPEN_ITEM = "taller.autoOpenItem"
        const val AUTO_VOTE = "taller.autoVote"
        const val AUTO_PRESS = "taller.autoPress"
        const val AUTO_COPY = "taller.autoCopy"
        const val AUTO_SWIPE_NEXT = "taller.autoSwipeNext"
        const val AUTO_DELAY_MS = "taller.autoDelayMs"
        const val NO_BACKEND = "taller.noBackend"

        /** The wait before each timed action, in milliseconds, when `taller.autoDelayMs` is not set. */
        const val DEFAULT_AUTO_DELAY_MS = 700L

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
                pollView = read(POLL_VIEW)?.let(::pollViewNamed),
                zoneOnly = read(ZONE_ONLY).isTrue(),
                autoOpenItem = read(AUTO_OPEN_ITEM)?.toIntOrNull()?.takeIf { it >= 0 },
                autoVote = read(AUTO_VOTE)?.toIntOrNull()?.takeIf { it >= 0 },
                autoPress = read(AUTO_PRESS)?.toIntOrNull()?.takeIf { it >= 0 },
                autoCopy = read(AUTO_COPY).isTrue(),
                autoSwipeNext = read(AUTO_SWIPE_NEXT).isTrue(),
                noBackend = read(NO_BACKEND).isTrue(),
                autoDelayMs = read(AUTO_DELAY_MS)?.toLongOrNull()?.coerceIn(0L, 60_000L) ?: DEFAULT_AUTO_DELAY_MS,
            )
        }
    }
}

private fun String?.isTrue(): Boolean = this?.lowercase() == "true"

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

/** The poll views the poll element's `view` prop names (`poll.schema.json`). */
val POLL_VIEWS = listOf("sticker", "embed", "this-or-that", "grid", "inline")

/** A poll view as the debug option names it (any case); null for anything else. */
fun pollViewNamed(value: String): String? = POLL_VIEWS.firstOrNull { it == value.trim().lowercase() }

/**
 * The zone with every poll of its tales drawn in [view]: the `view` prop of each poll element replaced, the rest of the
 * document as delivered. A zone without a poll is returned as it is.
 */
fun DeliveryZone.withPollView(view: String): DeliveryZone {
    var changed = false
    val groups = taleGroups.map { group ->
        val tales = group.tales.map { tale ->
            val document = tale.document as? JsonObject ?: return@map tale
            val elements = document["elements"] as? JsonArray ?: return@map tale
            var touched = false
            val shown = elements.map { element ->
                val o = element as? JsonObject ?: return@map element
                if ((o["type"] as? JsonPrimitive)?.content != "poll") return@map element
                touched = true
                val props = (o["props"] as? JsonObject).orEmpty() + ("view" to JsonPrimitive(view))
                JsonObject(o + ("props" to JsonObject(props)))
            }
            if (!touched) return@map tale
            changed = true
            tale.copy(document = JsonObject(document + ("elements" to JsonArray(shown))))
        }
        group.copy(tales = tales)
    }
    return if (changed) copy(taleGroups = groups) else this
}

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
 * The zone as the debug options draw it: its bar in [TallerDebugOptions.barLayout], its banner in
 * [TallerDebugOptions.bannerVariant] and its polls in [TallerDebugOptions.pollView], each when set; a zone of none is returned as it is.
 */
fun TallerDebugOptions.drawn(zone: DeliveryZone): DeliveryZone {
    var shown = zone
    barLayout?.let { shown = shown.withBarLayout(it) }
    bannerVariant?.let { shown = shown.withBannerVariant(it) }
    pollView?.let { shown = shown.withPollView(it) }
    return shown
}

/** Whether these options change the zone as [drawn] draws it: a bar layout, a banner variant or a poll view is set. */
val TallerDebugOptions.redrawsZone: Boolean get() = barLayout != null || bannerVariant != null || pollView != null
