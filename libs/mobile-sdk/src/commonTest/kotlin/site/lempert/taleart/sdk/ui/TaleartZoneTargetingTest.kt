package site.lempert.taleart.sdk.ui

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.HttpRequestData
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import site.lempert.taleart.sdk.TaleartConfig
import site.lempert.taleart.sdk.TaleartSdk
import site.lempert.taleart.sdk.delivery.DeliveryClient
import site.lempert.taleart.sdk.delivery.EXTERNAL_USER_ID_HEADER
import site.lempert.taleart.sdk.storage.InMemoryKeyValueStore
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull

// What a zone read of the native SDK sends and shows for the viewer (epic targeting R2, R4): the external
// user ID in its own header, and the groups the viewer's tags leave out, left out on the device.
class TaleartZoneTargetingTest {
    private val api = "http://localhost:3592"
    private val zone = """{"id":"z1","name":"Home","slug":"home-top","frame":null,"taleGroups":[
        {"id":"g-plain","name":"Plain","tags":[],"tagMatch":"any","tales":[]},
        {"id":"g-vip","name":"VIP","tags":["vip"],"tagMatch":"any","tales":[]},
        {"id":"g-summer","name":"Summer","tags":["summer","sale"],"tagMatch":"all","tales":[]}
    ]}"""

    @AfterTest
    fun resetSdk() {
        TaleartSdk.init(TaleartConfig())
    }

    private fun TestScope.client(requests: MutableList<HttpRequestData>, body: String = zone) = DeliveryClient(
        HttpClient(MockEngine { request ->
            requests += request
            respond(body, HttpStatusCode.OK, headersOf(HttpHeaders.ContentType to listOf("application/json")))
        }),
        StandardTestDispatcher(testScheduler),
        visitorStore = { InMemoryKeyValueStore() },
    )

    // The reads finish on the engine's own dispatcher, so the test scheduler is drained and the test waits
    // a moment in real time until the controller has its answer (as TaleartHooksTest does).
    private suspend fun TestScope.settle(controller: TaleartZoneController) {
        repeat(200) {
            advanceUntilIdle()
            if (controller.zone != null || controller.failure != null) return
            withContext(Dispatchers.Default) { delay(5) }
        }
        advanceUntilIdle()
    }

    @Test
    fun theViewersTagsLeaveOutTheGroupsTheyDoNotMatch() = runTest {
        TaleartSdk.init(TaleartConfig(apiUrl = api, tags = listOf("  SUMMER ")))
        val requests = mutableListOf<HttpRequestData>()
        val controller = TaleartZoneController(client(requests), this)
        controller.configure(api, "tak_zone_key")
        settle(controller)
        // "summer" alone does not satisfy the "all" group (summer and sale); the VIP group needs "vip".
        assertEquals(listOf("g-plain"), controller.zone!!.taleGroups.map { it.id })
        assertNull(requests.single().headers[EXTERNAL_USER_ID_HEADER], "no external user ID set")
        controller.close()
    }

    @Test
    fun withoutTagsEveryGroupShowsAndTheExternalUserIdTravelsInItsHeader() = runTest {
        TaleartSdk.init(TaleartConfig(apiUrl = api, externalUserId = "user-secret-42"))
        val requests = mutableListOf<HttpRequestData>()
        val controller = TaleartZoneController(client(requests), this)
        controller.configure(api, "tak_zone_key")
        settle(controller)
        assertEquals(listOf("g-plain", "g-vip", "g-summer"), controller.zone!!.taleGroups.map { it.id })
        assertEquals("dXNlci1zZWNyZXQtNDI", requests.single().headers[EXTERNAL_USER_ID_HEADER])
        assertFalse(requests.single().url.toString().contains("user-secret"), "never in the URL")
        controller.close()
    }

