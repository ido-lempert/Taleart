package site.lempert.taleart.taller

import platform.Foundation.NSUserDefaults

// The iOS simulator shares the host machine's network: localhost is the host.
actual fun defaultApiUrl(): String = "http://localhost:$DEFAULT_API_PORT"

/** Taller's debug settings in the standard NSUserDefaults. */
class UserDefaultsStore : KeyValueStore {
    private val defaults = NSUserDefaults.standardUserDefaults
    override fun get(key: String): String? = defaults.stringForKey(key)
    override fun set(key: String, value: String) {
        defaults.setObject(value, forKey = key)
    }
}
