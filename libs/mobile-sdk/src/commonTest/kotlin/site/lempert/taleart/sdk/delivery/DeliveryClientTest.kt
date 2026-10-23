package site.lempert.taleart.sdk.delivery

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.MockRequestHandleScope
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.HttpRequestData
import io.ktor.client.request.HttpResponseData
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.io.IOException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

// The client against a fake server, one test for each response the Web SDK's tests cover
// (libs/web-sdk/src/lib/taleart-element.spec.ts), plus the typed failures and the ETag copy.
class DeliveryClientTest {
    private val api = "http://localhost:3592"
    private val key = "tas_testkey"
    private val homeTop = ZoneRequest(key = key, zone = "home-top")
    private val requests = mutableListOf<HttpRequestData>()

    private fun TestScope.client(
        handler: suspend MockRequestHandleScope.(HttpRequestData) -> HttpResponseData,
    ): DeliveryClient {
        val engine = MockEngine { request ->
            requests += request
            handler(request)
        }
        return DeliveryClient(HttpClient(engine), StandardTestDispatcher(testScheduler))
    }

    private fun MockRequestHandleScope.json(
        body: String,
        status: HttpStatusCode = HttpStatusCode.OK,
        vararg headers: Pair<String, String>,
    ) = respond(
        body,
        status,
        headersOf(*(headers.map { it.first to listOf(it.second) } + (HttpHeaders.ContentType to listOf("application/json"))).toTypedArray()),
    )

    private fun zoneWith(frame: String = "{\"id\":\"f1\",\"type\":\"bar\",\"settings\":{}}", groups: String = "[]") =
        """{"id":"z1","name":"Home","slug":"home-top","frame":$frame,"taleGroups":$groups}"""

    private val refused = """{"error":{"code":"invalid_site_key","message":"A valid site key and zone are required"}}"""

    @Test
    fun readsTheZoneBySlugWithTheSiteKeyAsABearerTokenOnceAndNoCookie() = runTest {
        val client = client { json(HOME_TOP_ZONE_JSON) }
        assertIs<ZoneResult.Success>(client.fetchZone(api, homeTop))
        assertEquals(1, requests.size)
        val request = requests.single()
        assertEquals("$api/delivery/v1/zone?zone=home-top", request.url.toString())
        assertEquals("GET", request.method.value)
        assertEquals("Bearer $key", request.headers[HttpHeaders.Authorization])
        assertNull(request.headers[HttpHeaders.Cookie])
    }

    @Test
    fun readsTheSuccessShapeOfARealResponse() = runTest {
        val zone = assertIs<ZoneResult.Success>(client { json(HOME_TOP_ZONE_JSON) }.fetchZone(api, homeTop)).zone
        assertEquals("Home top", zone.name)
        assertEquals("home-top", zone.slug)
        val frame = assertNotNull(zone.frame)
        assertEquals("bar", frame.type)
        assertEquals("circle", frame.settings["shape"]?.jsonPrimitive?.content)
        assertEquals("gradient", zone.theme?.get("ringStyle")?.jsonPrimitive?.content)
        assertEquals(listOf("Summer trips", "Winter tales"), zone.taleGroups.map { it.name })
        assertEquals(
            listOf(listOf("Beach day", "Mountain hike", "City night"), listOf("First snow", "Hot cocoa")),
            zone.taleGroups.map { group -> group.tales.map { it.title } },
        )
        val first = zone.taleGroups.first()
        assertNull(first.cover)
        val tale = first.tales.first()
        assertEquals("image", tale.media?.kind)
        assertEquals("image/png", tale.media?.contentType)
        assertTrue(tale.media?.url.orEmpty().startsWith("http://localhost:3592/media/tales/"))
        assertNotNull(tale.document?.get("elements"))
        assertEquals(emptyList<DeliveryFont>(), tale.fonts)
    }

