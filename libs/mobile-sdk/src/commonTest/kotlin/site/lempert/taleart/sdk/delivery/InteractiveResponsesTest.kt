package site.lempert.taleart.sdk.delivery

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.MockRequestHandleScope
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.HttpRequestData
import io.ktor.client.request.HttpResponseData
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.OutgoingContent
import io.ktor.http.headersOf
import kotlinx.io.IOException
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import site.lempert.taleart.sdk.storage.InMemoryKeyValueStore
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

// The responses client against a fake server (`POST /delivery/v1/responses`, libs/contract/openapi): the
// request it sends, each answer it reads, the refusals it reports, and the answers kept on the device.
class InteractiveResponsesTest {
    private val api = "http://localhost:3592"
    private val key = "tak_testkey"
    private val taleId = "11111111-1111-4111-8111-111111111111"
    private val elementId = "22222222-2222-4222-8222-222222222222"
    private val requests = mutableListOf<HttpRequestData>()

    private fun TestScope.client(handler: suspend MockRequestHandleScope.(HttpRequestData) -> HttpResponseData): DeliveryClient {
        val engine = MockEngine { request ->
            requests += request
            handler(request)
        }
        return DeliveryClient(HttpClient(engine), StandardTestDispatcher(testScheduler), visitorStore = { InMemoryKeyValueStore() })
    }

    private fun MockRequestHandleScope.json(body: String, status: HttpStatusCode = HttpStatusCode.Created) = respond(
        body,
        status,
        headersOf(HttpHeaders.ContentType to listOf("application/json")),
    )

    private fun answer(value: String, recorded: Boolean, result: String) =
        """{"elementId":"$elementId","value":"$value","recorded":$recorded,"result":$result}"""

    private val choiceResult = """{"total":3,"choices":[{"id":"tea","count":2,"percent":67},{"id":"coffee","count":1,"percent":33}]}"""

    @Test
    fun postsTheAnswerWithTheKeyAsABearerTokenAndTheVisitorHeader() = runTest {
        val c = client { json(answer("tea", true, choiceResult)) }
        val outcome = c.postResponse(api, key, taleId, elementId, "tea")
        assertIs<ResponseOutcome.Answered>(outcome)
        assertEquals(1, requests.size)
        val request = requests.single()
        assertEquals("$api/delivery/v1/responses", request.url.toString())
        assertEquals("POST", request.method.value)
        assertEquals("Bearer $key", request.headers[HttpHeaders.Authorization])
        assertTrue(request.headers[VISITOR_HEADER]!!.matches(Regex("^[0-9a-f-]{36}$")))
        val sent = (request.body as OutgoingContent.ByteArrayContent).bytes().decodeToString()
        val body = Json.parseToJsonElement(sent).jsonObject
        assertEquals(setOf("taleId", "elementId", "value", "clientAt"), body.keys)
        assertEquals("tea", body["value"]!!.jsonPrimitive.content)
        assertEquals(taleId, body["taleId"]!!.jsonPrimitive.content)
    }

    @Test
    fun aRecordedPollAnswerIsReadWithItsCounts() = runTest {
        val outcome = client { json(answer("tea", true, choiceResult)) }.postResponse(api, key, taleId, elementId, "tea")
        val answered = assertIs<ResponseOutcome.Answered>(outcome).response
        assertTrue(answered.recorded)
        assertEquals("tea", answered.value)
        val result = assertIs<ChoiceResult>(answered.result)
        assertEquals(3, result.total)
        assertEquals(listOf(ChoiceCount("tea", 2, 67), ChoiceCount("coffee", 1, 33)), result.choices)
    }

    @Test
    fun aRepeatAnswersWithTheFirstStoredValueAndNotRecorded() = runTest {
        val outcome = client { json(answer("coffee", false, choiceResult), HttpStatusCode.OK) }.postResponse(api, key, taleId, elementId, "tea")
        val answered = assertIs<ResponseOutcome.Answered>(outcome).response
        assertFalse(answered.recorded)
        assertEquals("coffee", answered.value)
    }

    @Test
    fun aRatingAndAReactionAreReadAsTheirOwnResults() = runTest {
        val rating = client { json(answer("80", true, """{"total":4,"average":72}""")) }.postResponse(api, key, taleId, elementId, "80")
        assertEquals(RatingResult(4, 72), assertIs<ResponseOutcome.Answered>(rating).response.result)
        val reaction = client { json(answer("😂", true, """{"total":2,"reactions":[{"emoji":"😂","count":2},{"emoji":"❤️","count":0}]}""")) }
            .postResponse(api, key, taleId, elementId, "😂")
        assertEquals(
            ReactionResult(2, listOf(ReactionCount("😂", 2), ReactionCount("❤️", 0))),
            assertIs<ResponseOutcome.Answered>(reaction).response.result,
        )
    }

