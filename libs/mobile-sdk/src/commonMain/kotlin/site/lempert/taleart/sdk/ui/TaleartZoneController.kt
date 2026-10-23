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
import site.lempert.taleart.sdk.TaleartSdk
import site.lempert.taleart.sdk.delivery.DeliveryClient
import site.lempert.taleart.sdk.delivery.DeliveryZone
import site.lempert.taleart.sdk.delivery.ZoneRequest
import site.lempert.taleart.sdk.delivery.ZoneResult

/**
 * A zone named by API URL, site key and slug, and the last zone read for it, kept outside
 * composition: the Android TaleartView and the iOS view controller hold one for their whole life,
 * so a view detached and attached again shows its zone at once, without a new request.
 *
 * It reads the zone once all three inputs are set ([configure]) and again when one changes or on
 * [reload]. Settings made one after another in the same main-thread turn read once. A reload keeps
 * the zone on screen until the new one arrives; a change of input clears it first, since it names
 * another zone. A failed read clears it, as the web element renders nothing then, and is logged
 * once and passed to [onError]. Its state is Compose state.
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

    /** The TaleArt API origin. */
    var apiUrl: String = ""
        private set

    /** The project's site key (`tas_…`). */
    var siteKey: String = ""
        private set

    /** The zone's slug. */
    var zoneSlug: String = ""
        private set

    /** The last zone read for the current inputs, or null while there is none to show. */
    var zone: DeliveryZone? by mutableStateOf(null)
        private set

    /** The last read's failure, or null after a success or while inputs are missing. */
    var failure: ZoneResult.Failure? by mutableStateOf(null)
        private set

    /** Called with each failed read. */
    var onError: ((ZoneResult.Failure) -> Unit)? = null

    /** True once all three inputs are set. */
    val isComplete: Boolean get() = apiUrl.isNotBlank() && siteKey.isNotBlank() && zoneSlug.isNotBlank()

    /** Names the zone to show; reads it when the inputs change. Values are trimmed. */
    fun configure(apiUrl: String, siteKey: String, zone: String) {
        val (u, k, z) = Triple(apiUrl.trim(), siteKey.trim(), zone.trim())
        val changed = u != this.apiUrl || k != this.siteKey || z != zoneSlug
        if (!changed && configured) return
        configured = true
        this.apiUrl = u
        this.siteKey = k
        this.zoneSlug = z
        if (changed) this.zone = null
        start()
    }

    /** Reads the zone again, keeping the current one on screen until the new one arrives. */
    fun reload() = start()

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
            return
        }
        val request = Triple(apiUrl, siteKey, zoneSlug)
        load = scope.launch {
            val result = client.fetchZone(request.first, ZoneRequest(key = request.second, zone = request.third))
            when (result) {
                is ZoneResult.Success -> {
                    zone = result.zone
                    failure = null
                }
                is ZoneResult.Failure -> {
                    zone = null
                    failure = result
                    println("TaleArt: ${result.message}")
                    onError?.invoke(result)
                }
            }
        }
    }
}
