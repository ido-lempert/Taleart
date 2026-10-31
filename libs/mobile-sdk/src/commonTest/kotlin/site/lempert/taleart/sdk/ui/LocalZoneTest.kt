package site.lempert.taleart.sdk.ui

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import site.lempert.taleart.sdk.FrequencyRule
import site.lempert.taleart.sdk.GroupRef
import site.lempert.taleart.sdk.TaleartConfig
import site.lempert.taleart.sdk.TaleartEvent
import site.lempert.taleart.sdk.TaleartListener
import site.lempert.taleart.sdk.TaleartSdk
import site.lempert.taleart.sdk.analytics.AnalyticsEvent
import site.lempert.taleart.sdk.analytics.AnalyticsEventType
import site.lempert.taleart.sdk.analytics.AnalyticsHub
import site.lempert.taleart.sdk.analytics.AnalyticsSender
import site.lempert.taleart.sdk.analytics.AnalyticsTarget
import site.lempert.taleart.sdk.delivery.DeliveryClient
import site.lempert.taleart.sdk.delivery.HOME_TOP_ZONE_JSON
import site.lempert.taleart.sdk.delivery.ZoneParse
import site.lempert.taleart.sdk.delivery.ZoneResult
import site.lempert.taleart.sdk.recordFrequencyView
import site.lempert.taleart.sdk.storage.InMemoryKeyValueStore
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

// Tales without a backend: the zone JSON the app holds is shown by the controller with no request at all,
// and everything that depends on the viewer (tags, properties, frequency) still applies.
class LocalZoneTest {
    private val zone = """{"id":"z1","name":"Home","slug":"home-top","frame":{"id":"f","type":"bar","settings":{}},"taleGroups":[
        {"id":"g-plain","name":"Plain","tags":[],"tagMatch":"any","tales":[]},
        {"id":"g-vip","name":"VIP","tags":["vip"],"tagMatch":"any","tales":[]},
        {"id":"g-pro","name":"Pro","tags":[],"tagMatch":"any","tales":[],"audience":{"match":"all","conditions":[{"property":"plan","operator":"eq","value":"pro"}]}}
    ]}"""

    @AfterTest
    fun resetSdk() {
        TaleartSdk.init(TaleartConfig())
    }

    private class Recording : TaleartListener {
        val events = mutableListOf<TaleartEvent>()
        override fun onLoaded(event: TaleartEvent) { events += event }
        override fun onLoadFailed(event: TaleartEvent) { events += event }
        override fun onGroupCapped(event: TaleartEvent) { events += event }
    }

    private class Batches : AnalyticsSender {
        val sent = mutableListOf<AnalyticsEvent>()
        override suspend fun send(target: AnalyticsTarget, events: List<AnalyticsEvent>): Boolean {
            sent += events
            return true
        }
    }

    // A client that counts every request it is asked to make.
    private fun TestScope.client(requests: MutableList<String>) = DeliveryClient(
        HttpClient(MockEngine { request ->
            requests += request.url.toString()
            respond(HOME_TOP_ZONE_JSON, HttpStatusCode.OK, headersOf(HttpHeaders.ContentType, "application/json"))
        }),
        StandardTestDispatcher(testScheduler),
        visitorStore = { InMemoryKeyValueStore() },
    )

    private fun TestScope.local(requests: MutableList<String>, json: String = zone): TaleartZoneController {
        val controller = TaleartZoneController(client(requests), this)
        controller.frequencyStore = { InMemoryKeyValueStore() }
        controller.configureLocalJson(json)
        advanceUntilIdle()
        return controller
    }

    @Test
    fun theZoneJsonIsShownWithoutAnyRequest() = runTest {
        val requests = mutableListOf<String>()
        val controller = local(requests)
        assertEquals(listOf("g-plain", "g-vip", "g-pro"), controller.zone!!.taleGroups.map { it.id })
        assertTrue(controller.loaded)
        assertTrue(controller.isLocal)
        assertNull(controller.failure)
        assertTrue(requests.isEmpty(), "no request to the API")
        controller.close()
    }

