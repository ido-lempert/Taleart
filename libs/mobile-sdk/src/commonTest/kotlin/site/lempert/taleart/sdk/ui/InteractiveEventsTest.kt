package site.lempert.taleart.sdk.ui

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import site.lempert.taleart.sdk.ComponentRef
import site.lempert.taleart.sdk.TaleRef
import site.lempert.taleart.sdk.TaleartEvent
import site.lempert.taleart.sdk.TaleartListener
import site.lempert.taleart.sdk.GroupRef
import site.lempert.taleart.sdk.delivery.ChoiceCount
import site.lempert.taleart.sdk.delivery.ChoiceResult
import site.lempert.taleart.sdk.delivery.DeliveryClient
import site.lempert.taleart.sdk.delivery.ResponseOutcome
import site.lempert.taleart.sdk.delivery.StoredResponse
import site.lempert.taleart.sdk.delivery.storedResponse
import site.lempert.taleart.sdk.i18n.defaultTranslate
import site.lempert.taleart.sdk.storage.InMemoryKeyValueStore
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

// The viewer's responder (TaleResponder): an accepted answer is kept on the device and reported once to
// `userInteracted` and once to `componentEvent` (`selected`), through the listeners and `onEvent`; a
// refused answer reports nothing and keeps nothing.
class InteractiveEventsTest {
    private val api = "http://localhost:3592"
    private val key = "tak_testkey"
    private val taleId = "11111111-1111-4111-8111-111111111111"
    private val elementId = "22222222-2222-4222-8222-222222222222"
    private val group = GroupRef("g1", "News", 0)
    private val tale = TaleRef(taleId, 0, "Poll tale")

    private fun TestScope.client(status: HttpStatusCode, body: String): DeliveryClient = DeliveryClient(
        HttpClient(MockEngine { respond(body, status, headersOf(HttpHeaders.ContentType to listOf("application/json"))) }),
        StandardTestDispatcher(testScheduler),
        visitorStore = { InMemoryKeyValueStore() },
    )

    private val accepted = """{"elementId":"$elementId","value":"tea","recorded":true,"result":{"total":1,"choices":[{"id":"tea","count":1,"percent":100},{"id":"coffee","count":0,"percent":0}]}}"""

    private class Heard(val events: MutableList<String> = mutableListOf()) : TaleartListener {
        val interacted = mutableListOf<TaleartEvent>()
        val components = mutableListOf<TaleartEvent>()
        override fun onUserInteracted(event: TaleartEvent) {
            interacted += event
            events += "userInteracted"
        }
        override fun onComponentEvent(event: TaleartEvent) {
            components += event
            events += "componentEvent"
        }
        override fun onEvent(event: TaleartEvent) {
            events += "onEvent:${event.name}"
        }
    }

    private fun responder(client: DeliveryClient, heard: Heard, store: InMemoryKeyValueStore, current: CurrentTale? = CurrentTale(group, tale)) =
        TaleResponder(
            ZoneResponses(api, key, client),
            TaleartContext(defaultTranslate, heard, "tak_test1", "home-top"),
            { current },
            { store },
        )

    @Test
    fun anAcceptedAnswerIsKeptAndReportedOnceToBothEvents() = runTest {
        val heard = Heard()
        val store = InMemoryKeyValueStore()
        val outcome = responder(client(HttpStatusCode.Created, accepted), heard, store)
            .send(ComponentRef(elementId, "poll"), "tea")
        assertIs<ResponseOutcome.Answered>(outcome)
        assertEquals(listOf("userInteracted", "onEvent:userInteracted", "componentEvent", "onEvent:componentEvent"), heard.events)
        val interacted = heard.interacted.single()
        assertEquals("userInteracted", interacted.name)
        assertEquals(ComponentRef(elementId, "poll", "tea"), interacted.component)
        assertEquals(group, interacted.group)
        assertEquals(tale, interacted.tale)
        val selected = heard.components.single()
        assertEquals("selected", selected.action)
        assertEquals(ComponentRef(elementId, "poll", "tea"), selected.component)
        assertEquals(StoredResponse("tea", ChoiceResult(1, listOf(ChoiceCount("tea", 1, 100), ChoiceCount("coffee", 0, 0)))), storedResponse(store, taleId, elementId))
    }

    @Test
    fun aRefusedAnswerReportsNothingAndKeepsNothing() = runTest {
        val heard = Heard()
        val store = InMemoryKeyValueStore()
        val outcome = responder(client(HttpStatusCode.UnprocessableEntity, """{"error":{"code":"validation_failed","message":"no"}}"""), heard, store)
            .send(ComponentRef(elementId, "poll"), "gone")
        assertIs<ResponseOutcome.Failed>(outcome)
        assertTrue(heard.events.isEmpty())
        assertNull(storedResponse(store, taleId, elementId))
    }

    @Test
    fun noTaleOnScreenSendsNothing() = runTest {
        val heard = Heard()
        val outcome = responder(client(HttpStatusCode.Created, accepted), heard, InMemoryKeyValueStore(), current = null)
            .send(ComponentRef(elementId, "poll"), "tea")
        assertIs<ResponseOutcome.Failed>(outcome)
        assertTrue(heard.events.isEmpty())
    }
}
