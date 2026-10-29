package site.lempert.taleart.sdk.delivery

import android.content.Context
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.HttpRequestData
import io.ktor.http.HttpHeaders
import io.ktor.http.headersOf
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import site.lempert.taleart.sdk.TaleartSdk
import site.lempert.taleart.sdk.storage.SDK_PREFERENCES
import site.lempert.taleart.sdk.storage.deviceKeyValueStoreOrNull
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull

// Story 8.23 review: on Android the persisted visitor id is available before any composable runs.
@RunWith(RobolectricTestRunner::class)
class AndroidVisitorIdTest {
    private val stored = "3f2b8c1e-5d4a-4e6b-9c7d-0a1b2c3d4e5f"

    private fun context(): Context = RuntimeEnvironment.getApplication().also {
        it.getSharedPreferences(SDK_PREFERENCES, Context.MODE_PRIVATE).edit().putString(VISITOR_STORAGE_KEY, stored).commit()
    }

    @Test
    fun aClientMadeWithAContextSendsTheStoredId() = runTest {
        val requests = mutableListOf<HttpRequestData>()
        val engine = MockEngine { request ->
            requests += request
            respond(HOME_TOP_ZONE_JSON, headers = headersOf(HttpHeaders.ContentType, "application/json"))
        }
        val client = DeliveryClient(context(), HttpClient(engine), StandardTestDispatcher(testScheduler))
        client.fetchZone("http://localhost:3592", ZoneRequest("tak_a"))
        assertEquals(stored, requests.single().headers[VISITOR_HEADER])
    }

    @Test
    fun initOpensTheDeviceStoreForClientsWithoutOne() = runTest {
        TaleartSdk.init(context())
        val store = assertNotNull(deviceKeyValueStoreOrNull())
        assertEquals(stored, store.get(VISITOR_STORAGE_KEY))
        val requests = mutableListOf<HttpRequestData>()
        val engine = MockEngine { request ->
            requests += request
            respond(HOME_TOP_ZONE_JSON, headers = headersOf(HttpHeaders.ContentType, "application/json"))
        }
        // The default store, as TaleartSdk.sharedClient uses.
        DeliveryClient(HttpClient(engine), StandardTestDispatcher(testScheduler))
            .fetchZone("http://localhost:3592", ZoneRequest("tak_a"))
        assertEquals(stored, requests.single().headers[VISITOR_HEADER])
    }
}
