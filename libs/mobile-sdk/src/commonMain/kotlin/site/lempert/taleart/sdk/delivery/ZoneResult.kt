package site.lempert.taleart.sdk.delivery

/**
 * How an app names its zone: the project's site key with the zone's slug (epic UX rework R3),
 * as `ZoneRequest` in the Web SDK.
 */
data class ZoneRequest(
    /** The project's site key (`tas_...`). */
    val key: String,
    /** The zone's slug. */
    val zone: String,
)

/**
 * The outcome of reading a zone: the zone, or a typed failure. Every failure carries the message
 * the Web SDK logs for it (the API's own message when it sent one), so both SDKs say the same thing.
 */
sealed interface ZoneResult {
    /** The zone, read and checked. */
    data class Success(val zone: DeliveryZone) : ZoneResult

    /** A refused or failed read. */
    sealed interface Failure : ZoneResult {
        val message: String
    }

    /**
     * 401 `invalid_site_key`: a missing, unknown or revoked site key. The Delivery API answers an
     * unknown or missing slug the same way on purpose, so a caller cannot tell a slug from a key:
     * against the current API an unknown zone arrives here.
     */
    data class InvalidSiteKey(override val message: String) : Failure

    /**
     * 404 (such as `zone_not_found`): the zone is unknown. The current Delivery API never sends it
     * (see [InvalidSiteKey]); it is kept apart for a server or proxy that does.
     */
    data class UnknownZone(override val message: String, val code: String?) : Failure

    /** 429 `rate_limited`, with the `Retry-After` seconds when the API sent them. */
    data class RateLimited(override val message: String, val retryAfterSeconds: Long?) : Failure

    /** The API could not be reached: no network, a refused connection, a broken response. */
    data class Offline(override val message: String, val cause: Throwable?) : Failure

    /** Any other error status, such as a 500, with the API's error code when it sent one. */
    data class ServerError(override val message: String, val status: Int, val code: String?) : Failure

    /** A success status whose body is not a zone, such as an HTML fallback page or a partial body. */
    data class InvalidResponse(override val message: String, val status: Int) : Failure
}
