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

@OptIn(ExperimentalTestApi::class)
class AppUiTest : ComposeUiTestBase() {
    private val zone = """{"id":"z1","name":"Home top","slug":"home-top","frame":{"id":"f1","type":"bar","settings":{}},
        "taleGroups":[{"id":"g1","name":"Summer trips","cover":null,"tales":[{"id":"t1","title":"Beach day"},{"id":"t2","title":"City night"}]},
        {"id":"g2","name":"Winter tales","cover":null,"tales":[{"id":"t3","title":"First snow"}]}]}"""
    private val saved = mapOf(
        DebugSettings.API_URL to "http://api.test",
        DebugSettings.SITE_KEY to "tas_key",
        DebugSettings.ZONE to "home-top",
    )
    private val requests = mutableListOf<HttpRequestData>()

    private fun client(status: HttpStatusCode, body: String) = DeliveryClient(
        HttpClient(MockEngine { request ->
            requests += request
            respond(body, status, headersOf(HttpHeaders.ContentType, "application/json"))
        }),
    )

    @Test
    fun showsTheTitleAndTheSdkVersion() = runComposeUiTest {
        setContent { App() }

        onNodeWithTag("title").assertIsDisplayed().assertTextEquals("TaleArt")
        onNodeWithTag("sdk-version").assertIsDisplayed().assertTextEquals("SDK ${TaleartSdk.VERSION}")
    }

    @Test
    fun opensTheSettingsUntilEveryFieldIsSetAndLoadsTheZoneFromThem() = runComposeUiTest {
        val store = InMemoryStore()
        setContent { App(store = store, client = client(HttpStatusCode.OK, zone)) }

        onNodeWithTag("load").assertIsNotEnabled()
        onNodeWithTag("site-key").performTextInput("tas_key")
        onNodeWithTag("zone").performTextInput("home-top")
        onNodeWithTag("load").performClick()

        waitUntil(timeoutMillis = 5_000) { onAllNodesWithTag("group").fetchSemanticsNodes().size == 2 }
        assertEquals("tas_key", store.get(DebugSettings.SITE_KEY))
        assertEquals("home-top", store.get(DebugSettings.ZONE))
        assertEquals("${defaultApiUrl()}/delivery/v1/zone?zone=home-top", requests.single().url.toString())
    }

    @Test
    fun listsTheGroupTitlesWithTheirTaleTitlesForASavedZone() = runComposeUiTest {
        setContent { App(store = InMemoryStore(saved), client = client(HttpStatusCode.OK, zone)) }

        waitUntil(timeoutMillis = 5_000) { onAllNodesWithTag("group").fetchSemanticsNodes().size == 2 }
        val texts = { tag: String ->
            onAllNodesWithTag(tag).fetchSemanticsNodes().map { node ->
                node.config.first { it.key.name == "Text" }.value.toString().trim('[', ']')
            }
        }
        assertEquals(listOf("Summer trips", "Winter tales"), texts("group"))
        assertEquals(listOf("Beach day", "City night", "First snow"), texts("tale"))
        assertEquals("Bearer tas_key", requests.single().headers[HttpHeaders.Authorization])
    }

    @Test
    fun showsTheZonesBarAboveTheListAndReportsATap() = runComposeUiTest {
        setContent { App(store = InMemoryStore(saved), client = client(HttpStatusCode.OK, zone)) }

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
        setContent { App(store = InMemoryStore(saved), client = client(HttpStatusCode.Unauthorized, refused)) }

        waitUntil(timeoutMillis = 5_000) { onAllNodesWithTag("error").fetchSemanticsNodes().isNotEmpty() }
        onNodeWithTag("error").assertTextEquals("Invalid site key or zone: A valid site key and zone are required")
    }
}
