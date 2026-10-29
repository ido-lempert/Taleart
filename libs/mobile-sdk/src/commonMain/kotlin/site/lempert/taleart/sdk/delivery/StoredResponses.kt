package site.lempert.taleart.sdk.delivery

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import site.lempert.taleart.sdk.storage.KeyValueStore

/** The key the visitor's own answers are kept under in the SDK's store (`taleart.responses`, as in the Web SDK). */
internal const val RESPONSES_STORAGE_KEY = "taleart.responses"

/** The most answers kept; past it the oldest is forgotten (`MAX_STORED_RESPONSES`). */
internal const val MAX_STORED_RESPONSES = 200

// `tale:element`, the key of one answer.
private fun storageKey(taleId: String, elementId: String) = "$taleId:$elementId"

// All kept answers, read with each entry checked; anything unreadable (not JSON, not an object, a
// broken entry) is dropped, so a damaged store never breaks a tale.
private fun readAll(store: KeyValueStore?): Map<String, JsonObject> {
    val raw = try {
        store?.get(RESPONSES_STORAGE_KEY)
    } catch (_: Throwable) {
        null
    } ?: return emptyMap()
    val root = try {
        Json.parseToJsonElement(raw) as? JsonObject
    } catch (_: Throwable) {
        null
    } ?: return emptyMap()
    return root.entries.mapNotNull { (key, value) -> (value as? JsonObject)?.let { key to it } }.toMap()
}

/** The answer this visitor gave the element of the tale on this device, or null. */
internal fun storedResponse(store: KeyValueStore?, taleId: String, elementId: String): StoredResponse? {
    val kept = readAll(store)[storageKey(taleId, elementId)] ?: return null
    val value = (kept["v"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: return null
    val result = parseResponseResult(kept["r"]) ?: return null
    return StoredResponse(value, result)
}

/** Keeps the answer on this device, forgetting the oldest past [MAX_STORED_RESPONSES]; a full or blocked store keeps nothing. */
internal fun keepResponse(store: KeyValueStore?, taleId: String, elementId: String, response: StoredResponse, nowMillis: Long) {
    if (store == null) return
    val all = readAll(store).toMutableMap()
    all[storageKey(taleId, elementId)] = JsonObject(
        mapOf(
            "v" to JsonPrimitive(response.value),
            "r" to responseResultJson(response.result),
            "t" to JsonPrimitive(nowMillis),
        ),
    )
    val oldestFirst = all.keys.sortedBy { all.getValue(it)["t"]?.jsonPrimitive?.longOrNull ?: 0L }
    for (key in oldestFirst.take((all.size - MAX_STORED_RESPONSES).coerceAtLeast(0))) all.remove(key)
    try {
        store.set(RESPONSES_STORAGE_KEY, JsonObject(all).toString())
    } catch (_: Throwable) {
        // A full or blocked store: the answer shows until the app is left.
    }
}
