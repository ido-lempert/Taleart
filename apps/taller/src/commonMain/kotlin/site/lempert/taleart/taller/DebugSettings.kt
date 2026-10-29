package site.lempert.taleart.taller

import site.lempert.taleart.sdk.storage.InMemoryKeyValueStore

/** The SDK's key-value storage on the device: SharedPreferences on Android, NSUserDefaults on iOS. */
typealias KeyValueStore = site.lempert.taleart.sdk.storage.KeyValueStore

/** A store kept in memory only, for previews and tests. */
typealias InMemoryStore = InMemoryKeyValueStore

/**
 * The API URL the debug settings start with: the host machine as the Android emulator
 * (10.0.2.2) or the iOS simulator (localhost) reaches it, on the API's default port.
 */
expect fun defaultApiUrl(): String

/** The API's default port (apps/api, PORT). */
const val DEFAULT_API_PORT = 3333

/** The zone Taller reads: the API URL and the zone's key (`tak_…`, issued in the dashboard). */
data class DebugSettings(val apiUrl: String, val zoneKey: String) {
    /** True when both fields are set, as the Web SDK waits until both are. */
    val complete: Boolean get() = apiUrl.isNotBlank() && zoneKey.isNotBlank()

    fun save(store: KeyValueStore) {
        store.set(API_URL, apiUrl.trim())
        store.set(ZONE_KEY, zoneKey.trim())
    }

    companion object {
        const val API_URL = "taller.apiUrl"
        const val ZONE_KEY = "taller.zoneKey"

        fun load(store: KeyValueStore): DebugSettings = DebugSettings(
            apiUrl = store.get(API_URL)?.takeIf { it.isNotBlank() } ?: defaultApiUrl(),
            zoneKey = store.get(ZONE_KEY).orEmpty(),
        )
    }
}
