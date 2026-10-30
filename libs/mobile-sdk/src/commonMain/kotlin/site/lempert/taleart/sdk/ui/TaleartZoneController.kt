package site.lempert.taleart.sdk.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import site.lempert.taleart.sdk.FrequencyRule
import site.lempert.taleart.sdk.GroupRef
import site.lempert.taleart.sdk.TaleRef
import site.lempert.taleart.sdk.TaleartEvent
import site.lempert.taleart.sdk.TaleartListener
import site.lempert.taleart.sdk.TaleartSdk
import site.lempert.taleart.sdk.analytics.AnalyticsEvent
import site.lempert.taleart.sdk.analytics.AnalyticsEventType
import site.lempert.taleart.sdk.analytics.AnalyticsHub
import site.lempert.taleart.sdk.analytics.AnalyticsTarget
import site.lempert.taleart.sdk.analytics.analyticsEnabled
import site.lempert.taleart.sdk.analytics.analyticsTime
import site.lempert.taleart.sdk.analytics.sharedAnalytics
import site.lempert.taleart.sdk.cappedGroupIds
import site.lempert.taleart.sdk.delivery.DeliveryClient
import site.lempert.taleart.sdk.delivery.DeliveryZone
import site.lempert.taleart.sdk.delivery.ZoneRequest
import site.lempert.taleart.sdk.delivery.encodeExternalUserIdHeader
import site.lempert.taleart.sdk.targeting.audienceRulePasses
import site.lempert.taleart.sdk.targeting.tagRulePasses
import site.lempert.taleart.sdk.targeting.viewerTagSet
import site.lempert.taleart.sdk.delivery.ZoneResult
import site.lempert.taleart.sdk.deliver
import site.lempert.taleart.sdk.keyPrefix
import site.lempert.taleart.sdk.storage.KeyValueStore
import site.lempert.taleart.sdk.storage.deviceKeyValueStoreOrNull

/**
 * A zone named by its zone key, and the last zone read for it, kept outside composition: the Android
 * TaleartView and the iOS view hold one for their whole life, so a view detached and attached again
 * shows its zone at once, without a new request. It also holds the view's own settings: the API
 * origin (empty means the SDK's [TaleartSdk.config] `apiUrl`), [locale], [strings] and [listener].
 *
 * It reads the zone once the zone key is set and an API origin is known ([configure]), and again
 * when one changes, on [reload], or when the SDK's API origin changes ([refreshApi]). Settings made
 * one after another in the same main-thread turn read once. A reload keeps the zone on screen until
 * the new one arrives; a change of input clears it first, since it names another zone. A failed read
 * clears it, as the web element renders nothing then, and is logged once, passed to [onError] and
 * reported to the listener's `onLoadFailed`; a read that works reports `onLoaded`.
 *
 * A read that works is also checked against the frequency cap (`TaleartConfig.frequency`): groups
 * the viewer has seen enough are left out of the zone, each reported to `onGroupCapped`. Once the zone
 * is read, its impressions, opens, views and clicks are queued for the analytics (see
 * `analytics/Analytics.kt`), unless [analytics] or the SDK's option turns them off.
 *
 * [client] is the process's [TaleartSdk.sharedClient] unless one is given; a client passed in
 * belongs to the caller, who closes it. [scope] runs the reads, by default on the main thread;
 * [close] cancels it when the controller made it.
 */