    @Test
    fun aZoneObjectIsShownAsTheJsonIs() = runTest {
        val requests = mutableListOf<String>()
        val controller = TaleartZoneController(client(requests), this)
        controller.configureLocal((TaleartSdk.parseZoneJson(zone) as ZoneParse.Success).zone)
        advanceUntilIdle()
        assertEquals(3, controller.zone!!.taleGroups.size)
        assertTrue(requests.isEmpty())
        controller.close()
    }

    @Test
    fun theRealDeliveryResponseIsShownAsItIs() = runTest {
        val requests = mutableListOf<String>()
        val controller = local(requests, HOME_TOP_ZONE_JSON)
        assertEquals("home-top", controller.zoneSlug)
        assertEquals(2, controller.zone!!.taleGroups.size)
        controller.close()
    }

    @Test
    fun onLoadedFiresWithAnEmptyKeyPrefix() = runTest {
        val controller = TaleartZoneController(client(mutableListOf()), this)
        val recording = Recording()
        controller.listener = recording
        controller.configureLocalJson(zone)
        advanceUntilIdle()
        val loaded = recording.events.single()
        assertEquals("loaded", loaded.name)
        assertEquals("", loaded.zoneKeyPrefix)
        assertEquals("home-top", loaded.zoneSlug)
        controller.close()
    }

    @Test
    fun aListenerSetAfterTheZoneStillHearsOnLoaded() = runTest {
        val controller = TaleartZoneController(client(mutableListOf()), this)
        controller.configureLocalJson(zone)
        val recording = Recording()
        controller.listener = recording
        advanceUntilIdle()
        assertEquals(listOf("loaded"), recording.events.map { it.name })
        controller.close()
    }

    @Test
    fun invalidJsonIsAFailedReadLoggedOnceAndNeverACrash() = runTest {
        val requests = mutableListOf<String>()
        val controller = TaleartZoneController(client(requests), this)
        val recording = Recording()
        val errors = mutableListOf<ZoneResult.Failure>()
        controller.listener = recording
        controller.onError = { errors += it }
        controller.configureLocalJson("{ this is not json")
        advanceUntilIdle()
        assertNull(controller.zone)
        assertTrue(!controller.loaded)
        assertIs<ZoneResult.InvalidResponse>(controller.failure)
        assertEquals(1, errors.size)
        assertTrue(errors.single().message.contains("Not valid JSON"))
        val failed = recording.events.single()
        assertEquals("loadFailed", failed.name)
        assertEquals("", failed.zoneKeyPrefix)
        assertTrue(requests.isEmpty())
        controller.close()
    }

    @Test
    fun jsonThatIsNoZoneFailsTheSameWay() = runTest {
        for (bad in listOf("", "[]", "\"x\"", """{"frame":null}""", """{"frame":null,"taleGroups":[{"tales":{}}]}""")) {
            val controller = local(mutableListOf(), bad)
            assertNull(controller.zone, bad)
            assertTrue(controller.failure != null, bad)
            controller.close()
        }
    }

    @Test
    fun parseZoneJsonListsEveryProblemReadably() {
        val failure = TaleartSdk.parseZoneJson("""{"frame":5,"taleGroups":[{"tales":[]},7,{"id":"g"}]}""") as ZoneParse.Failure
        assertEquals(
            listOf("\"frame\" must be an object or null", "taleGroups[1] must be an object", "taleGroups[2].tales must be a list"),
            failure.errors,
        )
        assertTrue(failure.message.startsWith("The zone JSON is not valid: "))
        assertEquals(listOf("\"frame\" is missing (an object, or null for a zone without a display)", "\"taleGroups\" is missing (a list of tale groups)"),
            (TaleartSdk.parseZoneJson("{}") as ZoneParse.Failure).errors)
        assertEquals(listOf("The zone JSON is empty"), (TaleartSdk.parseZoneJson("  ") as ZoneParse.Failure).errors)
        assertTrue((TaleartSdk.parseZoneJson("{nope") as ZoneParse.Failure).errors.single().startsWith("Not valid JSON"))
        assertEquals(listOf("The zone must be a JSON object (the body of GET /delivery/v1/zone)"), (TaleartSdk.parseZoneJson("[1]") as ZoneParse.Failure).errors)
    }

