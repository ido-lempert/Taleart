package site.lempert.taleart.taller

import android.content.Context
import site.lempert.taleart.sdk.storage.SharedPreferencesKeyValueStore

// The Android emulator reaches the host machine at 10.0.2.2.
actual fun defaultApiUrl(): String = "http://10.0.2.2:$DEFAULT_API_PORT"

/** Taller's debug settings in the app's `taller-debug` SharedPreferences. */
fun SharedPreferencesStore(context: Context): KeyValueStore = SharedPreferencesKeyValueStore(context, "taller-debug")
