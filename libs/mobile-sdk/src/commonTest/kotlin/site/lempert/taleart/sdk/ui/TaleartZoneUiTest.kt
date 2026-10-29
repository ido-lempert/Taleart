package site.lempert.taleart.sdk.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.ComposeUiTest
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.SemanticsNodeInteractionsProvider
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertWidthIsAtLeast
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.v2.runComposeUiTest
import androidx.compose.ui.unit.dp
import coil3.ImageLoader
import coil3.compose.LocalPlatformContext
import coil3.network.ktor3.KtorNetworkFetcherFactory
import coil3.serviceLoaderEnabled
import coil3.network.ConnectivityChecker
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
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import site.lempert.taleart.sdk.delivery.DeliveryClient
import site.lempert.taleart.sdk.delivery.DeliveryTaleGroup
import site.lempert.taleart.sdk.delivery.DeliveryZone
import site.lempert.taleart.sdk.delivery.HOME_TOP_ZONE_JSON
import site.lempert.taleart.sdk.delivery.ZoneResult
import site.lempert.taleart.sdk.delivery.readZone
import site.lempert.taleart.sdk.storage.InMemoryKeyValueStore
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

// TaleartZone against the Delivery API fixture (a real home-top response, story 9.2) on a fake
// server. Cover images load from a fake server too: no test touches the network.
@OptIn(ExperimentalTestApi::class)
class TaleartZoneUiTest : ComposeUiTestBase() {
    private val api = "http://api.test"
    private val key = "tak_key"
    private val summer = "905ea258-ccfd-4527-9b84-380c5fbe011a"
    private val winter = "48962270-14fe-4563-aa65-470ea8997fa1"
    private val requests = mutableListOf<HttpRequestData>()
    private val imageRequests = mutableListOf<String>()

    private fun client(
        handler: suspend MockRequestHandleScope.(HttpRequestData) -> HttpResponseData = { json(HOME_TOP_ZONE_JSON) },
    ) = DeliveryClient(
        HttpClient(MockEngine { request ->
            requests += request
            handler(request)
        }),
    )

    private fun MockRequestHandleScope.json(body: String, status: HttpStatusCode = HttpStatusCode.OK) =
        respond(body, status, headersOf(HttpHeaders.ContentType, "application/json"))

    // Every cover image request goes to a fake server that records it and answers 404.
    @Composable
    private fun Offline(content: @Composable () -> Unit) {
        val context = LocalPlatformContext.current
        val loader = remember {
            ImageLoader.Builder(context)
                // Only the fake fetcher: not the Ktor one Coil finds by itself (a 404 is never cached).
                .serviceLoaderEnabled(false)
                .components {
                    add(
                        KtorNetworkFetcherFactory(connectivityChecker = { ConnectivityChecker.ONLINE }, httpClient = {
                            HttpClient(MockEngine { request ->
                                imageRequests += request.url.toString()
                                respond(ByteArray(0), HttpStatusCode.NotFound)
                            })
                        }),
                    )
                }
                .build()
        }
        CompositionLocalProvider(LocalCoverImageLoader provides loader, content = content)
    }

    private fun ComposeUiTest.show(content: @Composable () -> Unit) = setContent { Offline(content) }

    private fun zone(json: String): DeliveryZone = readZone(Json.parseToJsonElement(json) as JsonObject)

    private fun zoneJson(frame: String, groups: String = "[]") =
        """{"id":"z1","name":"Home top","slug":"home-top","theme":null,"frame":$frame,"taleGroups":$groups}"""

    private val bar = """{"id":"f","type":"bar","settings":{}}"""

    private fun groupsJson(vararg names: String) =
        names.joinToString(",", "[", "]") { """{"id":"${it.lowercase()}","name":"$it","tales":[]}""" }

    private fun seen(initial: Map<String, String> = emptyMap()) = SeenGroups(InMemoryKeyValueStore(initial))

    private fun SemanticsNodeInteractionsProvider.labels(): List<String> =
        onAllNodesWithTag(BAR_ITEM_TAG).fetchSemanticsNodes().map {
            it.config[SemanticsProperties.ContentDescription].joinToString()
        }

    private fun SemanticsNodeInteractionsProvider.titles(): List<String> =
        onAllNodes(SemanticsMatcher.keyIsDefined(BarTitle), useUnmergedTree = true).fetchSemanticsNodes().map {
            it.config[BarTitle]
        }