    @Test
    fun ignoresFieldsItDoesNotKnow() = runTest {
        val body = """{"id":"z1","name":"Home","slug":"home-top","newField":{"a":1},
            "frame":{"id":"f1","type":"bar","settings":{},"extra":true},
            "taleGroups":[{"id":"g1","name":"Summer","cover":{"kind":"image","contentType":"image/png","animated":true,
            "url":"$api/media/covers/c.png","blurhash":"x"},"newGroupField":[1,2],
            "tales":[{"id":"t1","title":"Beach","media":null,"document":null,"rating":5,
            "fonts":[{"id":"f","url":"$api/media/fonts/f.woff2","weight":700,"style":"italic","family":"X"}]}]}]}"""
        val zone = assertIs<ZoneResult.Success>(client { json(body) }.fetchZone(api, homeTop)).zone
        val group = zone.taleGroups.single()
        assertEquals("Summer", group.name)
        assertEquals(true, group.cover?.animated)
        assertEquals("Beach", group.tales.single().title)
        assertEquals(700, group.tales.single().fonts.single().weight)
    }

    @Test
    fun treatsAnHtmlPageOn200AsAFailure() = runTest {
        val client = client {
            respond("<!doctype html><html></html>", HttpStatusCode.OK, headersOf(HttpHeaders.ContentType, "text/html"))
        }
        val failure = assertIs<ZoneResult.InvalidResponse>(client.fetchZone(api, homeTop))
        assertEquals("The TaleArt API sent a response that is not a zone", failure.message)
        assertEquals(200, failure.status)
    }

    @Test
    fun treatsABodyWithoutTaleGroupsOn200AsAFailure() = runTest {
        val body = """{"id":"z1","name":"Home","frame":{"id":"f1","type":"bar","settings":{}}}"""
        assertIs<ZoneResult.InvalidResponse>(client { json(body) }.fetchZone(api, homeTop))
    }

    @Test
    fun treatsABodyWithoutAFrameOn200AsAFailure() = runTest {
        assertIs<ZoneResult.InvalidResponse>(client { json("""{"id":"z1","name":"Home","taleGroups":[]}""") }.fetchZone(api, homeTop))
    }

    @Test
    fun treatsAGroupWithoutTalesAsAFailure() = runTest {
        val body = zoneWith(groups = """[{"id":"g1","name":"Summer"}]""")
        assertIs<ZoneResult.InvalidResponse>(client { json(body) }.fetchZone(api, homeTop))
    }

    @Test
    fun readsAZoneWithoutADisplayAndRefusesAFrameThatIsNotAnObject() = runTest {
        val none = assertIs<ZoneResult.Success>(client { json(zoneWith(frame = "null")) }.fetchZone(api, homeTop))
        assertNull(none.zone.frame)
        for (frame in listOf("\"bar\"", "7")) {
            assertIs<ZoneResult.InvalidResponse>(client { json(zoneWith(frame = frame)) }.fetchZone(api, homeTop))
        }
    }

    @Test
    fun readsADisplayTypeItDoesNotKnowForTheRendererToSkip() = runTest {
        val body = zoneWith(frame = """{"id":"f0","type":"feed","settings":{}}""")
        val zone = assertIs<ZoneResult.Success>(client { json(body) }.fetchZone(api, homeTop)).zone
        assertEquals("feed", zone.frame?.type)
    }

    @Test
    fun readsAZoneWithoutTaleGroups() = runTest {
        val zone = assertIs<ZoneResult.Success>(client { json(zoneWith()) }.fetchZone(api, homeTop)).zone
        assertEquals(emptyList<DeliveryTaleGroup>(), zone.taleGroups)
    }

    @Test
    fun answersARefusedKeyWithTheApiMessage() = runTest {
        val client = client { json(refused, HttpStatusCode.Unauthorized, HttpHeaders.WWWAuthenticate to "Bearer") }
        val failure = assertIs<ZoneResult.InvalidSiteKey>(client.fetchZone(api, homeTop))
        assertEquals("A valid site key and zone are required", failure.message)
    }

