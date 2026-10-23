package site.lempert.taleart.sdk.storage

import androidx.compose.runtime.Composable
import platform.Foundation.NSUserDefaults

/** A store in NSUserDefaults, the standard ones unless [defaults] says otherwise. */
class UserDefaultsKeyValueStore(
    private val defaults: NSUserDefaults = NSUserDefaults.standardUserDefaults,
) : KeyValueStore {
    override fun get(key: String): String? = defaults.stringForKey(key)
    override fun set(key: String, value: String) {
        defaults.setObject(value, forKey = key)
    }
}

/** The NSUserDefaults suite the SDK keeps its own state in (the seen tale groups and the visitor id), apart from the app's. */
const val SDK_DEFAULTS_SUITE = "taleart-sdk"

/** The SDK's own store, one per process: the [SDK_DEFAULTS_SUITE] NSUserDefaults suite. */
val deviceKeyValueStore: KeyValueStore by lazy {
    UserDefaultsKeyValueStore(NSUserDefaults(suiteName = SDK_DEFAULTS_SUITE))
}

@Composable
actual fun rememberDeviceKeyValueStore(): KeyValueStore = deviceKeyValueStore

internal actual fun deviceKeyValueStoreOrNull(): KeyValueStore? = deviceKeyValueStore
