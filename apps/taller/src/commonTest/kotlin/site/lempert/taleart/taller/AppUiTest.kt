package site.lempert.taleart.taller

import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.v2.runComposeUiTest
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.HttpRequestData
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import site.lempert.taleart.sdk.TaleartSdk
import site.lempert.taleart.sdk.delivery.DeliveryClient
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import site.lempert.taleart.sdk.ui.BAR_ITEM_TAG
import site.lempert.taleart.sdk.ui.SeenGroups

@OptIn(ExperimentalTestApi::class)
class AppUiTest : ComposeUiTestBase() {
    private val zone = """{"id":"z1","name":"Home top","slug":"home-top","frame":{"id":"f1","type":"bar","settings":{}},
        "taleGroups":[{"id":"g1","name":"Summer trips","cover":null,"tales":[{"id":"t1","title":"Beach day"},{"id":"t2","title":"City night"}]},
        {"id":"g2","name":"Winter tales","cover":null,"tales":[{"id":"t3","title":"First snow"}]}]}"""
    private val saved = mapOf(
        DebugSettings.API_URL to "http://api.test",
        DebugSettings.ZONE_KEY to "tak_key",
    )
    private val requests = mutableListOf<HttpRequestData>()
    // Seen groups in memory, so no test reads or leaves seen state on the device.
    private val seen = SeenGroups(InMemoryStore())
    private fun isolatedSeen() = seen

    private fun client(status: HttpStatusCode, body: String) = DeliveryClient(
        HttpClient(MockEngine { request ->
            requests += request
            respond(body, status, headersOf(HttpHeaders.ContentType, "application/json"))
        }),
    )

    @Test
    fun showsTheTitleAndTheSdkVersion() = runComposeUiTest {
        setContent { App(seenGroups = isolatedSeen()) }

        onNodeWithTag("title").assertIsDisplayed().assertTextEquals("TaleArt")
        onNodeWithTag("sdk-version").assertIsDisplayed().assertTextEquals("SDK ${TaleartSdk.VERSION}")
    }

    @Test
    fun opensTheSettingsUntilEveryFieldIsSetAndLoadsTheZoneFromThem() = runComposeUiTest {
        val store = InMemoryStore()
        setContent { App(store = store, client = client(HttpStatusCode.OK, zone), seenGroups = isolatedSeen()) }

        onNodeWithTag("load").assertIsNotEnabled()
        onNodeWithTag("zone-key").performTextInput("tak_key")
        onNodeWithTag("load").performClick()

        waitUntil(timeoutMillis = 5_000) { onAllNodesWithTag("group").fetchSemanticsNodes().size == 2 }
        assertEquals("tak_key", store.get(DebugSettings.ZONE_KEY))
        assertEquals("${defaultApiUrl()}/delivery/v1/zone", requests.single().url.toString())
    }

    @Test
    fun listsTheGroupTitlesWithTheirTaleTitlesForASavedZone() = runComposeUiTest {
        setContent { App(store = InMemoryStore(saved), client = client(HttpStatusCode.OK, zone), seenGroups = isolatedSeen()) }

        waitUntil(timeoutMillis = 5_000) { onAllNodesWithTag("group").fetchSemanticsNodes().size == 2 }
        val texts = { tag: String ->
            onAllNodesWithTag(tag).fetchSemanticsNodes().map { node ->
                node.config.first { it.key.name == "Text" }.value.toString().trim('[', ']')
            }
        }
        assertEquals(listOf("Summer trips", "Winter tales"), texts("group"))
        assertEquals(listOf("Beach day", "City night", "First snow"), texts("tale"))
        assertEquals("Bearer tak_key", requests.single().headers[HttpHeaders.Authorization])
    }

    @Test
    fun showsTheZonesBarAboveTheListAndReportsATap() = runComposeUiTest {
        setContent { App(store = InMemoryStore(saved), client = client(HttpStatusCode.OK, zone), seenGroups = isolatedSeen()) }

        waitUntil(timeoutMillis = 5_000) { onAllNodesWithTag(BAR_ITEM_TAG).fetchSemanticsNodes().size == 2 }
        val barTop = onNodeWithTag("zone-display").fetchSemanticsNode().boundsInRoot.top
        val listTop = onNodeWithTag("groups").fetchSemanticsNode().boundsInRoot.top
        assertTrue(barTop < listTop)
        onAllNodesWithTag(BAR_ITEM_TAG)[1].performClick()
        onNodeWithTag("tapped").assertTextEquals("Tapped: Winter tales")
    }

    @Test
    fun showsTheTypedErrorOfARefusedKey() = runComposeUiTest {
        val refused = """{"error":{"code":"invalid_site_key","message":"A valid site key and zone are required"}}"""
        setContent { App(store = InMemoryStore(saved), client = client(HttpStatusCode.Unauthorized, refused), seenGroups = isolatedSeen()) }

        waitUntil(timeoutMillis = 5_000) { onAllNodesWithTag("error").fetchSemanticsNodes().isNotEmpty() }
        onNodeWithTag("error").assertTextEquals("Invalid site key or zone: A valid site key and zone are required")
    }
}