    @Test
    fun answersAnUnknownSlugOrARevokedKeyAsARefusedKeyAsTheApiDoes() = runTest {
        val client = client { request ->
            val known = request.url.parameters["zone"] == "home-top" && request.headers[HttpHeaders.Authorization] == "Bearer $key"
            if (known) json(HOME_TOP_ZONE_JSON) else json(refused, HttpStatusCode.Unauthorized)
        }
        assertIs<ZoneResult.InvalidSiteKey>(client.fetchZone(api, ZoneRequest(key, "nope")))
        assertIs<ZoneResult.InvalidSiteKey>(client.fetchZone(api, ZoneRequest("tas_revoked", "home-top")))
        assertIs<ZoneResult.Success>(client.fetchZone(api, homeTop))
    }

    @Test
    fun answersA404AsAnUnknownZone() = runTest {
        val body = """{"error":{"code":"zone_not_found","message":"Zone not found"}}"""
        val failure = assertIs<ZoneResult.UnknownZone>(client { json(body, HttpStatusCode.NotFound) }.fetchZone(api, homeTop))
        assertEquals("Zone not found", failure.message)
        assertEquals("zone_not_found", failure.code)
    }

    @Test
    fun answersARateLimitWithItsRetryAfterSeconds() = runTest {
        val body = """{"error":{"code":"rate_limited","message":"Too many requests"}}"""
        val limited = client { json(body, HttpStatusCode.TooManyRequests, HttpHeaders.RetryAfter to "2") }
        val failure = assertIs<ZoneResult.RateLimited>(limited.fetchZone(api, homeTop))
        assertEquals("Too many requests", failure.message)
        assertEquals(2L, failure.retryAfterSeconds)
        val noHeader = client { json(body, HttpStatusCode.TooManyRequests) }
        assertNull(assertIs<ZoneResult.RateLimited>(noHeader.fetchZone(api, homeTop)).retryAfterSeconds)
        val date = client { json(body, HttpStatusCode.TooManyRequests, HttpHeaders.RetryAfter to "Fri, 23 Oct 2026 09:00:00 GMT") }
        assertNull(assertIs<ZoneResult.RateLimited>(date.fetchZone(api, homeTop)).retryAfterSeconds)
    }

    @Test
    fun answersAServerErrorWithTheApiMessageOrTheStatus() = runTest {
        val body = """{"error":{"code":"internal_error","message":"Something went wrong"}}"""
        val withBody = assertIs<ZoneResult.ServerError>(client { json(body, HttpStatusCode.InternalServerError) }.fetchZone(api, homeTop))
        assertEquals("Something went wrong", withBody.message)
        assertEquals(500, withBody.status)
        assertEquals("internal_error", withBody.code)
        val gateway = client {
            respond("<html>Bad gateway</html>", HttpStatusCode.BadGateway, headersOf(HttpHeaders.ContentType, "text/html"))
        }
        val bare = assertIs<ZoneResult.ServerError>(gateway.fetchZone(api, homeTop))
        assertEquals("The TaleArt API answered 502", bare.message)
        assertNull(bare.code)
    }

    @Test
    fun answersANetworkFailureAsOffline() = runTest {
        val failure = assertIs<ZoneResult.Offline>(client { throw IOException("Failed to fetch") }.fetchZone(api, homeTop))
        assertEquals("Could not reach the TaleArt API: Failed to fetch", failure.message)
        assertIs<IOException>(failure.cause)
    }

    @Test
    fun sharesOneRequestAmongCallersAskingForTheSameZoneAtOnce() = runTest {
        val gate = CompletableDeferred<Unit>()
        val client = client { request ->
            gate.await()
            json(zoneWith(groups = """[{"id":"g","name":"Group of ${request.url.parameters["zone"]}","tales":[]}]"""))
        }
        val calls = listOf("home-top", "home-promo", "home-top").map { slug ->
            async { client.fetchZone(api, ZoneRequest(key, slug)) }
        }
        testScheduler.runCurrent()
        gate.complete(Unit)
        val names = calls.awaitAll().map { assertIs<ZoneResult.Success>(it).zone.taleGroups.single().name }
        assertEquals(listOf("Group of home-top", "Group of home-promo", "Group of home-top"), names)
        assertEquals(
            listOf("$api/delivery/v1/zone?zone=home-promo", "$api/delivery/v1/zone?zone=home-top"),
            requests.map { it.url.toString() }.sorted(),
        )
    }

