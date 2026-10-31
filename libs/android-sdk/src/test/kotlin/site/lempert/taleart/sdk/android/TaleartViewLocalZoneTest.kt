package site.lempert.taleart.sdk.android

import android.os.Looper
import androidx.activity.ComponentActivity
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import site.lempert.taleart.sdk.TaleartEvent
import site.lempert.taleart.sdk.TaleartListener
import site.lempert.taleart.sdk.delivery.DeliveryClient
import site.lempert.taleart.sdk.delivery.ZoneResult
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

// Tales without a backend: TaleartView.zoneJson shows the zone JSON the app holds, with no request.
@RunWith(RobolectricTestRunner::class)
class TaleartViewLocalZoneTest {
    private val requests = mutableListOf<String>()
    private val zone = """{"id":"z","name":"Z","slug":"home-top","frame":{"id":"f","type":"bar","settings":{}},"taleGroups":[
        {"id":"a","name":"A","tales":[]},{"id":"b","name":"B","tags":["vip"],"tales":[]}]}"""

    private fun view(): TaleartView {
        val activity = Robolectric.buildActivity(ComponentActivity::class.java).setup().get()
        return TaleartView(activity).apply {
            client = DeliveryClient(HttpClient(MockEngine { request ->
                requests += request.url.toString()
                respond(zone, HttpStatusCode.OK, headersOf(HttpHeaders.ContentType, "application/json"))
            }))
        }
    }

    private fun idle() = shadowOf(Looper.getMainLooper()).idle()

    @Test
    fun showsTheZoneJsonAndHearsOnLoadedWithoutARequest() {
        val view = view()
        val events = mutableListOf<TaleartEvent>()
        view.listener = object : TaleartListener {
            override fun onLoaded(event: TaleartEvent) { events += event }
        }
        view.zoneJson = zone
        idle()
        assertEquals(listOf("a"), view.controller.zone?.taleGroups?.filter { it.tags.isEmpty() }?.map { it.id })
        assertEquals(2, view.controller.zone?.taleGroups?.size)
        assertEquals(zone, view.zoneJson)
        assertEquals("", events.single().zoneKeyPrefix)
        assertTrue(requests.isEmpty(), "no request to the API")
    }

    @Test
    fun invalidJsonIsAFailedReadNotACrash() {
        val view = view()
        val errors = mutableListOf<ZoneResult.Failure>()
        view.onErrorListener = { errors += it }
        view.zoneJson = "{ nope"
        idle()
        assertNull(view.controller.zone)
        assertEquals(1, errors.size)
        assertTrue(requests.isEmpty())
    }

    @Test
    fun aZoneKeyAfterwardsReadsFromTheApiAgain() {
        val view = view()
        view.zoneJson = zone
        idle()
        view.configure("http://api.test", "tak_key")
        assertNull(view.zoneJson)
        val until = System.currentTimeMillis() + 5_000
        while (requests.isEmpty() && System.currentTimeMillis() < until) {
            idle()
            Thread.sleep(10)
        }
        assertEquals(1, requests.size)
    }

    @Test
    fun nullClearsTheZoneData() {
        val view = view()
        view.zoneJson = zone
        idle()
        view.zoneJson = null
        idle()
        assertNull(view.controller.zone)
        assertTrue(requests.isEmpty())
    }
}
