package site.lempert.taleart.sdk.android

import android.app.Activity
import android.os.Looper
import android.widget.FrameLayout
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
import kotlinx.coroutines.CompletableDeferred
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import site.lempert.taleart.sdk.delivery.DeliveryClient
import site.lempert.taleart.sdk.delivery.ZoneResult
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertSame
import kotlin.test.assertTrue

@RunWith(RobolectricTestRunner::class)
class TaleartViewTest {
    private val requests = mutableListOf<HttpRequestData>()

    private fun zoneJson(vararg names: String) =
        """{"id":"z","name":"Z","slug":"home-top","frame":{"id":"f","type":"bar","settings":{}},"taleGroups":""" +
            names.joinToString(",", "[", "]") { """{"id":"${it.lowercase()}","name":"$it","tales":[]}""" } + "}"

    private fun MockRequestHandleScope.json(body: String, status: HttpStatusCode = HttpStatusCode.OK) =
        respond(body, status, headersOf(HttpHeaders.ContentType, "application/json"))

    private fun client(handler: suspend MockRequestHandleScope.(HttpRequestData) -> HttpResponseData) =
        DeliveryClient(HttpClient(MockEngine { request ->
            requests += request
            handler(request)
        }))

    // Runs the main looper until the condition holds (the reads finish on other threads).
    private fun waitFor(what: String, condition: () -> Boolean) {
        val until = System.currentTimeMillis() + 5_000
        while (true) {
            shadowOf(Looper.getMainLooper()).idle()
            if (condition()) return
            check(System.currentTimeMillis() < until) { "Timed out waiting for $what" }
            Thread.sleep(10)
        }
    }

    private fun names(view: TaleartView) = view.controller.zone?.taleGroups?.map { it.name }

    @Test
    fun takesItsZoneFromXmlAttributes() {
        val activity = Robolectric.buildActivity(ComponentActivity::class.java).setup().get()
        val attrs = Robolectric.buildAttributeSet()
            .addAttribute(R.attr.taleartApiUrl, "http://api.test")
            .addAttribute(R.attr.taleartSiteKey, " tas_key ")
            .addAttribute(R.attr.taleartZone, "home-top")
            .build()
        val view = TaleartView(activity, attrs)
        assertEquals("http://api.test", view.apiUrl)
        assertEquals("tas_key", view.siteKey)
        assertEquals("home-top", view.zone)
        assertTrue(view.controller.isComplete)
    }

    @Test
    fun showsTheZoneAndKeepsItWhenDetachedAndAttachedAgain() {
        val activity = Robolectric.buildActivity(ComponentActivity::class.java).setup().get()
        val view = TaleartView(activity).apply {
            client = client { json(zoneJson("Summer", "Winter")) }
            configure("http://api.test", "tas_key", "home-top")
        }
        val parent = FrameLayout(activity)
        activity.setContentView(parent)
        parent.addView(view)

        waitFor("the zone") { names(view) == listOf("Summer", "Winter") && view.hostsComposition }
        assertEquals("http://api.test/delivery/v1/zone?zone=home-top", requests.single().url.toString())
        assertEquals("Bearer tas_key", requests.single().headers[HttpHeaders.Authorization])

        val zone = view.controller.zone
        parent.removeView(view)
        shadowOf(Looper.getMainLooper()).idle()
        parent.addView(view)
        shadowOf(Looper.getMainLooper()).idle()
        assertSame(zone, view.controller.zone)
        assertEquals(1, requests.size)
        // The same ComposeView, not a second one.
        assertEquals(1, view.childCount)
    }

    @Test
    fun aReloadKeepsTheZoneUntilTheNewOneArrives() {
        val activity = Robolectric.buildActivity(ComponentActivity::class.java).setup().get()
        val gate = CompletableDeferred<Unit>()
        val view = TaleartView(activity).apply {
            client = client {
                if (requests.size == 1) json(zoneJson("Old"))
                else {
                    gate.await()
                    json(zoneJson("New"))
                }
            }
            configure("http://api.test", "tas_key", "home-top")
        }
        activity.setContentView(view)

        waitFor("the first zone") { names(view) == listOf("Old") }
        view.reload()
        waitFor("the second request") { requests.size == 2 }
        assertEquals(listOf("Old"), names(view))
        gate.complete(Unit)
        waitFor("the new zone") { names(view) == listOf("New") }
    }

    @Test
    fun reportsAFailedReadAndShowsNothing() {
        val activity = Robolectric.buildActivity(ComponentActivity::class.java).setup().get()
        val errors = mutableListOf<ZoneResult.Failure>()
        val view = TaleartView(activity).apply {
            onErrorListener = { errors += it }
            client = client { json("""{"error":{"code":"invalid_site_key","message":"Refused"}}""", HttpStatusCode.Unauthorized) }
            configure("http://api.test", "tas_bad", "home-top")
        }
        activity.setContentView(view)

        waitFor("the error") { errors.isNotEmpty() }
        assertIs<ZoneResult.InvalidSiteKey>(errors.single())
        assertNull(view.controller.zone)
    }

    @Test
    fun aWindowWithoutALifecycleOwnerShowsNothingInsteadOfCrashing() {
        val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
        val view = TaleartView(activity).apply {
            client = client { json(zoneJson("A")) }
            configure("http://api.test", "tas_key", "home-top")
        }
        activity.setContentView(view)
        shadowOf(Looper.getMainLooper()).idle()

        assertFalse(view.hostsComposition)
        assertEquals(0, view.childCount)
    }
}
