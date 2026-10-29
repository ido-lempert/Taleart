package site.lempert.taleart.sdk

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import site.lempert.taleart.sdk.analytics.AnalyticsEvent
import site.lempert.taleart.sdk.analytics.AnalyticsEventType
import site.lempert.taleart.sdk.analytics.AnalyticsHub
import site.lempert.taleart.sdk.analytics.AnalyticsSender
import site.lempert.taleart.sdk.analytics.AnalyticsTarget
import site.lempert.taleart.sdk.delivery.DeliveryClient
import site.lempert.taleart.sdk.delivery.HOME_TOP_ZONE_JSON
import site.lempert.taleart.sdk.storage.InMemoryKeyValueStore
import site.lempert.taleart.sdk.ui.TaleartZoneController
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

// The frequency cap and the analytics of a zone read by the controller, against the Delivery fixture
// (the home-top zone with two groups, summer and winter) on a fake API.
class FrequencyCapTest {
    private val api = "http://api.test"
    private val key = "tak_key"
    private val summer = "905ea258-ccfd-4527-9b84-380c5fbe011a"
    private val winter = "48962270-14fe-4563-aa65-470ea8997fa1"

    @AfterTest
    fun resetSdk() {
        TaleartSdk.init(TaleartConfig())
    }

    private class Recording : TaleartListener {
        val events = mutableListOf<TaleartEvent>()
        override fun onLoaded(event: TaleartEvent) { events += event }
        override fun onGroupCapped(event: TaleartEvent) { events += event }
    }

    private class Batches : AnalyticsSender {
        val sent = mutableListOf<List<AnalyticsEvent>>()
        override suspend fun send(target: AnalyticsTarget, events: List<AnalyticsEvent>): Boolean {
            sent += events
            return true
        }
    }

    private fun TestScope.client() = DeliveryClient(
        HttpClient(MockEngine { respond(HOME_TOP_ZONE_JSON, HttpStatusCode.OK, headersOf(HttpHeaders.ContentType, "application/json")) }),
        StandardTestDispatcher(testScheduler),
        visitorStore = { InMemoryKeyValueStore() },
    )

    // The read finishes on the platform's dispatcher, so the test scheduler is drained, then the test
    // waits a moment in real time, until the controller has its answer.
    private suspend fun TestScope.settle(done: () -> Boolean) {
        repeat(200) {
            advanceUntilIdle()
            if (done()) return
            withContext(Dispatchers.Default) { delay(5) }
        }
        advanceUntilIdle()
    }

    private fun TestScope.controller(store: InMemoryKeyValueStore, listener: TaleartListener? = null): TaleartZoneController {
        val controller = TaleartZoneController(client(), backgroundScope)
        controller.frequencyStore = { store }
        controller.listener = listener
        return controller
    }

    @Test
    fun aGroupViewedUnderAOnceCapLeavesTheZoneAndIsReportedOnce() = runTest {
        TaleartSdk.init(TaleartConfig(frequency = FrequencyRule.Once))
        val store = InMemoryKeyValueStore()
        recordFrequencyView(store, summer)
        val recording = Recording()
        val controller = controller(store, recording)
        controller.configure(api, key)
        settle { controller.zone != null }

        assertEquals(listOf(winter), controller.zone?.taleGroups?.map { it.id })
        val capped = recording.events.single { it.name == "groupCapped" }
        assertEquals(summer, capped.group?.id)
        assertEquals(FrequencyRule.Once, capped.rule)
        assertEquals(1, recording.events.count { it.name == "loaded" })
    }

    @Test
    fun aZoneWhoseGroupsAreAllCappedShowsNothing() = runTest {
        TaleartSdk.init(TaleartConfig(frequency = FrequencyRule.Once))
        val store = InMemoryKeyValueStore()
        recordFrequencyView(store, summer)
        recordFrequencyView(store, winter)
        val recording = Recording()
        val controller = controller(store, recording)
        controller.configure(api, key)
        assertFalse(controller.loaded, "not loaded before the read answers")
        settle { recording.events.count { it.name == "groupCapped" } == 2 }

        assertNull(controller.zone)
        assertNull(controller.failure)
        // Loaded with nothing to show: a host draws an empty state, not a spinner, and nothing is an error.
        assertTrue(controller.loaded)
    }

    @Test
    fun withoutAFrequencyOptionNothingIsCapped() = runTest {
        val store = InMemoryKeyValueStore()
        recordFrequencyView(store, summer)
        val recording = Recording()
        val controller = controller(store, recording)
        controller.configure(api, key)
        settle { controller.zone != null }

        assertEquals(2, controller.zone?.taleGroups?.size)
        assertTrue(recording.events.none { it.name == "groupCapped" })
    }

    @Test
    fun aViewOfAZoneQueuesAnAnalyticsEventUnlessAnalyticsAreOff() = runTest {
        val sender = Batches()
        val hub = AnalyticsHub(backgroundScope, sender, observeBackground = {})
        val controller = controller(InMemoryKeyValueStore())
        controller.analyticsHub = hub
        controller.configure(api, key)
        settle { controller.zone != null }
        val group = GroupRef(summer, "Summer", 0)
        val tale = TaleRef("t1", 0, "First")

        controller.trackEvent(AnalyticsEventType.View, group, tale)
        assertEquals(1, hub.queueFor(AnalyticsTarget(api, key))?.pendingCount)

        controller.analytics = false
        controller.trackEvent(AnalyticsEventType.Click, group, tale)
        assertEquals(1, hub.queueFor(AnalyticsTarget(api, key))?.pendingCount)

        controller.analytics = null
        TaleartSdk.init(TaleartConfig(analytics = false))
        controller.trackEvent(AnalyticsEventType.Open, group)
        assertEquals(1, hub.queueFor(AnalyticsTarget(api, key))?.pendingCount)

        controller.analytics = true
        controller.trackEvent(AnalyticsEventType.Open, group)
        assertEquals(2, hub.queueFor(AnalyticsTarget(api, key))?.pendingCount)

        hub.flushAll()
        runCurrent()
        val sent = sender.sent.flatten()
        assertEquals(listOf(AnalyticsEventType.View, AnalyticsEventType.Open), sent.map { it.type })
        assertEquals("t1", sent.first().taleId)
        assertNull(sent.last().taleId)
    }

    @Test
    fun aFailedReadQueuesNothing() = runTest {
        val failing = DeliveryClient(
            HttpClient(MockEngine { respond("", HttpStatusCode.InternalServerError) }),
            StandardTestDispatcher(testScheduler),
            visitorStore = { InMemoryKeyValueStore() },
        )
        val hub = AnalyticsHub(backgroundScope, Batches(), observeBackground = {})
        val controller = TaleartZoneController(failing, backgroundScope)
        controller.analyticsHub = hub
        controller.configure(api, key)
        settle { controller.failure != null }
        controller.trackEvent(AnalyticsEventType.Impression, GroupRef(summer, "Summer", 0))
        assertNull(hub.queueFor(AnalyticsTarget(api, key)))
        assertTrue(controller.failure != null)
    }
}
