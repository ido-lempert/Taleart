package site.lempert.taleart.taller

import site.lempert.taleart.sdk.storage.UserDefaultsKeyValueStore

// The iOS simulator shares the host machine's network: localhost is the host.
actual fun defaultApiUrl(): String = "http://localhost:$DEFAULT_API_PORT"

/** Taller's debug settings in the standard NSUserDefaults. */
fun UserDefaultsStore(): KeyValueStore = UserDefaultsKeyValueStore()