class TaleartZoneController(
    var client: DeliveryClient = TaleartSdk.sharedClient,
    scope: CoroutineScope? = null,
) {
    private val ownsScope = scope == null
    private val scope = scope ?: CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var load: Job? = null
    private var configured = false
    // The API origin the last read used, to tell when the SDK's own one changed.
    private var readApiUrl: String? = null

    /** The view's API origin as set, empty when it uses the SDK's. */
    var apiUrl: String = ""
        private set

    /** The zone key (`tak_…`) as set. */
    var zoneKey: String = ""
        private set

    /** The zone's slug, as the last read zone names it; empty until a zone is read. */
    val zoneSlug: String get() = zone?.slug.orEmpty()

    /** The last zone read for the current inputs, or null while there is none to show. */
    var zone: DeliveryZone? by mutableStateOf(null)
        private set

    /**
     * True once a read of the current inputs has succeeded, whatever it left to show. With [zone] null, a
     * loaded view has nothing to show (every group capped or left out by targeting, so nothing is drawn),
     * while a view that is not loaded yet is still reading; a host tells the two apart by this.
     */
    var loaded: Boolean by mutableStateOf(false)
        private set

    /** The last read's failure, or null after a success or while inputs are missing. */
    var failure: ZoneResult.Failure? by mutableStateOf(null)
        private set

    /** The view's locale (BCP 47), or null to use the SDK's. */
    var locale: String? by mutableStateOf(null)

    /** The view's texts per locale, added to the SDK's, or null for none. */
    var strings: Map<String, Map<String, String>>? by mutableStateOf(null)

    /** The view's listener: told of this view's events before the SDK's global listener. */
    var listener: TaleartListener? by mutableStateOf(null)

    /** The view's analytics setting, or null to use the SDK's `analytics` option (`taleartAnalytics` on Android). */
    var analytics: Boolean? by mutableStateOf(null)

    /**
     * The view's viewer properties (epic viewer properties), or null to use the SDK's `TaleartConfig.properties`.
     * They replace the SDK's, not merge with them. A change reads the zone again, as the rule is applied to the zone read.
     */
    var properties: Map<String, Any?>? = null
        set(value) {
            field = value
            if (configured) reload()
        }

    /** Where this view's events go: the zone last read successfully, or null while none is shown. */
    private var analyticsTarget: AnalyticsTarget? = null

    /** The device store the frequency cap reads and writes; the SDK's own by default. */
    internal var frequencyStore: () -> KeyValueStore? = ::deviceKeyValueStoreOrNull

    /** The hub the analytics events are queued in; the SDK's own by default (tests set their own). */
    internal var analyticsHub: AnalyticsHub? = null

    /** Called with each failed read. */
    var onError: ((ZoneResult.Failure) -> Unit)? = null

    /** The API origin the view reads from: its own, else the SDK's. */
    val effectiveApiUrl: String get() = apiUrl.ifEmpty { TaleartSdk.config.apiUrl }.trim()

    /** True once an API origin and a zone key are set. */
    val isComplete: Boolean get() = effectiveApiUrl.isNotBlank() && zoneKey.isNotBlank()

    /** Names the zone to show; reads it when the inputs change. Values are trimmed. */
    fun configure(apiUrl: String, zoneKey: String) {
        val (u, k) = apiUrl.trim() to zoneKey.trim()
        val changed = u != this.apiUrl || k != this.zoneKey
        if (!changed && configured) return
        configured = true
        this.apiUrl = u
        this.zoneKey = k
        if (changed) {
            this.zone = null
            loaded = false
        }
        start()
    }

    /** Reads the zone again, keeping the current one on screen until the new one arrives. */
    fun reload() = start()

    /** Reads the zone again when the SDK's API origin changed since it was last read (a view on screen while `init` changes it). */
    fun refreshApi() {
        if (configured && effectiveApiUrl != readApiUrl) start()
    }

    /** Stops a read in progress, and the scope when the controller made it. */
    fun close() {
        load?.cancel()
        if (ownsScope) scope.cancel()
    }

    private fun start() {
        load?.cancel()
        load = null
        if (!isComplete) {
            zone = null
            failure = null
            loaded = false
            analyticsTarget = null
            readApiUrl = null
            return
        }
        val api = effectiveApiUrl
        val key = zoneKey
        readApiUrl = api
        // A new read clears the placeholder of a failed one: it shows again only if this read fails too.
        failure = null
        // The viewer's external user ID travels in its own header, never in the URL (as the Web SDK).
        val externalUserIdHeader = encodeExternalUserIdHeader(TaleartSdk.config.externalUserId)
        load = scope.launch {
            when (val result = client.fetchZone(api, ZoneRequest(key = key), externalUserIdHeader)) {
                is ZoneResult.Success -> {
                    analyticsTarget = AnalyticsTarget(api, key)
                    val event = TaleartEvent(name = "loaded", zoneKeyPrefix = keyPrefix(key), zoneSlug = result.zone.slug)
                    deliver(listener, event) { it.onLoaded(event) }
                    zone = withinFrequency(targeted(result.zone), key)
                    loaded = true
                }
                is ZoneResult.Failure -> {
                    zone = null
                    loaded = false
                    failure = result
                    analyticsTarget = null
                    println("TaleArt: ${result.message}")
                    onError?.invoke(result)
                    val event = TaleartEvent(name = "loadFailed", zoneKeyPrefix = keyPrefix(key), error = result.message)
                    deliver(listener, event) { it.onLoadFailed(event) }
                }
            }
        }
    }

    /**
     * The zone without the groups the viewer's tags or properties leave out (epic targeting R2, epic
     * viewer properties): the tag rule and the audience rule are applied here, as the Web SDK applies
     * them to the zone it read, for bars and banners alike; the tags and properties are never sent.
     * The properties are the view's own, else the SDK's.
     */
    private fun targeted(zone: DeliveryZone): DeliveryZone {
        val tags = viewerTagSet(TaleartSdk.config.tags)
        val properties = this.properties ?: TaleartSdk.config.properties
        return zone.copy(
            taleGroups = zone.taleGroups.filter { tagRulePasses(it.tags, it.tagMatch, tags) && audienceRulePasses(it.audience, properties) },
        )
    }

    /**
     * The zone without the groups the frequency cap has reached, each reported to `onGroupCapped`
     * (once per group per load). Null when every group is capped: the display then shows nothing.
     */
    private fun withinFrequency(zone: DeliveryZone, key: String): DeliveryZone? {
        val rule: FrequencyRule = TaleartSdk.config.frequency ?: return zone
        val capped = cappedGroupIds(frequencyStore(), zone.taleGroups.map { it.id }, rule)
        if (capped.isEmpty()) return zone
        for (group in zone.taleGroups) {
            if (group.id !in capped) continue
            val event = TaleartEvent(
                name = "groupCapped",
                zoneKeyPrefix = keyPrefix(key),
                zoneSlug = zone.slug,
                group = groupRef(zone.taleGroups, group),
                rule = rule,
            )
            deliver(listener, event) { it.onGroupCapped(event) }
        }
        val rest = zone.taleGroups.filter { it.id !in capped }
        if (rest.isEmpty()) return null
        return zone.copy(taleGroups = rest)
    }

    /** Where the zone's content reports its analytics events (see [TaleartTracker]). */
    internal val tracker: TaleartTracker = TaleartTracker { type, group, tale -> trackEvent(type, group, tale) }

    /** Queues one analytics event of the zone on screen, unless analytics are off for this view or the SDK. */
    internal fun trackEvent(type: AnalyticsEventType, group: GroupRef, tale: TaleRef? = null) {
        val target = analyticsTarget ?: return
        if (!analyticsEnabled(analytics, TaleartSdk.config.analytics)) return
        (analyticsHub ?: sharedAnalytics).record(
            target,
            AnalyticsEvent(type = type, groupId = group.id, taleId = if (type.namesTale) tale?.id else null, at = analyticsTime()),
        )
    }
}
