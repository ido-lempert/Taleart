package site.lempert.taleart.sdk.ui

import androidx.compose.foundation.text.BasicText
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.v2.runComposeUiTest
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpStatusCode
import site.lempert.taleart.sdk.FallbackMode
import site.lempert.taleart.sdk.TaleartConfig
import site.lempert.taleart.sdk.TaleartSdk
import site.lempert.taleart.sdk.delivery.DeliveryClient
import site.lempert.taleart.sdk.storage.InMemoryKeyValueStore
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

// A zone whose read fails: the placeholder of `TaleartConfig.fallback` (the message and a retry button),
// the host's own placeholder over it, and nothing with the default `None`.
@OptIn(ExperimentalTestApi::class)
class FallbackUiTest : ComposeUiTestBase() {
    private val api = "http://api.test"
    private val key = "tak_key"
    private val message = "Stories could not be loaded."
    private val requests = mutableListOf<String>()

    @AfterTest
    fun resetSdk() {
        TaleartSdk.init(TaleartConfig())
    }

    private fun failing() = DeliveryClient(
        HttpClient(MockEngine { request ->
            requests += request.url.toString()
            respond("", HttpStatusCode.InternalServerError)
        }),
        visitorStore = { InMemoryKeyValueStore() },
    )

    @Test
    fun aMessageFallbackShowsTheTextAndItsRetryButtonReadsTheZoneAgain() = runComposeUiTest {
        TaleartSdk.init(TaleartConfig(fallback = FallbackMode.Message))
        setContent { TaleartZone(api, key, client = failing(), seenGroups = SeenGroups(InMemoryKeyValueStore())) }

        waitUntil("the message", 5_000) { onAllNodesWithText(message).fetchSemanticsNodes().isNotEmpty() }
        assertEquals(1, requests.size)
        onNodeWithText("Try again").performClick()
        waitUntil("the second read", 5_000) { requests.size == 2 }
        waitUntil("the message again", 5_000) { onAllNodesWithText(message).fetchSemanticsNodes().isNotEmpty() }
    }

    @Test
    fun withTheDefaultNothingIsShownWhenTheReadFails() = runComposeUiTest {
        setContent { TaleartZone(api, key, client = failing(), seenGroups = SeenGroups(InMemoryKeyValueStore())) }

        waitUntil("the failed read", 5_000) { requests.isNotEmpty() }
        waitForIdle()
        assertTrue(onAllNodesWithText(message).fetchSemanticsNodes().isEmpty())
        assertTrue(onAllNodesWithText("Try again").fetchSemanticsNodes().isEmpty())
    }

    @Test
    fun aHostsPlaceholderIsShownInPlaceOfTheSdkMessage() = runComposeUiTest {
        TaleartSdk.init(TaleartConfig(fallback = FallbackMode.Message))
        setContent {
            TaleartZone(
                api,
                key,
                client = failing(),
                seenGroups = SeenGroups(InMemoryKeyValueStore()),
                fallback = { BasicText("Host placeholder") },
            )
        }

        waitUntil("the host placeholder", 5_000) { onAllNodesWithText("Host placeholder").fetchSemanticsNodes().isNotEmpty() }
        assertTrue(onAllNodesWithText(message).fetchSemanticsNodes().isEmpty())
    }
}
