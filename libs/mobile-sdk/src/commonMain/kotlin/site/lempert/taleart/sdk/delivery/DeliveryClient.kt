package site.lempert.taleart.sdk.delivery

import io.ktor.client.HttpClient
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.contentType
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import site.lempert.taleart.sdk.storage.KeyValueStore
import site.lempert.taleart.sdk.storage.deviceKeyValueStoreOrNull

/** The Delivery API base path (AD-2), as `DELIVERY_API_BASE` in the contract. */
const val DELIVERY_PATH = "/delivery/v1"

/** An HTTP client on the platform's engine: OkHttp on Android, Darwin (NSURLSession) on iOS, never sending cookies. */
expect fun platformHttpClient(): HttpClient

/**
 * Reads zones from the Delivery API, as `fetchZone` in libs/web-sdk/src/lib/delivery-client.ts does:
 * `GET <apiUrl>/delivery/v1/zone` with the zone key as a bearer token and never a cookie,
 * and the device's visitor id in `X-TaleArt-Visitor` (epic UX rework 8.23). The id is a random UUID
 * v4 kept in [visitorStore] (by default the SDK's own device store, where the seen tale groups are),
 * so it lasts across app restarts; see `VisitorId` for what it is and how it is reset. On Android the
 * default store needs the app's Context: before any TaleArt composable has run, make the client with
 * `DeliveryClient(context)` or call `TaleartSdk.init(context)` once (in `Application.onCreate`), or
 * the first requests of a process carry an id that lasts only until the store opens.
 *
 * Like the Web SDK it shares one request among callers that ask for the same zone with the same
 * key at the same time, and asks again once that request settles. Like a browser, it keeps the last
 * zone with its ETag and revalidates it with `If-None-Match`, so a 304 costs no body (NFR-006).
 * It never retries on its own: a [ZoneResult.RateLimited] carries `Retry-After` for the app to use.
 * After [close], every read in progress and every later one answers [ZoneResult.Offline].
 */
