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
import site.lempert.taleart.sdk.TaleartEvent
import site.lempert.taleart.sdk.TaleartListener
import site.lempert.taleart.sdk.TaleartSdk
import site.lempert.taleart.sdk.delivery.DeliveryClient
import site.lempert.taleart.sdk.delivery.DeliveryZone
import site.lempert.taleart.sdk.delivery.ZoneRequest
import site.lempert.taleart.sdk.delivery.ZoneResult
import site.lempert.taleart.sdk.deliver
import site.lempert.taleart.sdk.keyPrefix

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

    /** The last read's failure, or null after a success or while inputs are missing. */
    var failure: ZoneResult.Failure? by mutableStateOf(null)
        private set

    /** The view's locale (BCP 47), or null to use the SDK's. */
    var locale: String? by mutableStateOf(null)

    /** The view's texts per locale, added to the SDK's, or null for none. */
    var strings: Map<String, Map<String, String>>? by mutableStateOf(null)

    /** The view's listener: told of this view's events before the SDK's global listener. */
    var listener: TaleartListener? by mutableStateOf(null)

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
        if (changed) this.zone = null
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
            readApiUrl = null
            return
        }
        val api = effectiveApiUrl
        val key = zoneKey
        readApiUrl = api
        load = scope.launch {
            when (val result = client.fetchZone(api, ZoneRequest(key = key))) {
                is ZoneResult.Success -> {
                    zone = result.zone
                    failure = null
                    val event = TaleartEvent(name = "loaded", zoneKeyPrefix = keyPrefix(key), zoneSlug = result.zone.slug)
                    deliver(listener, event) { it.onLoaded(event) }
                }
                is ZoneResult.Failure -> {
                    zone = null
                    failure = result
                    println("TaleArt: ${result.message}")
                    onError?.invoke(result)
                    val event = TaleartEvent(name = "loadFailed", zoneKeyPrefix = keyPrefix(key), error = result.message)
                    deliver(listener, event) { it.onLoadFailed(event) }
                }
            }
        }
    }
}
