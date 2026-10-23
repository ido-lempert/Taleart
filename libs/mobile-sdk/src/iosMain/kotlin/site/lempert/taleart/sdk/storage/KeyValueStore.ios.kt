package site.lempert.taleart.sdk.storage

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
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

@Composable
actual fun rememberDeviceKeyValueStore(): KeyValueStore = remember { UserDefaultsKeyValueStore() }