    @Test
    fun parseZoneJsonReadsAZoneAsTheDeliveryClientDoes() {
        val parsed = TaleartSdk.parseZoneJson(zone) as ZoneParse.Success
        assertEquals("home-top", parsed.zone.slug)
        assertEquals("bar", parsed.zone.frame?.type)
        assertEquals(listOf("vip"), parsed.zone.taleGroups[1].tags)
        assertTrue(TaleartSdk.parseZoneJson("""{"frame":null,"taleGroups":[]}""") is ZoneParse.Success)
    }

    @Test
    fun tagsAndPropertiesStillLeaveOutGroups() = runTest {
        TaleartSdk.init(TaleartConfig(tags = listOf("VIP"), properties = mapOf("plan" to "free")))
        val controller = local(mutableListOf())
        assertEquals(listOf("g-plain", "g-vip"), controller.zone!!.taleGroups.map { it.id })
        controller.properties = mapOf("plan" to "pro")
        advanceUntilIdle()
        assertEquals(listOf("g-plain", "g-vip", "g-pro"), controller.zone!!.taleGroups.map { it.id })
        controller.close()
    }

    @Test
    fun theFrequencyCapStillAppliesAndReportsCappedGroups() = runTest {
        TaleartSdk.init(TaleartConfig(frequency = FrequencyRule.Once))
        val store = InMemoryKeyValueStore()
        recordFrequencyView(store, "g-plain")
        val controller = TaleartZoneController(client(mutableListOf()), this)
        controller.frequencyStore = { store }
        val recording = Recording()
        controller.listener = recording
        controller.configureLocalJson(zone)
        advanceUntilIdle()
        assertEquals(listOf("g-vip", "g-pro"), controller.zone!!.taleGroups.map { it.id })
        assertEquals("g-plain", recording.events.single { it.name == "groupCapped" }.group?.id)
        controller.close()
    }

    @Test
    fun aZoneWhoseGroupsAreAllCappedShowsNothingButIsLoaded() = runTest {
        TaleartSdk.init(TaleartConfig(frequency = FrequencyRule.Once))
        val store = InMemoryKeyValueStore()
        listOf("g-plain", "g-vip", "g-pro").forEach { recordFrequencyView(store, it) }
        val controller = TaleartZoneController(client(mutableListOf()), this)
        controller.frequencyStore = { store }
        controller.configureLocalJson(zone)
        advanceUntilIdle()
        assertNull(controller.zone)
        assertTrue(controller.loaded)
        assertNull(controller.failure)
        controller.close()
    }

    @Test
    fun noAnalyticsAreQueuedOrSent() = runTest {
        val sender = Batches()
        val hub = AnalyticsHub(backgroundScope, sender, observeBackground = {})
        val controller = TaleartZoneController(client(mutableListOf()), this)
        controller.analyticsHub = hub
        controller.analytics = true
        controller.configureLocalJson(zone)
        advanceUntilIdle()
        controller.trackEvent(AnalyticsEventType.Impression, GroupRef("g-plain", "Plain", 0))
        hub.flushAll()
        runCurrent()
        assertTrue(sender.sent.isEmpty())
        controller.close()
    }

    @Test
    fun newJsonReplacesTheZoneAndAnInvalidOneClearsIt() = runTest {
        val controller = local(mutableListOf())
        controller.configureLocalJson("""{"id":"z2","name":"B","slug":"b","frame":null,"taleGroups":[]}""")
        advanceUntilIdle()
        assertEquals("b", controller.zoneSlug)
        controller.configureLocalJson("oops")
        advanceUntilIdle()
        assertNull(controller.zone)
        assertTrue(controller.failure != null)
        controller.configureLocalJson(zone)
        advanceUntilIdle()
        assertNull(controller.failure)
        assertEquals(3, controller.zone!!.taleGroups.size)
        controller.close()
    }

    @Test
    fun reloadAndSdkApiChangesStayLocal() = runTest {
        val requests = mutableListOf<String>()
        val controller = local(requests)
        controller.reload()
        TaleartSdk.init(TaleartConfig(apiUrl = "http://api.test"))
        controller.refreshApi()
        advanceUntilIdle()
        assertEquals(3, controller.zone!!.taleGroups.size)
        assertTrue(requests.isEmpty())
        controller.close()
    }
}