    @Test
    fun sendsOneRequestPerKeyForTheSameSlug() = runTest {
        val gate = CompletableDeferred<Unit>()
        val client = client {
            gate.await()
            json(HOME_TOP_ZONE_JSON)
        }
        val calls = listOf(key, "tas_otherproject").map { k -> async { client.fetchZone(api, ZoneRequest(k, "home-top")) } }
        testScheduler.runCurrent()
        gate.complete(Unit)
        calls.awaitAll()
        assertEquals(listOf("Bearer $key", "Bearer tas_otherproject"), requests.map { it.headers[HttpHeaders.Authorization] })
    }

    @Test
    fun asksAgainOnALaterLoadAndRevalidatesItsCopyWithTheETag() = runTest {
        val etag = "W/\"1e7-abc\""
        val client = client { request ->
            if (request.headers[HttpHeaders.IfNoneMatch] == etag) {
                respond("", HttpStatusCode.NotModified, headersOf(HttpHeaders.ETag, etag))
            } else {
                json(HOME_TOP_ZONE_JSON, HttpStatusCode.OK, HttpHeaders.ETag to etag)
            }
        }
        val first = assertIs<ZoneResult.Success>(client.fetchZone(api, homeTop))
        val second = assertIs<ZoneResult.Success>(client.fetchZone(api, homeTop))
        assertEquals(2, requests.size)
        assertNull(requests[0].headers[HttpHeaders.IfNoneMatch])
        assertEquals(etag, requests[1].headers[HttpHeaders.IfNoneMatch])
        assertEquals(first.zone, second.zone)
        // Another key has its own copy: no If-None-Match.
        client.fetchZone(api, ZoneRequest("tas_otherproject", "home-top"))
        assertNull(requests[2].headers[HttpHeaders.IfNoneMatch])
    }

    @Test
    fun forgetsItsCopyWhenTheKeyIsRefused() = runTest {
        var refuse = false
        val client = client {
            if (refuse) json(refused, HttpStatusCode.Unauthorized) else json(HOME_TOP_ZONE_JSON, HttpStatusCode.OK, HttpHeaders.ETag to "\"1\"")
        }
        client.fetchZone(api, homeTop)
        refuse = true
        assertIs<ZoneResult.InvalidSiteKey>(client.fetchZone(api, homeTop))
        refuse = false
        client.fetchZone(api, homeTop)
        assertNull(requests[2].headers[HttpHeaders.IfNoneMatch])
    }

    @Test
    fun encodesTheSlugAsEncodeUriComponentAndTrimsTrailingSlashes() {
        assertEquals("$api/delivery/v1/zone?zone=home-top", DeliveryClient.zoneUrl("$api//", "home-top"))
        assertEquals("$api/delivery/v1/zone?zone=a%20b%26c%3D%2F%C3%A9-_.!~*'()", DeliveryClient.zoneUrl(api, "a b&c=/é-_.!~*'()"))
    }

    @Test
    fun readsRetryAfterSecondsOnly() {
        assertEquals(5L, retryAfterSeconds(" 5 "))
        assertNull(retryAfterSeconds("-1"))
        assertNull(retryAfterSeconds(null))
    }

    @Test
    fun keepsUnknownJsonValuesOfTheThemeAndSettings() = runTest {
        val body = zoneWith(frame = """{"id":"f1","type":"bar","settings":{"future":"x"}}""")
        val zone = assertIs<ZoneResult.Success>(client { json(body) }.fetchZone(api, homeTop)).zone
        assertEquals(JsonPrimitive("x"), zone.frame?.settings?.get("future"))
    }
}
