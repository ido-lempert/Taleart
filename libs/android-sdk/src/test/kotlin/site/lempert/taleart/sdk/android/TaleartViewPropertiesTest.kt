package site.lempert.taleart.sdk.android

import androidx.activity.ComponentActivity
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.MockRequestHandleScope
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.HttpRequestData
import io.ktor.client.request.HttpResponseData
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import android.os.Looper
import site.lempert.taleart.sdk.delivery.DeliveryClient
import kotlin.test.assertEquals
import kotlin.test.assertFalse

// The wrapper's viewer properties (TaleartConfig.properties, set on the SDK): a TaleartView shows the groups
// the properties pass, as its tags decide them; the properties are never sent. Its own class, as the SDK's
// configuration is process-wide and shared by the view tests.
@RunWith(RobolectricTestRunner::class)
class TaleartViewPropertiesTest {
    private val requests = mutableListOf<HttpRequestData>()

    private fun MockRequestHandleScope.json(body: String, status: HttpStatusCode = HttpStatusCode.OK) =
        respond(body, status, headersOf(HttpHeaders.ContentType, "application/json"))

    private fun client(handler: suspend MockRequestHandleScope.(HttpRequestData) -> HttpResponseData) =
        DeliveryClient(HttpClient(MockEngine { request ->
            requests += request
            handler(request)
        }))

    private fun waitFor(what: String, condition: () -> Boolean) {
        val until = System.currentTimeMillis() + 5_000
        while (true) {
            shadowOf(Looper.getMainLooper()).idle()
            if (condition()) return
            check(System.currentTimeMillis() < until) { "Timed out waiting for $what" }
            Thread.sleep(10)
        }
    }

    // The viewer's properties (TaleartConfig.properties, set on the SDK) decide the groups a view shows,
    // as its tags do; a rule that does not pass is left out on the device, the properties are not sent.
    @Test
    fun showsTheGroupsTheViewersPropertiesPassAndTheSdksAreReplacedByTheViewsOwn() {
        val activity = Robolectric.buildActivity(ComponentActivity::class.java).setup().get()
        val body = """{"id":"z","name":"Z","slug":"home-top","frame":{"id":"f","type":"banner","settings":{}},"taleGroups":[
            {"id":"g1","name":"Plain","tales":[]},
            {"id":"g2","name":"Pro","tales":[],"audience":{"match":"all","conditions":[{"property":"plan","operator":"eq","value":"pro"}]}}
        ]}"""
        val view = TaleartView(activity).apply {
            client = client { json(body) }
            properties = mapOf("plan" to "free")
            configure("http://api.test", "tak_key")
        }
        activity.setContentView(view)
        waitFor("the zone") { view.controller.zone != null }
        assertEquals(listOf("Plain"), view.controller.zone?.taleGroups?.map { it.name })
        assertFalse(requests.single().url.toString().contains("free"), "the properties are not sent")

        // The view's own properties replace the SDK's: an SDK value of pro does not show the Pro group here.
        view.properties = mapOf("plan" to "pro")
        waitFor("the zone read again") { view.controller.zone?.taleGroups?.map { it.name } == listOf("Plain", "Pro") }
    }
}
