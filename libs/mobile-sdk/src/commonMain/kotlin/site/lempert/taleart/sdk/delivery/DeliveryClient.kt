package site.lempert.taleart.sdk.delivery

import io.ktor.client.HttpClient
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpHeaders
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.completeWith
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlin.coroutines.cancellation.CancellationException

/** The Delivery API base path (AD-2), as `DELIVERY_API_BASE` in the contract. */
const val DELIVERY_PATH = "/delivery/v1"

/** An HTTP client on the platform's engine: OkHttp on Android, Darwin (NSURLSession) on iOS, never sending cookies. */
expect fun platformHttpClient(): HttpClient

/**
 * Reads zones from the Delivery API, as `fetchZone` in libs/web-sdk/src/lib/delivery-client.ts does:
 * `GET <apiUrl>/delivery/v1/zone?zone=<slug>` with the site key as a bearer token and never a cookie.
 *
 * Like the Web SDK it shares one request among callers that ask for the same zone with the same
 * key at the same time, and asks again once that request settles. Like a browser, it keeps the last
 * zone with its ETag and revalidates it with `If-None-Match`, so a 304 costs no body (NFR-006).
 * It never retries on its own: a [ZoneResult.RateLimited] carries `Retry-After` for the app to use.
 */
class DeliveryClient(
    private val httpClient: HttpClient = platformHttpClient(),
    dispatcher: CoroutineDispatcher = Dispatchers.Default,
) : AutoCloseable {
    // Runs the shared requests, so one caller leaving does not cancel the request for the others.
    private val scope = CoroutineScope(SupervisorJob() + dispatcher)
    private val lock = Mutex()
    private val inFlight = mutableMapOf<String, CompletableDeferred<RawResponse>>()
    private val etags = LinkedHashMap<String, CachedZone>()

    /**
     * Reads the zone [request] names from the Delivery API at [apiUrl]. Never throws for a refused
     * request or a network failure: those come back as a [ZoneResult.Failure].
     */
    suspend fun fetchZone(apiUrl: String, request: ZoneRequest): ZoneResult {
        val url = zoneUrl(apiUrl, request.zone)
        val id = "$url\n${request.key}"
        val (shared, started) = lock.withLock {
            inFlight[id]?.let { it to false }
                ?: CompletableDeferred<RawResponse>().also { inFlight[id] = it }.let { it to true }
        }
        if (started) {
            scope.launch {
                val result = runCatching { read(url, request.key, id) }
                // Leaves before it settles, so a later load asks the API again.
                lock.withLock { if (inFlight[id] === shared) inFlight.remove(id) }
                shared.completeWith(result)
            }
        }
        // Each caller parses its own copy, so no caller can change what another renders.
        return when (val res = shared.await()) {
            is RawResponse.Unreachable -> ZoneResult.Offline(
                "Could not reach the TaleArt API: ${res.cause.message ?: res.cause.toString()}",
                res.cause,
            )
            is RawResponse.Answered -> interpret(res)
        }
    }

    override fun close() {
        scope.cancel()
        httpClient.close()
    }

    private suspend fun read(url: String, key: String, id: String): RawResponse {
        val cached = lock.withLock { etags[id] }
        val response = try {
            httpClient.get(url) {
                header(HttpHeaders.Authorization, "Bearer $key")
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
        // A 304 means the copy we hold is current: read it as the zone the API would have sent.
        if (status == 304 && cached != null) return RawResponse.Answered(200, cached.text, retryAfter)
        val etag = response.headers[HttpHeaders.ETag]
        lock.withLock {
            etags.remove(id)
            if (status == 200 && etag != null) {
                etags[id] = CachedZone(etag, text)
                while (etags.size > MAX_CACHED_ZONES) etags.remove(etags.keys.first())
            }
        }
        return RawResponse.Answered(status, text, retryAfter)
    }

    private fun interpret(res: RawResponse.Answered): ZoneResult {
        val body = try {
            json.parseToJsonElement(res.text)
        } catch (_: Exception) {
            // Not JSON: an HTML fallback page or an empty body.
            null
        }
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
        val zone = body?.takeIf(::isZone)?.let {
            try {
                json.decodeFromJsonElement(DeliveryZone.serializer(), it)
            } catch (_: Exception) {
                null
            }
        } ?: return ZoneResult.InvalidResponse("The TaleArt API sent a response that is not a zone", res.status)
        return ZoneResult.Success(zone)
    }

    private sealed interface RawResponse {
        data class Answered(val status: Int, val text: String, val retryAfter: String?) : RawResponse
        data class Unreachable(val cause: Throwable) : RawResponse
    }

    private data class CachedZone(val etag: String, val text: String)

    companion object {
        private const val MAX_CACHED_ZONES = 32

        /** Ignores fields it does not know and reads a wrong-typed or null field as its default. */
        internal val json = Json {
            ignoreUnknownKeys = true
            coerceInputValues = true
            explicitNulls = false
        }

        /** `<apiUrl>/delivery/v1/zone?zone=<slug>`, without trailing slashes on the API URL. */
        fun zoneUrl(apiUrl: String, zone: String): String =
            "${apiUrl.trimEnd('/')}$DELIVERY_PATH/zone?zone=${encodeUriComponent(zone)}"
    }
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

private const val UNRESERVED = "-_.!~*'()"
private const val HEX = "0123456789ABCDEF"

// JavaScript's encodeURIComponent: UTF-8, percent-encoding all but letters, digits and -_.!~*'().
internal fun encodeUriComponent(value: String): String = buildString {
    for (byte in value.encodeToByteArray()) {
        val c = (byte.toInt() and 0xff)
        val ch = c.toChar()
        if (c < 0x80 && (ch.isLetterOrDigit() || ch in UNRESERVED)) {
            append(ch)
        } else {
            append('%').append(HEX[c shr 4]).append(HEX[c and 0x0f])
        }
    }
}
