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
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import site.lempert.taleart.sdk.delivery.DeliveryClient
import site.lempert.taleart.sdk.delivery.ZoneRequest
import site.lempert.taleart.sdk.ui.TaleartZoneController
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

// The hooks (TaleartListener): what they receive, that a throwing one changes nothing, and that
// actionClicked is answered by the listeners. The zone reads go to a fake API.
class TaleartHooksTest {
    private val key = "tak_9f3c2a71b0d4e5f6"
    private val api = "http://api.test"
    private val zoneJson = """{"id":"z1","name":"Home","slug":"home-top","frame":null,"taleGroups":[]}"""

    @AfterTest
    fun resetSdk() {
        TaleartSdk.init(TaleartConfig())
    }

    private fun TestScope.client(requests: MutableList<String>, status: HttpStatusCode = HttpStatusCode.OK, body: String = zoneJson) =
        DeliveryClient(
            HttpClient(MockEngine { request ->
                requests += request.url.toString() + " " + request.headers[HttpHeaders.Authorization]
                respond(body, status, headersOf(HttpHeaders.ContentType, "application/json"))
            }),
            StandardTestDispatcher(testScheduler),
        )

    private class Recording : TaleartListener {
        val events = mutableListOf<TaleartEvent>()
        override fun onLoaded(event: TaleartEvent) { events += event }
        override fun onLoadFailed(event: TaleartEvent) { events += event }
    }

    // The reads finish on the platform's own dispatcher (the engine's body), so the test scheduler is
    // drained, then the test waits a moment in real time, until the controller has its answer.
    private suspend fun TestScope.settle(controller: TaleartZoneController) {
        repeat(200) {
            advanceUntilIdle()
            if (controller.zone != null || controller.failure != null) return
            withContext(Dispatchers.Default) { delay(5) }
        }
        advanceUntilIdle()
    }

    @Test
    fun theZoneReadsByItsKeyWithoutAZoneQuery() = runTest {
        val requests = mutableListOf<String>()
        val controller = TaleartZoneController(client(requests), this)
        controller.configure(api, key)
        settle(controller)
        assertEquals(listOf("$api/delivery/v1/zone Bearer $key"), requests)
    }

    @Test
    fun noEventNamesTheWholeKeyOnlyItsEightCharacterPrefix() = runTest {
        val recording = Recording()
        val controller = TaleartZoneController(client(mutableListOf()), this)
        controller.listener = recording
        controller.configure(api, key)
        settle(controller)
        val loaded = recording.events.single()
        assertEquals("loaded", loaded.name)
        assertEquals("tak_9f3c", loaded.zoneKeyPrefix)
        assertEquals("home-top", loaded.zoneSlug)
        assertFalse(loaded.toString().contains(key), "the full key must not appear in an event")
    }

    @Test
    fun aFailedLoadNamesTheErrorNotTheKey() = runTest {
        val recording = Recording()
        val refused = """{"error":{"code":"invalid_site_key","message":"A valid zone key is required"}}"""
        val controller = TaleartZoneController(client(mutableListOf(), HttpStatusCode.Unauthorized, refused), this)
        controller.listener = recording
        controller.configure(api, key)
        settle(controller)
        val failed = recording.events.single()
        assertEquals("loadFailed", failed.name)
        assertEquals("A valid zone key is required", failed.error)
        assertFalse(failed.toString().contains(key))
    }

    @Test
    fun aThrowingListenerChangesNothingAndTheZoneStillShows() = runTest {
        val throwing = object : TaleartListener {
            override fun onLoaded(event: TaleartEvent): Unit = error("boom")
            override fun onEvent(event: TaleartEvent): Unit = error("boom again")
        }
        val after = Recording()
        TaleartSdk.init(TaleartConfig(listener = after))
        val controller = TaleartZoneController(client(mutableListOf()), this)
        controller.listener = throwing
        controller.configure(api, key)
        settle(controller)
        // The view's listener threw; the SDK's listener still heard the event, and the zone is on screen.
        assertEquals(listOf("loaded"), after.events.map { it.name })
        assertEquals("home-top", controller.zone?.slug)
    }

    @Test
    fun anActionAListenerHandlesIsNotOpenedByTheSdk() {
        val event = TaleartEvent(name = "actionClicked", zoneKeyPrefix = "tak_9f3c", url = "https://shop.example")
        val handling = object : TaleartListener {
            override fun onActionClicked(event: TaleartEvent): Boolean = true
        }
        assertTrue(deliverAction(handling, event))
        assertFalse(deliverAction(null, event), "with no listener the default lets the SDK open the URL")
        assertFalse(deliverAction(object : TaleartListener {}, event), "the default hook answers false")
    }

    @Test
    fun theSdkListenerAnswersWhenTheViewHasNone() {
        val event = TaleartEvent(name = "actionClicked", zoneKeyPrefix = "tak_9f3c", url = "https://shop.example")
        TaleartSdk.init(TaleartConfig(listener = object : TaleartListener {
            override fun onActionClicked(event: TaleartEvent): Boolean = true
        }))
        assertTrue(deliverAction(null, event))
    }

    @Test
    fun aThrowingActionHookLeavesTheDefaultInPlace() {
        val event = TaleartEvent(name = "actionClicked", zoneKeyPrefix = "tak_9f3c", url = "https://shop.example")
        val throwing = object : TaleartListener {
            override fun onActionClicked(event: TaleartEvent): Boolean = error("boom")
        }
        assertFalse(deliverAction(throwing, event))
    }

    @Test
    fun theKeyPrefixIsTheFirstEightCharacters() {
        assertEquals("tak_9f3c", keyPrefix(key))
        assertEquals("tak", keyPrefix("tak"))
    }
}