    private fun ComposeUiTest.waitForLabels(expected: List<String>) =
        waitUntil("labels $expected", 5_000) { labels() == expected }

    @Test
    fun showsEachGroupOfTheZoneInTheDeliveredOrderWithItsTitle() = runComposeUiTest {
        val seenGroups = seen()
        show { TaleartZone(api, key, client = client(), seenGroups = seenGroups) }

        waitForLabels(listOf("Summer trips", "Winter tales"))
        assertEquals(listOf("Summer trips", "Winter tales"), titles())
        assertEquals("$api/delivery/v1/zone", requests.single().url.toString())
        assertEquals("Bearer $key", requests.single().headers[HttpHeaders.Authorization])
    }

    @Test
    fun keepsTheOrderOfThreeGroups() = runComposeUiTest {
        show { TaleartZone(zone(zoneJson(bar, groupsJson("Third", "First", "Second"))), seenGroups = seen()) }

        waitForLabels(listOf("Third", "First", "Second"))
    }

    @Test
    fun aHostHandlingTapsIsCalledBackAndTheRingStaysUnseenUntilAViewerShowsTheGroup() = runComposeUiTest {
        val store = InMemoryKeyValueStore()
        val seenGroups = SeenGroups(store)
        val clicked = mutableListOf<DeliveryTaleGroup>()
        // The host handles taps itself: no viewer opens (TaleartViewerUiTest covers the one that does).
        show {
            TaleartZone(api, key, onGroupClick = { clicked += it }, client = client(), seenGroups = seenGroups, opensViewer = false)
        }

        waitForLabels(listOf("Summer trips", "Winter tales"))
        onNodeWithContentDescription("Winter tales").assertHasClickAction().performClick()
        waitForIdle()
        assertEquals(listOf(winter), clicked.map { it.id })
        assertEquals(listOf("Summer trips", "Winter tales"), labels())
        assertEquals(null, store.get(SEEN_STORAGE_KEY))

        // What the viewer (story 9.4) does when it shows the group.
        seenGroups.markSeen(winter)
        waitForLabels(listOf("Summer trips", "Winter tales, seen"))
        waitUntil("the stored id", 5_000) { labels(); store.get(SEEN_STORAGE_KEY) == "[\"$winter\"]" }
    }

    @Test
    fun groupsSeenEarlierShowTheSeenRing() = runComposeUiTest {
        val seenGroups = seen(mapOf(SEEN_STORAGE_KEY to "[\"$summer\",\"other\"]"))
        show { TaleartZone(zone(HOME_TOP_ZONE_JSON), seenGroups = seenGroups) }

        waitForLabels(listOf("Summer trips, seen", "Winter tales"))
    }

    @Test
    fun eachItemIsANamedButtonOfAtLeast48dp() = runComposeUiTest {
        // The smallest size, without titles: the item is still 48 by 48 at least.
        show {
            TaleartZone(
                zone(zoneJson("""{"id":"f","type":"bar","settings":{"size":"small","showTitles":false}}""", groupsJson("Only"))),
                seenGroups = seen(),
            )
        }

        onNodeWithContentDescription("Only")
            .assertHasClickAction()
            .assertWidthIsAtLeast(48.dp)
            .assertHeightIsAtLeast(48.dp)
        assertEquals(emptyList(), titles())
        val role = onAllNodesWithTag(BAR_ITEM_TAG).fetchSemanticsNodes().single().config[SemanticsProperties.Role]
        assertEquals("Button", role.toString())
    }

    @Test
    fun aZoneWithoutGroupsShowsAnEmptyBar() = runComposeUiTest {
        show { TaleartZone(zone(zoneJson(bar)), seenGroups = seen()) }

        assertEquals(1, onAllNodesWithTag(BAR_TAG).fetchSemanticsNodes().size)
        assertEquals(emptyList(), labels())
    }

    @Test
    fun aZoneWithoutADisplayOrWithAnUnknownOneShowsNothing() = runComposeUiTest {
        var type by mutableStateOf<String?>(null)
        val seenGroups = seen()
        show {
            val frame = type?.let { """{"id":"f","type":"$it","settings":{}}""" } ?: "null"
            TaleartZone(zone(zoneJson(frame, groupsJson("A"))), seenGroups = seenGroups)
        }

        assertEquals(0, onAllNodesWithTag(BAR_TAG).fetchSemanticsNodes().size)
        type = "carousel"
        waitForIdle()
        assertEquals(0, onAllNodesWithTag(BAR_TAG).fetchSemanticsNodes().size)
        type = "bar"
        waitForLabels(listOf("A"))
    }