class DeliveryClient(
    private val httpClient: HttpClient = platformHttpClient(),
    dispatcher: CoroutineDispatcher = Dispatchers.Default,
    visitorStore: () -> KeyValueStore? = ::deviceKeyValueStoreOrNull,
) : AutoCloseable {
    private val visitor = VisitorId(visitorStore)
    // Runs the shared requests, so one caller leaving does not cancel the request for the others.
    private val scope = CoroutineScope(SupervisorJob() + dispatcher)
    private val lock = Mutex()
    private val inFlight = mutableMapOf<String, CompletableDeferred<RawResponse>>()
    // The kept zones by URL and key, least recently used first.
    private val etags = LinkedHashMap<String, CachedZone>()

    /**
     * Reads the zone [request] names from the Delivery API at [apiUrl]. Never throws for a refused
     * request, a network failure or a closed client: those come back as a [ZoneResult.Failure].
     */
    suspend fun fetchZone(apiUrl: String, request: ZoneRequest): ZoneResult {
        if (!scope.isActive) return closedResult()
        val url = zoneUrl(apiUrl)
        val id = "$url\n${request.key}"
        val (shared, started) = lock.withLock {
            inFlight[id]?.let { it to false }
                ?: CompletableDeferred<RawResponse>().also { inFlight[id] = it }.let { it to true }
        }
        if (started) {
            // ATOMIC: the body runs even when close() comes first, so the shared answer always settles.
            scope.launch(start = CoroutineStart.ATOMIC) {
                val raw = try {
                    read(url, request.key, id)
                } catch (e: CancellationException) {
                    // close() cancelled the read; the callers still get an answer.
                    RawResponse.Closed
                } catch (e: Throwable) {
                    RawResponse.Unreachable(e)
                }
                // Leaves before it settles, so a later load asks the API again.
                withContext(NonCancellable) { lock.withLock { if (inFlight[id] === shared) inFlight.remove(id) } }
                shared.complete(raw)
                currentCoroutineContext().ensureActive()
            }
        }
        // Each caller parses its own copy, so no caller can change what another renders.
        return when (val res = shared.await()) {
            RawResponse.Closed -> closedResult()
            is RawResponse.Unreachable -> ZoneResult.Offline(
                "Could not reach the TaleArt API: ${res.cause.message ?: res.cause.toString()}",
                res.cause,
            )
            is RawResponse.Answered -> interpret(res)
        }
    }

    /**
     * Posts one batch of analytics events to `<apiUrl>/delivery/v1/events` (the body is built by
     * `analyticsBody`), with the zone key as the bearer token and the visitor id header. True when the
     * API accepted it; a refusal, a network failure or a closed client is false, and never thrown.
     */
    internal suspend fun postAnalytics(apiUrl: String, key: String, body: String): Boolean {
        if (!scope.isActive) return false
        val visitorId = lock.withLock { visitor.current() }
        return try {
            val response = httpClient.post("${apiUrl.trimEnd('/')}$DELIVERY_PATH/events") {
                header(HttpHeaders.Authorization, "Bearer $key")
                header(VISITOR_HEADER, visitorId)
                contentType(ContentType.Application.Json)
                setBody(body)
            }
            response.status.value in 200..299
        } catch (e: CancellationException) {
            throw e
        } catch (_: Throwable) {
            false
        }
    }

    /** Stops every read in progress (each answers [ZoneResult.Offline]) and closes the HTTP client. */
    override fun close() {
        scope.cancel()
        httpClient.close()
    }

    private fun closedResult() = ZoneResult.Offline(CLOSED_MESSAGE, null)

    private suspend fun read(url: String, key: String, id: String): RawResponse {
        val (cached, visitorId) = lock.withLock { etags[id] to visitor.current() }
        val response = try {
            httpClient.get(url) {
                header(HttpHeaders.Authorization, "Bearer $key")
                header(VISITOR_HEADER, visitorId)
                if (cached != null) header(HttpHeaders.IfNoneMatch, cached.etag)
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Throwable) {
            return RawResponse.Unreachable(e)
        }
        val status = response.status.value
        val text = try {
            response.bodyAsText()
        } catch (e: CancellationException) {
            throw e
        } catch (_: Throwable) {
            ""
        }
        val retryAfter = response.headers[HttpHeaders.RetryAfter]
        if (status == 304 && cached != null) {
            // The copy we hold is current: it becomes the most recently used, and reads as the zone
            // the API would have sent.
            lock.withLock {
                etags.remove(id)
                etags[id] = cached
            }
            return RawResponse.Answered(200, cached.text, retryAfter)
        }
        val etag = response.headers[HttpHeaders.ETag]
        // Only a zone is kept: an HTML page or a partial body with an ETag is never revalidated.
        val keep = status == 200 && etag != null && parseOrNull(text)?.let(::isZone) == true
        lock.withLock {
            etags.remove(id)
            if (keep) {
                etags[id] = CachedZone(etag!!, text)
                while (etags.size > MAX_CACHED_ZONES) etags.remove(etags.keys.first())
            }
        }
        return RawResponse.Answered(status, text, retryAfter)
    }

    private fun interpret(res: RawResponse.Answered): ZoneResult {
        // Null when it is not JSON: an HTML fallback page or an empty body.
        val body = parseOrNull(res.text)
        if (res.status !in 200..299) {
            val error = (body as? JsonObject)?.get("error") as? JsonObject
            val code = (error?.get("code") as? JsonPrimitive)?.takeIf { it.isString }?.content
            val message = (error?.get("message") as? JsonPrimitive)?.takeIf { it.isString }?.content
                ?: "The TaleArt API answered ${res.status}"
            return when (res.status) {
                401 -> ZoneResult.InvalidSiteKey(message)
                404 -> ZoneResult.UnknownZone(message, code)
                429 -> ZoneResult.RateLimited(message, retryAfterSeconds(res.retryAfter))
                else -> ZoneResult.ServerError(message, res.status, code)
            }
        }
        if (body !is JsonObject || !isZone(body)) {
            return ZoneResult.InvalidResponse("The TaleArt API sent a response that is not a zone", res.status)
        }
        return ZoneResult.Success(readZone(body))
    }

    private sealed interface RawResponse {
        data class Answered(val status: Int, val text: String, val retryAfter: String?) : RawResponse
        data class Unreachable(val cause: Throwable) : RawResponse
        data object Closed : RawResponse
    }

    private data class CachedZone(val etag: String, val text: String)

    companion object {
        private const val MAX_CACHED_ZONES = 32

        /** The message of every read in progress when the client closed, and of every read after. */
        const val CLOSED_MESSAGE = "The TaleArt client is closed"

        /** `<apiUrl>/delivery/v1/zone`, without trailing slashes on the API URL: the zone is named by its key. */
        fun zoneUrl(apiUrl: String): String = "${apiUrl.trimEnd('/')}$DELIVERY_PATH/zone"
    }
}

private fun parseOrNull(text: String): JsonElement? = try {
    Json.parseToJsonElement(text)
} catch (_: Exception) {
    null
}

// The whole seconds of a `Retry-After` header; null when it is missing or an HTTP date (the API sends seconds).
internal fun retryAfterSeconds(header: String?): Long? = header?.trim()?.toLongOrNull()?.takeIf { it >= 0 }

// True for the shape the renderers rely on, as `isZone` in the Web SDK: an object with a `frame`
// that is an object or null, and `taleGroups`, a list of objects each with a `tales` list.
internal fun isZone(body: JsonElement): Boolean {
    if (body !is JsonObject) return false
    val frame = body["frame"] ?: return false
    if (frame !is JsonObject && frame !is JsonNull) return false
    val groups = body["taleGroups"] as? JsonArray ?: return false
    return groups.all { group -> group is JsonObject && group["tales"] is JsonArray }
}
