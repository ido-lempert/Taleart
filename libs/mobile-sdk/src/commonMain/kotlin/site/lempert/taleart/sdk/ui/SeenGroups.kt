package site.lempert.taleart.sdk.ui

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import site.lempert.taleart.sdk.storage.KeyValueStore

/** The store key of the viewed tale group ids, as `SEEN_STORAGE_KEY` in the Web SDK. */
const val SEEN_STORAGE_KEY = "taleart.seen"

/** The most group ids remembered; the oldest go first (`SEEN_LIMIT` in the Web SDK). */
const val SEEN_LIMIT = 500

/**
 * The tale groups this device has viewed, as libs/web-sdk/src/lib/seen.ts keeps them: a JSON list of
 * ids, newest last, kept only on the device and never sent to TaleArt (AD-13). A missing or broken
 * value reads as nothing seen.
 */
class SeenGroups(private val store: KeyValueStore) {
    /** The ids of the groups viewed on this device. */
    fun ids(): Set<String> = readIds().toSet()

    /** Remembers that a tale group was viewed; newest last, capped at [SEEN_LIMIT]. */
    fun markSeen(id: String) {
        val ids = readIds().filter { it != id } + id
        try {
            store.set(SEEN_STORAGE_KEY, JsonArray(ids.takeLast(SEEN_LIMIT).map(::JsonPrimitive)).toString())
        } catch (_: Exception) {
            // Storage that refuses the write: the group just shows unseen next time.
        }
    }

    private fun readIds(): List<String> = try {
        val value = store.get(SEEN_STORAGE_KEY) ?: return emptyList()
        (Json.parseToJsonElement(value) as? JsonArray)
            ?.mapNotNull { (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content }
            .orEmpty()
    } catch (_: Exception) {
        emptyList()
    }
}
