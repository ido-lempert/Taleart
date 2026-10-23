package site.lempert.taleart.sdk.delivery

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.HttpRequestData
import io.ktor.http.HttpHeaders
import io.ktor.http.headersOf
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import site.lempert.taleart.sdk.storage.InMemoryKeyValueStore
import site.lempert.taleart.sdk.storage.KeyValueStore
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

// The device's visitor id (epic UX rework 8.23): made once, kept in the SDK's store, sent on every request.
class VisitorIdTest {
    private val api = "http://localhost:3592"
    private val requests = mutableListOf<HttpRequestData>()

    private fun TestScope.client(store: () -> KeyValueStore?): DeliveryClient {
        val engine = MockEngine { request ->
            requests += request
            respond(HOME_TOP_ZONE_JSON, headers = headersOf(HttpHeaders.ContentType, "application/json"))
        }
        return DeliveryClient(HttpClient(engine), StandardTestDispatcher(testScheduler), store)
    }

    private fun visitorOf(request: HttpRequestData): String = request.headers[VISITOR_HEADER] ?: error("no visitor id sent")

    @Test
    fun makesAUuidV4FromSecureRandom() {
        val ids = List(50) { newVisitorId() }.toSet()
        assertEquals(50, ids.size)
        for (id in ids) assertTrue(isVisitorId(id), id)
    }

    @Test
    fun sendsTheSameStoredIdOnEveryRequestAndAfterARestart() = runTest {
        val store = InMemoryKeyValueStore()
        val first = client { store }
        first.fetchZone(api, ZoneRequest("tas_a", "home-top"))
        first.fetchZone(api, ZoneRequest("tas_b", "home-promo"))
        val id = visitorOf(requests.first())
        assertTrue(isVisitorId(id), id)
        assertEquals(id, store.get(VISITOR_STORAGE_KEY))
        // An app restart: a new client on the same device store sends the same id.
        client { store }.fetchZone(api, ZoneRequest("tas_a", "home-top"))
        assertEquals(listOf(id, id, id), requests.map(::visitorOf))
    }

    @Test
    fun readsAnIdAlreadyOnTheDeviceAndReplacesOneThatIsNotAUuidV4() = runTest {
        val kept = "3f2b8c1e-5d4a-4e6b-9c7d-0a1b2c3d4e5f"
        client { InMemoryKeyValueStore(mapOf(VISITOR_STORAGE_KEY to kept)) }.fetchZone(api, ZoneRequest("tas_a", "home-top"))
        assertEquals(kept, visitorOf(requests.last()))
        val tampered = InMemoryKeyValueStore(mapOf(VISITOR_STORAGE_KEY to "tampered"))
        client { tampered }.fetchZone(api, ZoneRequest("tas_a", "home-top"))
        val made = visitorOf(requests.last())
        assertTrue(isVisitorId(made), made)
        assertEquals(made, tampered.get(VISITOR_STORAGE_KEY))
    }

    @Test
    fun keepsOneIdPerProcessWithoutAStoreAndKeepsItOnceOneIsThere() = runTest {
        var store: KeyValueStore? = null
        val client = client { store }
        client.fetchZone(api, ZoneRequest("tas_a", "home-top"))
        client.fetchZone(api, ZoneRequest("tas_a", "home-promo"))
        val id = visitorOf(requests.first())
        assertEquals(id, visitorOf(requests.last()))
        val device = InMemoryKeyValueStore()
        store = device
        client.fetchZone(api, ZoneRequest("tas_a", "home-top"))
        assertEquals(id, visitorOf(requests.last()))
        assertEquals(id, device.get(VISITOR_STORAGE_KEY))
    }

    @Test
    fun keepsOneIdPerProcessWhenTheStoreFails() = runTest {
        val broken = object : KeyValueStore {
            override fun get(key: String): String? = throw IllegalStateException("locked")
            override fun set(key: String, value: String) = throw IllegalStateException("locked")
        }
        val client = client { broken }
        client.fetchZone(api, ZoneRequest("tas_a", "home-top"))
        client.fetchZone(api, ZoneRequest("tas_a", "home-promo"))
        val ids = requests.map(::visitorOf)
        assertTrue(isVisitorId(ids[0]), ids[0])
        assertEquals(ids[0], ids[1])
        // Another process (a new client) gets another id: nothing was kept.
        client { broken }.fetchZone(api, ZoneRequest("tas_a", "home-top"))
        assertNotEquals(ids[0], visitorOf(requests.last()))
    }
}