    @Test
    fun aResultOfNoKindOrAnOutOfRangeCountIsAFailure() = runTest {
        val broken = client { json("""{"elementId":"$elementId","value":"tea","recorded":true,"result":{"total":1,"average":180}}""") }
            .postResponse(api, key, taleId, elementId, "tea")
        val failed = assertIs<ResponseOutcome.Failed>(broken)
        assertEquals(201, failed.status)
    }

    @Test
    fun aRefusalCarriesTheAPIsMessageAndStatus() = runTest {
        val refused = client {
            json("""{"error":{"code":"validation_failed","message":"The value is not an option of the poll"}}""", HttpStatusCode.UnprocessableEntity)
        }.postResponse(api, key, taleId, elementId, "gone")
        val failed = assertIs<ResponseOutcome.Failed>(refused)
        assertEquals("The value is not an option of the poll", failed.message)
        assertEquals(422, failed.status)
    }

    @Test
    fun aRefusedTargetCarriesItsStatusWithoutAMessageFromTheBody() = runTest {
        val refused = client { json("<html>gateway</html>", HttpStatusCode.NotFound) }.postResponse(api, key, taleId, elementId, "tea")
        val failed = assertIs<ResponseOutcome.Failed>(refused)
        assertEquals("The TaleArt API answered 404", failed.message)
        assertEquals(404, failed.status)
    }

    @Test
    fun aNetworkFailureIsAFailureWithoutAStatus() = runTest {
        val unreachable = client { throw IOException("offline") }.postResponse(api, key, taleId, elementId, "tea")
        val failed = assertIs<ResponseOutcome.Failed>(unreachable)
        assertNull(failed.status)
        assertTrue(failed.message.startsWith("Could not reach the TaleArt API"))
    }

    @Test
    fun aClosedClientAnswersAFailureWithoutSending() = runTest {
        val c = client { json(answer("tea", true, choiceResult)) }
        c.close()
        assertIs<ResponseOutcome.Failed>(c.postResponse(api, key, taleId, elementId, "tea"))
        assertTrue(requests.isEmpty())
    }

    // -- the answers kept on the device ---------------------------------------------------------

    private val poll = ChoiceResult(3, listOf(ChoiceCount("tea", 2, 67), ChoiceCount("coffee", 1, 33)))

    @Test
    fun aKeptAnswerIsReadBackWithItsResult() {
        val store = InMemoryKeyValueStore()
        keepResponse(store, taleId, elementId, StoredResponse("tea", poll), nowMillis = 1)
        assertEquals(StoredResponse("tea", poll), storedResponse(store, taleId, elementId))
        assertNull(storedResponse(store, taleId, "33333333-3333-4333-8333-333333333333"))
        assertNull(storedResponse(store, "44444444-4444-4444-8444-444444444444", elementId))
    }

    @Test
    fun aKeptRatingAndReactionAreReadBack() {
        val store = InMemoryKeyValueStore()
        keepResponse(store, taleId, "a", StoredResponse("80", RatingResult(4, 72)), nowMillis = 1)
        keepResponse(store, taleId, "b", StoredResponse("😂", ReactionResult(2, listOf(ReactionCount("😂", 2)))), nowMillis = 2)
        assertEquals(StoredResponse("80", RatingResult(4, 72)), storedResponse(store, taleId, "a"))
        assertEquals(StoredResponse("😂", ReactionResult(2, listOf(ReactionCount("😂", 2)))), storedResponse(store, taleId, "b"))
    }

    @Test
    fun theOldestAnswersAreForgottenPast200() {
        val store = InMemoryKeyValueStore()
        for (i in 0 until 201) keepResponse(store, taleId, "el-$i", StoredResponse("tea", poll), nowMillis = i.toLong())
        assertNull(storedResponse(store, taleId, "el-0"), "the oldest is forgotten")
        assertEquals(StoredResponse("tea", poll), storedResponse(store, taleId, "el-1"))
        assertEquals(StoredResponse("tea", poll), storedResponse(store, taleId, "el-200"))
    }

    @Test
    fun aDamagedStoreReadsAsNothingKept() {
        val store = InMemoryKeyValueStore(mapOf(RESPONSES_STORAGE_KEY to "not json"))
        assertNull(storedResponse(store, taleId, elementId))
        assertNull(storedResponse(null, taleId, elementId))
        keepResponse(store, taleId, elementId, StoredResponse("tea", poll), nowMillis = 1)
        assertEquals(StoredResponse("tea", poll), storedResponse(store, taleId, elementId))
    }
}
