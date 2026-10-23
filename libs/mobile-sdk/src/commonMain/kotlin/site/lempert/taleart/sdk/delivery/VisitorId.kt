package site.lempert.taleart.sdk.delivery

import kotlin.uuid.Uuid
import site.lempert.taleart.sdk.storage.KeyValueStore

/** The key the device's visitor id is kept under in the SDK's store, as in the Web SDK. */
const val VISITOR_STORAGE_KEY = "taleart.visitor"

/** The header every Delivery API request sends the visitor id in (epic UX rework 8.23). */
const val VISITOR_HEADER = "X-TaleArt-Visitor"

private val UUID_V4 = Regex("^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")

/** True for a UUID v4 in lowercase, the form the SDKs make. */
internal fun isVisitorId(value: String): Boolean = UUID_V4.matches(value)

/** A random UUID v4 from the platform's secure random generator, in lowercase. */
internal fun newVisitorId(): String = Uuid.random().toString()

/**
 * The device's visitor id: a random UUID v4 made once and kept in [store] under
 * [VISITOR_STORAGE_KEY], with no personal data in it. It goes only to the Delivery API, which limits
 * requests per visitor; reinstalling the app or clearing its data makes a new one. While [store]
 * gives no store (or it fails), the id lasts this process, and it is kept once a store is there.
 * Not thread-safe: [DeliveryClient] reads it under its lock.
 */
internal class VisitorId(private val store: () -> KeyValueStore?) {
    private var id: String? = null
    private var kept = false

    fun current(): String {
        id?.takeIf { kept }?.let { return it }
        val device = try {
            store()
        } catch (_: Throwable) {
            null
        }
        if (device != null) {
            val stored = try {
                device.get(VISITOR_STORAGE_KEY)
            } catch (_: Throwable) {
                null
            }
            if (stored != null && isVisitorId(stored)) {
                kept = true
                return stored.also { id = it }
            }
            val made = id ?: newVisitorId()
            id = made
            kept = try {
                device.set(VISITOR_STORAGE_KEY, made)
                true
            } catch (_: Throwable) {
                false
            }
            return made
        }
        return id ?: newVisitorId().also { id = it }
    }
}
