package site.lempert.taleart.sdk.storage

import androidx.compose.runtime.Composable

/**
 * Simple text storage on the device: SharedPreferences on Android, NSUserDefaults on iOS.
 * The SDK keeps the seen tale groups in it; hosts may use it for their own settings.
 */
interface KeyValueStore {
    fun get(key: String): String?
    fun set(key: String, value: String)
}

/** A store kept in memory only, for previews and tests. */
class InMemoryKeyValueStore(initial: Map<String, String> = emptyMap()) : KeyValueStore {
    private val values = initial.toMutableMap()
    override fun get(key: String): String? = values[key]
    override fun set(key: String, value: String) {
        values[key] = value
    }
}

/** The SDK's own store on this device: the `taleart-sdk` SharedPreferences on Android, the standard NSUserDefaults on iOS. */
@Composable
expect fun rememberDeviceKeyValueStore(): KeyValueStore
