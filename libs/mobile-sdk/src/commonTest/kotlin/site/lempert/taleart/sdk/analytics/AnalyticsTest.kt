package site.lempert.taleart.sdk.analytics

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.HttpRequestData
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.TextContent
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import site.lempert.taleart.sdk.delivery.DeliveryClient
import site.lempert.taleart.sdk.delivery.VISITOR_HEADER
import site.lempert.taleart.sdk.storage.InMemoryKeyValueStore
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

// The analytics queue (Web SDK parity: flush every 5 s, at 20 events, in the background, one retry,
// failures silent), the request body (no PII), and the opt-out. Sends go to a recording sender.
class AnalyticsTest {
    private val api = "http://api.test"
    private val target = AnalyticsTarget(api, "tak_key")
    private val at = "2026-10-29T10:00:00.000Z"

    private fun impression(n: Int = 0) = AnalyticsEvent(AnalyticsEventType.Impression, "g$n", null, at)
    private fun view(n: Int = 0) = AnalyticsEvent(AnalyticsEventType.View, "g$n", "t$n", at)

    private class Recording(private val accept: (Int) -> Boolean = { true }) : AnalyticsSender {
        val batches = mutableListOf<List<AnalyticsEvent>>()
        override suspend fun send(target: AnalyticsTarget, events: List<AnalyticsEvent>): Boolean {
            batches += events
            return accept(batches.size)
        }
    }

    @Test
    fun theBodyHasTheEventsWithTheirFieldsAndNothingElse() {
        val body = Json.parseToJsonElement(analyticsBody(listOf(impression(), view()))).jsonObject
        assertEquals(setOf("events"), body.keys)
        val (first, second) = body.getValue("events").jsonArray.map { it.jsonObject }
        assertEquals(setOf("type", "groupId", "at"), first.keys)
        assertEquals("impression", first.getValue("type").jsonPrimitive.content)
        assertEquals(setOf("type", "groupId", "taleId", "at"), second.keys)
        assertEquals("t0", second.getValue("taleId").jsonPrimitive.content)
        assertEquals(at, second.getValue("at").jsonPrimitive.content)
    }

    @Test
    fun theEventsEndpointIsTheDeliveryPathOfTheOrigin() {
        assertEquals("http://api.test/delivery/v1/events", eventsUrl("http://api.test/"))
    }

    @Test
    fun anEventSettingBeatsTheSdkOption() {
        assertTrue(analyticsEnabled(null, configured = true))
        assertFalse(analyticsEnabled(null, configured = false))
        assertFalse(analyticsEnabled(false, configured = true))
        assertTrue(analyticsEnabled(true, configured = false))
    }

    @Test
    fun aQueueIsSentFiveSecondsAfterItsFirstEvent() = runTest {
        val sender = Recording()
        val queue = AnalyticsQueue(target, backgroundScope, sender)
        queue.record(impression())
        runCurrent()
        advanceTimeBy(4_999)
        runCurrent()
        assertTrue(sender.batches.isEmpty())
        advanceTimeBy(1)
        runCurrent()
        assertEquals(listOf(listOf(impression())), sender.batches)
    }

    @Test
    fun aQueueIsSentAtOnceAtTwentyEvents() = runTest {
        val sender = Recording()
        val queue = AnalyticsQueue(target, backgroundScope, sender)
        repeat(19) { queue.record(impression(it)) }
        runCurrent()
        assertTrue(sender.batches.isEmpty())
        queue.record(impression(19))
        runCurrent()
        assertEquals(1, sender.batches.size)
        assertEquals(20, sender.batches.single().size)
    }

    @Test
    fun aFailedBatchIsRetriedOnceAfterTheTimerAndThenDropped() = runTest {
        val sender = Recording(accept = { false })
        val queue = AnalyticsQueue(target, backgroundScope, sender)
        repeat(20) { queue.record(impression(it)) }
        runCurrent()
        assertEquals(1, sender.batches.size)
        advanceTimeBy(5_000)
        runCurrent()
        assertEquals(2, sender.batches.size)
        assertEquals(20, sender.batches[1].size)
        advanceTimeBy(60_000)
        runCurrent()
        assertEquals(2, sender.batches.size)
    }

    @Test
    fun aSenderThatThrowsIsAFailureAndNothingIsThrown() = runTest {
        val sender = AnalyticsSender { _, _ -> throw IllegalStateException("offline") }
        val queue = AnalyticsQueue(target, backgroundScope, sender)
        queue.record(impression())
        advanceTimeBy(5_000)
        runCurrent()
        // The failure is retried once, after the timer; the second failure drops the event.
        assertEquals(1, queue.pendingCount)
        advanceTimeBy(5_000)
        runCurrent()
        assertEquals(0, queue.pendingCount)
    }

    @Test
    fun aHubKeepsOneQueuePerZoneAndSendsEveryQueueWhenTheAppGoesToTheBackground() = runTest {
        val sender = Recording()
        var onBackground: (() -> Unit)? = null
        var observed = 0
        val hub = AnalyticsHub(backgroundScope, sender, observeBackground = { observed++; onBackground = it })
        hub.record(target, impression(0))
        hub.record(AnalyticsTarget(api, "tak_other"), impression(1))
        hub.record(target, impression(2))
        assertEquals(1, observed)
        assertEquals(2, hub.queueFor(target)?.pendingCount)
        onBackground?.invoke()
        runCurrent()
        assertEquals(2, sender.batches.size)
        assertEquals(listOf(impression(0), impression(2)), sender.batches.first { it.size == 2 })
        assertEquals(0, hub.queueFor(target)?.pendingCount)
    }

    @Test
    fun postAnalyticsSendsTheBodyWithTheKeyAndTheVisitorIdOnly() = runTest {
        val requests = mutableListOf<HttpRequestData>()
        val client = DeliveryClient(
            HttpClient(MockEngine { request ->
                requests += request
                respond("", HttpStatusCode.Accepted)
            }),
            StandardTestDispatcher(testScheduler),
            visitorStore = { InMemoryKeyValueStore() },
        )
        val body = analyticsBody(listOf(view()))
        assertTrue(client.postAnalytics(api, "tak_key", body))
        val request = requests.single()
        assertEquals("http://api.test/delivery/v1/events", request.url.toString())
        assertEquals("Bearer tak_key", request.headers[HttpHeaders.Authorization])
        assertNotNull(request.headers[VISITOR_HEADER])
        assertEquals(body, (request.body as TextContent).text)
    }

    @Test
    fun postAnalyticsAnswersFalseForARefusalWithoutThrowing() = runTest {
        val client = DeliveryClient(
            HttpClient(MockEngine { respond("", HttpStatusCode.Unauthorized) }),
            StandardTestDispatcher(testScheduler),
            visitorStore = { InMemoryKeyValueStore() },
        )
        assertFalse(client.postAnalytics(api, "tak_revoked", analyticsBody(listOf(impression()))))
    }
}
