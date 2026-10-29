package site.lempert.taleart.sdk.delivery

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.HttpRequestData
import io.ktor.http.HttpHeaders
import io.ktor.http.headersOf
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.runTest
import site.lempert.taleart.sdk.storage.InMemoryKeyValueStore
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

// The external user ID on its way to the Delivery API: its header value (base64url of its UTF-8 bytes,
// as the Web SDK's encodeExternalUserIdHeader writes it), and the zone read that carries it.
class ExternalUserIdTest {
    private val api = "http://localhost:3592"
    private val key = "tak_testkey"
    private val zone = """{"id":"z1","name":"Home","slug":"home-top","frame":null,"taleGroups":[]}"""

    @Test
    fun theHeaderIsTheBase64UrlOfTheIdsUtf8BytesWithoutPadding() {
        assertEquals("dXNlci1zZWNyZXQtNDI", encodeExternalUserIdHeader("user-secret-42"))
        assertEquals("w4l0w6k", encodeExternalUserIdHeader("Été"))
        assertEquals("YQ", encodeExternalUserIdHeader("a"))
        assertEquals("YWI", encodeExternalUserIdHeader("ab"))
        assertEquals("YWJj", encodeExternalUserIdHeader("abc"))
    }

    @Test
    fun theIdIsTrimmedAndAnUnusableOneSendsNoHeader() {
        assertEquals(encodeExternalUserIdHeader("abc"), encodeExternalUserIdHeader("  abc \n"))
        assertNull(encodeExternalUserIdHeader(null))
        assertNull(encodeExternalUserIdHeader("   "))
        assertNull(encodeExternalUserIdHeader("tab\there"))
        assertNull(encodeExternalUserIdHeader("x".repeat(257)))
        assertTrue(encodeExternalUserIdHeader("x".repeat(256)) != null)
    }

    @Test
    fun theZoneReadSendsTheHeaderAndNeverRevalidatesAViewersCopy() = runTest {
        val requests = mutableListOf<HttpRequestData>()
        val engine = MockEngine { request ->
            requests += request
            respond(zone, io.ktor.http.HttpStatusCode.OK, headersOf(HttpHeaders.ETag to listOf("\"v1\""), HttpHeaders.ContentType to listOf("application/json")))
        }
        val client = DeliveryClient(HttpClient(engine), StandardTestDispatcher(testScheduler), visitorStore = { InMemoryKeyValueStore() })
        val header = encodeExternalUserIdHeader("user-secret-42")
        assertIs<ZoneResult.Success>(client.fetchZone(api, ZoneRequest(key), header))
        assertIs<ZoneResult.Success>(client.fetchZone(api, ZoneRequest(key), header))
        assertEquals(2, requests.size)
        for (request in requests) assertEquals("dXNlci1zZWNyZXQtNDI", request.headers[EXTERNAL_USER_ID_HEADER])
        assertNull(requests[1].headers[HttpHeaders.IfNoneMatch], "a viewer's copy is never revalidated")
        assertTrue(requests.all { !it.url.toString().contains("user-secret") }, "the ID never travels in the URL")
        client.close()
    }

    @Test
    fun theZoneReadWithoutAnIdSendsNoHeader() = runTest {
        val requests = mutableListOf<HttpRequestData>()
        val engine = MockEngine { request ->
            requests += request
            respond(zone, io.ktor.http.HttpStatusCode.OK, headersOf(HttpHeaders.ContentType to listOf("application/json")))
        }
        val client = DeliveryClient(HttpClient(engine), StandardTestDispatcher(testScheduler), visitorStore = { InMemoryKeyValueStore() })
        client.fetchZone(api, ZoneRequest(key))
        assertNull(requests.single().headers[EXTERNAL_USER_ID_HEADER])
        client.close()
    }
}
