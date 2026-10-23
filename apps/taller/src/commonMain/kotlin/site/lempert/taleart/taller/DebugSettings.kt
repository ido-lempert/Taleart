package site.lempert.taleart.taller

/** Simple key-value storage on the device: SharedPreferences on Android, NSUserDefaults on iOS. */
interface KeyValueStore {
    fun get(key: String): String?
    fun set(key: String, value: String)
}

/** A store kept in memory only, for previews and tests. */
class InMemoryStore(initial: Map<String, String> = emptyMap()) : KeyValueStore {
    private val values = initial.toMutableMap()
    override fun get(key: String): String? = values[key]
    override fun set(key: String, value: String) {
        values[key] = value
    }
}

/**
 * The API URL the debug settings start with: the host machine as the Android emulator
 * (10.0.2.2) or the iOS simulator (localhost) reaches it, on the API's default port.
 */
expect fun defaultApiUrl(): String

/** The API's default port (apps/api, PORT). */
const val DEFAULT_API_PORT = 3333

/** The zone Taller reads: the API URL, the project's site key and the zone's slug. */
data class DebugSettings(val apiUrl: String, val siteKey: String, val zone: String) {
    /** True when every field is set, as the Web SDK waits until all are. */
    val complete: Boolean get() = apiUrl.isNotBlank() && siteKey.isNotBlank() && zone.isNotBlank()

    fun save(store: KeyValueStore) {
        store.set(API_URL, apiUrl.trim())
        store.set(SITE_KEY, siteKey.trim())
        store.set(ZONE, zone.trim())
    }

    companion object {
        const val API_URL = "taller.apiUrl"
        const val SITE_KEY = "taller.siteKey"
        const val ZONE = "taller.zone"

        fun load(store: KeyValueStore): DebugSettings = DebugSettings(
            apiUrl = store.get(API_URL)?.takeIf { it.isNotBlank() } ?: defaultApiUrl(),
            siteKey = store.get(SITE_KEY).orEmpty(),
            zone = store.get(ZONE).orEmpty(),
        )
    }
}
