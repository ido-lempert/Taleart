package site.lempert.taleart.sdk.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
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
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.unit.dp
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.HttpRequestData
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
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

// TaleartZone against the Delivery API fixture (a real home-top response, story 9.2) on a fake server.
@OptIn(ExperimentalTestApi::class)
class TaleartZoneUiTest : ComposeUiTestBase() {
    private val api = "http://api.test"
    private val key = "tas_key"
    private val summer = "905ea258-ccfd-4527-9b84-380c5fbe011a"
    private val winter = "48962270-14fe-4563-aa65-470ea8997fa1"
    private val requests = mutableListOf<HttpRequestData>()

    private fun client(status: HttpStatusCode = HttpStatusCode.OK, body: String = HOME_TOP_ZONE_JSON) = DeliveryClient(
        HttpClient(MockEngine { request ->
            requests += request
            respond(body, status, headersOf(HttpHeaders.ContentType, "application/json"))
        }),
    )

    private fun zone(json: String): DeliveryZone = readZone(Json.parseToJsonElement(json) as JsonObject)

    // The fixture with its frame and groups replaced.
    private fun zoneWith(frame: String, groups: String = "[]") = zone(
        """{"id":"z1","name":"Home top","slug":"home-top","theme":null,"frame":$frame,"taleGroups":$groups}""",
    )

    private fun SemanticsNodeInteractionsProvider.labels(): List<String> =
        onAllNodesWithTag(BAR_ITEM_TAG).fetchSemanticsNodes().map {
            it.config[SemanticsProperties.ContentDescription].joinToString()
        }

    private fun SemanticsNodeInteractionsProvider.titles(): List<String> =
        onAllNodes(SemanticsMatcher.keyIsDefined(BarTitle), useUnmergedTree = true).fetchSemanticsNodes().map {
            it.config[BarTitle]
        }

    @Test
    fun showsEachGroupOfTheZoneInTheDeliveredOrderWithItsTitle() = runComposeUiTest {
        setContent { TaleartZone(api, key, "home-top", client = client(), seenStore = InMemoryKeyValueStore()) }

        waitUntil(timeoutMillis = 5_000) { onAllNodesWithTag(BAR_ITEM_TAG).fetchSemanticsNodes().size == 2 }
        assertEquals(listOf("Summer trips", "Winter tales"), labels())
        assertEquals(listOf("Summer trips", "Winter tales"), titles())
        assertEquals("$api/delivery/v1/zone?zone=home-top", requests.single().url.toString())
        assertEquals("Bearer $key", requests.single().headers[HttpHeaders.Authorization])
    }

    @Test
    fun keepsTheOrderOfThreeGroups() = runComposeUiTest {
        val groups = """[{"id":"c","name":"Third","tales":[]},{"id":"a","name":"First","tales":[]},{"id":"b","name":"Second","tales":[]}]"""
        setContent {
            TaleartZone(zoneWith("""{"id":"f","type":"bar","settings":{}}""", groups), seenStore = InMemoryKeyValueStore())
        }

        assertEquals(listOf("Third", "First", "Second"), labels())
    }

    @Test
    fun aTapMarksTheGroupSeenOnTheDeviceAndCallsBack() = runComposeUiTest {
        val store = InMemoryKeyValueStore()
        val clicked = mutableListOf<DeliveryTaleGroup>()
        setContent { TaleartZone(api, key, "home-top", onGroupClick = { clicked += it }, client = client(), seenStore = store) }

        waitUntil(timeoutMillis = 5_000) { onAllNodesWithTag(BAR_ITEM_TAG).fetchSemanticsNodes().size == 2 }
        onNodeWithContentDescription("Winter tales").assertHasClickAction().performClick()

        assertEquals(listOf("Summer trips", "Winter tales, seen"), labels())
        assertEquals(listOf(winter), clicked.map { it.id })
        assertEquals(setOf(winter), SeenGroups(store).ids())
        assertEquals("[\"$winter\"]", store.get(SEEN_STORAGE_KEY))
    }

    @Test
    fun groupsSeenEarlierShowTheSeenRing() = runComposeUiTest {
        val store = InMemoryKeyValueStore(mapOf(SEEN_STORAGE_KEY to "[\"$summer\",\"other\"]"))
        setContent { TaleartZone(zone(HOME_TOP_ZONE_JSON), seenStore = store) }

        assertEquals(listOf("Summer trips, seen", "Winter tales"), labels())
    }

    @Test
    fun eachItemIsANamedButtonOfAtLeast48dp() = runComposeUiTest {
        // The smallest size, without titles: the item is still 48 by 48 at least.
        setContent {
            TaleartZone(
                zoneWith(
                    """{"id":"f","type":"bar","settings":{"size":"small","showTitles":false}}""",
                    """[{"id":"a","name":"Only","tales":[]}]""",
                ),
                seenStore = InMemoryKeyValueStore(),
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
        setContent { TaleartZone(zoneWith("""{"id":"f","type":"bar","settings":{}}"""), seenStore = InMemoryKeyValueStore()) }

        assertEquals(1, onAllNodesWithTag(BAR_TAG).fetchSemanticsNodes().size)
        assertEquals(emptyList(), labels())
    }

    @Test
    fun aZoneWithoutADisplayOrWithAnUnknownOneShowsNothing() = runComposeUiTest {
        var type by mutableStateOf<String?>(null)
        setContent {
            val frame = type?.let { """{"id":"f","type":"$it","settings":{}}""" } ?: "null"
            TaleartZone(zoneWith(frame, """[{"id":"a","name":"A","tales":[]}]"""), seenStore = InMemoryKeyValueStore())
        }

        assertEquals(0, onAllNodesWithTag(BAR_TAG).fetchSemanticsNodes().size)
        type = "carousel"
        waitForIdle()
        assertEquals(0, onAllNodesWithTag(BAR_TAG).fetchSemanticsNodes().size)
        type = "bar"
        waitForIdle()
        assertEquals(listOf("A"), labels())
    }

    @Test
    fun aRefusedKeyShowsNothingAndReportsTheTypedFailure() = runComposeUiTest {
        val refused = """{"error":{"code":"invalid_site_key","message":"A valid site key and zone are required"}}"""
        val errors = mutableListOf<ZoneResult.Failure>()
        setContent {
            TaleartZone(
                api, key, "home-top",
                onError = { errors += it },
                client = client(HttpStatusCode.Unauthorized, refused),
                seenStore = InMemoryKeyValueStore(),
            )
        }

        waitUntil(timeoutMillis = 5_000) { errors.isNotEmpty() }
        assertIs<ZoneResult.InvalidSiteKey>(errors.single())
        assertEquals("A valid site key and zone are required", errors.single().message)
        assertEquals(0, onAllNodesWithTag(BAR_TAG).fetchSemanticsNodes().size)
    }

    @Test
    fun waitsForEveryFieldBeforeItAsks() = runComposeUiTest {
        setContent { TaleartZone(api, "", "home-top", client = client(), seenStore = InMemoryKeyValueStore()) }

        waitForIdle()
        assertTrue(requests.isEmpty())
        assertEquals(0, onAllNodesWithTag(BAR_TAG).fetchSemanticsNodes().size)
    }
}