    // A zone with one group per audience rule, shown in a bar or a banner (the frame type is the only difference).
    private fun audienceZone(frameType: String) = """{"id":"z1","name":"Home","slug":"home-top","frame":{"id":"f1","type":"$frameType","settings":{}},"taleGroups":[
        {"id":"g-plain","name":"Plain","tags":[],"tagMatch":"any","tales":[]},
        {"id":"g-pro","name":"Pro","tags":[],"tagMatch":"any","tales":[],"audience":{"match":"all","conditions":[{"property":"plan","operator":"eq","value":"pro"}]}},
        {"id":"g-adult","name":"Adult","tags":[],"tagMatch":"any","tales":[],"audience":{"match":"any","conditions":[{"property":"age","operator":"gte","value":30},{"property":"segments","operator":"contains","value":"beta"}]}}
    ]}"""

    private suspend fun TestScope.shownTo(frameType: String, properties: Map<String, Any?>?): List<String> {
        TaleartSdk.init(TaleartConfig(apiUrl = api, properties = properties))
        val requests = mutableListOf<HttpRequestData>()
        val controller = TaleartZoneController(client(requests, audienceZone(frameType)), this)
        controller.configure(api, "tak_zone_key")
        settle(controller)
        val ids = controller.zone!!.taleGroups.map { it.id }
        controller.close()
        return ids
    }

    @Test
    fun aBarAndABannerShowTheGroupsTheViewersPropertiesPass() = runTest {
        for (frame in listOf("bar", "banner")) {
            // A pro viewer under 30 sees the Pro group only; an adult free viewer sees the Adult group only.
            assertEquals(listOf("g-plain", "g-pro"), shownTo(frame, mapOf("plan" to "pro", "age" to 25)), frame)
            assertEquals(listOf("g-plain", "g-adult"), shownTo(frame, mapOf("plan" to "free", "age" to 40)), frame)
            assertEquals(listOf("g-plain", "g-adult"), shownTo(frame, mapOf("segments" to listOf("Beta"), "age" to 30, "plan" to "free")), frame)
        }
    }

    @Test
    fun withoutPropertiesEveryGroupWithoutAFailingRuleShows() = runTest {
        // The page passed no properties: every audience rule passes, as the Web SDK does.
        assertEquals(listOf("g-plain", "g-pro", "g-adult"), shownTo("bar", null))
        assertEquals(listOf("g-plain", "g-pro", "g-adult"), shownTo("banner", null))
    }

    @Test
    fun theViewersPropertiesNeverLeaveTheDevice() = runTest {
        TaleartSdk.init(TaleartConfig(apiUrl = api, properties = mapOf("plan" to "secret-plan-7731", "email" to "person-8842@example.test")))
        val requests = mutableListOf<HttpRequestData>()
        val controller = TaleartZoneController(client(requests, audienceZone("bar")), this)
        controller.configure(api, "tak_zone_key")
        settle(controller)
        val request = requests.single()
        val sent = request.url.toString() + request.headers.entries().joinToString(" ") { (name, values) -> "$name: ${values.joinToString(",")}" }
        assertFalse(sent.contains("7731"), "no property value in the request")
        assertFalse(sent.contains("8842"), "no property value in the request")
        assertFalse(sent.contains("plan", ignoreCase = true), "no property name in the request")
        controller.close()
    }

    @Test
    fun aViewsOwnPropertiesReplaceTheSdksForItsGroups() = runTest {
        TaleartSdk.init(TaleartConfig(apiUrl = api, properties = mapOf("plan" to "free")))
        val requests = mutableListOf<HttpRequestData>()
        val controller = TaleartZoneController(client(requests, audienceZone("banner")), this)
        controller.properties = mapOf("plan" to "pro")
        controller.configure(api, "tak_zone_key")
        settle(controller)
        // The SDK's free plan would hide Pro; the view's pro plan shows it (no age or segment, so Adult stays out).
        assertEquals(listOf("g-plain", "g-pro"), controller.zone!!.taleGroups.map { it.id })
        controller.close()
    }
}
