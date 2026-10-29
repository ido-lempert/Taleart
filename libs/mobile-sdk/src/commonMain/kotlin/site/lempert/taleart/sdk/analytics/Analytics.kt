package site.lempert.taleart.sdk.analytics

import kotlin.time.Clock
import kotlin.time.Instant
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import site.lempert.taleart.sdk.TaleartSdk
import site.lempert.taleart.sdk.delivery.DeliveryClient

/** A queue that holds events this long is sent (its timer runs only while the queue is not empty). */
internal const val ANALYTICS_FLUSH_MS = 5_000L

/** A queue that reaches this many events is sent at once. */
internal const val ANALYTICS_FLUSH_AT = 20

/** The most events a queue holds; past it the oldest go first. */
internal const val ANALYTICS_QUEUE_CAP = 200

/** The most events one request carries (`POST /delivery/v1/events`). */
internal const val ANALYTICS_BATCH = 50

/** The event types the Delivery API accepts, named as the Web SDK names them. */
internal enum class AnalyticsEventType(val wire: String, val namesTale: Boolean) {
    Impression("impression", namesTale = false),
    Open("open", namesTale = false),
    View("view", namesTale = true),
    Click("click", namesTale = true),
}

/** Where events go: the API origin and the zone key of the view that saw them. */
internal data class AnalyticsTarget(val apiUrl: String, val key: String)

/** An event as it is sent: its type, its group, its tale for a view or a click, and its UTC time. Nothing else. */
internal data class AnalyticsEvent(
    val type: AnalyticsEventType,
    val groupId: String,
    val taleId: String?,
    val at: String,
)

/** Sends one batch to [target]; true when the API accepted it. Must never throw. */
internal fun interface AnalyticsSender {
    suspend fun send(target: AnalyticsTarget, events: List<AnalyticsEvent>): Boolean
}

/**
 * The body of `POST /delivery/v1/events`: `{ "events": [ { type, groupId, taleId?, at } ] }`. The
 * body has these fields only; `taleId` is left out for an event that names no tale.
 */
internal fun analyticsBody(events: List<AnalyticsEvent>): String = buildJsonObject {
    put("events", buildJsonArray {
        for (event in events) {
            add(buildJsonObject {
                put("type", event.type.wire)
                put("groupId", event.groupId)
                event.taleId?.let { put("taleId", it) }
                put("at", event.at)
            })
        }
    })
}.toString()

/** The time of an event, as ISO 8601 UTC with milliseconds (`2026-10-29T10:00:00.000Z`). */
internal fun analyticsTime(nowMs: Long = Clock.System.now().toEpochMilliseconds()): String =
    Instant.fromEpochMilliseconds(nowMs).toString()

/** Whether an event is sent: the view's own setting when it has one, else the SDK's `analytics` option. */
internal fun analyticsEnabled(viewSetting: Boolean?, configured: Boolean): Boolean = viewSetting ?: configured

/**
 * The queue of one zone (one API origin and zone key), in memory. It is sent when it holds
 * [ANALYTICS_FLUSH_AT] events, [ANALYTICS_FLUSH_MS] after its first queued event, and when the app
 * goes to the background (see [AnalyticsHub]). A batch goes in requests of [ANALYTICS_BATCH] events.
 * A failed send is retried once, after the timer, and then dropped; nothing is reported to the caller.
 *
 * Runs on [scope]'s dispatcher, which must be one thread (the main thread in the app), so [record]
 * and the sends never race.
 */
internal class AnalyticsQueue(
    private val target: AnalyticsTarget,
    private val scope: CoroutineScope,
    private val sender: AnalyticsSender,
) {
    private val items = ArrayList<Pending>()
    private var timer: Job? = null

    /** Queues one event; sends the queue when it reaches [ANALYTICS_FLUSH_AT] events, else arms the timer. */
    fun record(event: AnalyticsEvent) {
        items += Pending(event, attempts = 0)
        trim()
        if (items.size >= ANALYTICS_FLUSH_AT) flush() else arm()
    }

    /** Sends everything queued now, in requests of at most [ANALYTICS_BATCH] events. */
    fun flush() {
        timer?.cancel()
        timer = null
        val batch = items.toList()
        items.clear()
        if (batch.isEmpty()) return
        scope.launch { sendBatch(batch) }
    }

    /** The events waiting to be sent (for tests and the hub). */
    internal val pendingCount: Int get() = items.size

    private fun arm() {
        if (timer != null || items.isEmpty()) return
        timer = scope.launch {
            delay(ANALYTICS_FLUSH_MS)
            timer = null
            flush()
        }
    }

    private suspend fun sendBatch(batch: List<Pending>) {
        for (chunk in batch.chunked(ANALYTICS_BATCH)) {
            val accepted = try {
                sender.send(target, chunk.map { it.event })
            } catch (_: Exception) {
                false
            }
            if (!accepted) requeue(chunk)
        }
    }

    // Puts the events of a failed chunk back once, ahead of the newer ones; those that already failed are dropped.
    private fun requeue(chunk: List<Pending>) {
        val again = chunk.filter { it.attempts == 0 }.map { Pending(it.event, attempts = 1) }
        if (again.isEmpty()) return
        items.addAll(0, again)
        trim()
        arm()
    }

    private fun trim() {
        val excess = items.size - ANALYTICS_QUEUE_CAP
        if (excess > 0) items.subList(0, excess).clear()
    }

    private class Pending(val event: AnalyticsEvent, val attempts: Int)
}

/**
 * The SDK's queues, one per zone, and the background hook that sends them all. [observeBackground]
 * is called once, when the first event is recorded (see `observeAppBackground`).
 */
internal class AnalyticsHub(
    private val scope: CoroutineScope,
    private val sender: AnalyticsSender,
    private val observeBackground: (onBackground: () -> Unit) -> Unit = ::observeAppBackground,
) {
    private val queues = LinkedHashMap<AnalyticsTarget, AnalyticsQueue>()
    private var observing = false

    /** Queues [event] for the zone of [target]. */
    fun record(target: AnalyticsTarget, event: AnalyticsEvent) {
        if (!observing) {
            observing = true
            observeBackground { flushAll() }
        }
        queues.getOrPut(target) { AnalyticsQueue(target, scope, sender) }.record(event)
    }

    /** Sends every queue now (the app is going to the background). */
    fun flushAll() {
        for (queue in queues.values) queue.flush()
    }

    /** The queue of [target], for tests. */
    internal fun queueFor(target: AnalyticsTarget): AnalyticsQueue? = queues[target]
}

/**
 * The SDK's hub: one per process, on the main thread, sending through the shared Delivery client.
 * Nothing is sent until the first event is recorded.
 */
internal val sharedAnalytics: AnalyticsHub by lazy {
    AnalyticsHub(
        scope = CoroutineScope(SupervisorJob() + Dispatchers.Main),
        sender = AnalyticsSender { target, events ->
            TaleartSdk.sharedClient.postAnalytics(target.apiUrl, target.key, analyticsBody(events))
        },
    )
}

/** The events endpoint of the Delivery API at [apiUrl], as `DeliveryClient` posts to it. */
internal fun eventsUrl(apiUrl: String): String = "${apiUrl.trimEnd('/')}/delivery/v1/events"