    @Test
    fun aRefusedKeyShowsNothingAndReportsTheTypedFailure() = runComposeUiTest {
        val refused = """{"error":{"code":"invalid_site_key","message":"A valid site key and zone are required"}}"""
        val errors = mutableListOf<ZoneResult.Failure>()
        val seenGroups = seen()
        val refusing = client { json(refused, HttpStatusCode.Unauthorized) }
        show { TaleartZone(api, key, onError = { errors += it }, client = refusing, seenGroups = seenGroups) }

        waitUntil("an error", 5_000) { labels(); errors.isNotEmpty() }
        assertIs<ZoneResult.InvalidSiteKey>(errors.single())
        assertEquals("A valid site key and zone are required", errors.single().message)
        assertEquals(0, onAllNodesWithTag(BAR_TAG).fetchSemanticsNodes().size)
    }

    @Test
    fun waitsForEveryFieldBeforeItAsks() = runComposeUiTest {
        val seenGroups = seen()
        val fake = client { request ->
            json(zoneJson(bar, groupsJson(request.headers[HttpHeaders.Authorization]!!.removePrefix("Bearer "))))
        }
        // Zones missing the API origin, or the key (blank), and one complete: only the complete one is read.
        show {
            TaleartZone("", key, client = fake, seenGroups = seenGroups)
            TaleartZone(api, "", client = fake, seenGroups = seenGroups)
            TaleartZone(api, " ", client = fake, seenGroups = seenGroups)
            TaleartZone(api, "tak_complete", client = fake, seenGroups = seenGroups)
        }

        waitForLabels(listOf("tak_complete"))
        mainClock.advanceTimeBy(5_000)
        waitForIdle()
        assertEquals(listOf("Bearer tak_complete"), requests.map { it.headers[HttpHeaders.Authorization] })
        assertEquals(listOf("tak_complete"), labels())
    }

    @Test
    fun aNewZoneKeyShowsTheNewZone() = runComposeUiTest {
        var zoneKey by mutableStateOf(key)
        val seenGroups = seen()
        val fake = client { request ->
            if (request.headers[HttpHeaders.Authorization] == "Bearer $key") json(HOME_TOP_ZONE_JSON)
            else json(zoneJson(bar, groupsJson("Other")))
        }
        show { TaleartZone(api, zoneKey, client = fake, seenGroups = seenGroups) }

        waitForLabels(listOf("Summer trips", "Winter tales"))
        zoneKey = "tak_other"
        waitForLabels(listOf("Other"))
        assertEquals(listOf("Bearer $key", "Bearer tak_other"), requests.map { it.headers[HttpHeaders.Authorization] })
    }

    @Test
    fun aReloadKeepsTheBarUntilTheNewZoneArrives() = runComposeUiTest {
        var reloads by mutableStateOf(0)
        val gate = CompletableDeferred<Unit>()
        val seenGroups = seen()
        val fake = client {
            if (requests.size == 1) json(HOME_TOP_ZONE_JSON)
            else {
                gate.await()
                json(zoneJson(bar, groupsJson("Fresh")))
            }
        }
        show { TaleartZone(api, key, client = fake, seenGroups = seenGroups, reloadKey = reloads) }

        waitForLabels(listOf("Summer trips", "Winter tales"))
        reloads++
        waitUntil("a second request", 5_000) { labels(); requests.size == 2 }
        waitForIdle()
        assertEquals(listOf("Summer trips", "Winter tales"), labels())
        gate.complete(Unit)
        waitForLabels(listOf("Fresh"))
    }

    @Test
    fun anInlineClientDoesNotReadAgainOnRecomposition() = runComposeUiTest {
        var tick by mutableIntStateOf(0)
        val seenGroups = seen()
        val engine = MockEngine { request ->
            requests += request
            json(HOME_TOP_ZONE_JSON)
        }
        show {
            // A new client on every composition: a caller's mistake that must not loop.
            tick.let { TaleartZone(api, key, client = DeliveryClient(HttpClient(engine)), seenGroups = seenGroups) }
        }

        waitForLabels(listOf("Summer trips", "Winter tales"))
        repeat(3) {
            tick++
            waitForIdle()
        }
        assertEquals(1, requests.size)
        assertTrue(labels().isNotEmpty())
    }
}
