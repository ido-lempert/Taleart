package site.lempert.taleart.taller

import android.content.Context

// The Android emulator reaches the host machine at 10.0.2.2.
actual fun defaultApiUrl(): String = "http://10.0.2.2:$DEFAULT_API_PORT"

/** Taller's debug settings in the app's SharedPreferences. */
class SharedPreferencesStore(context: Context) : KeyValueStore {
    private val prefs = context.getSharedPreferences("taller-debug", Context.MODE_PRIVATE)
    override fun get(key: String): String? = prefs.getString(key, null)
    override fun set(key: String, value: String) {
        prefs.edit().putString(key, value).apply()
    }
}
