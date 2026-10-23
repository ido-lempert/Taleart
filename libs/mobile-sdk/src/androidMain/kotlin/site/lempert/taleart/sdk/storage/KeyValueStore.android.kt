package site.lempert.taleart.sdk.storage

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext

/** A store in the app's SharedPreferences file [name]. */
class SharedPreferencesKeyValueStore(context: Context, name: String) : KeyValueStore {
    private val prefs = context.applicationContext.getSharedPreferences(name, Context.MODE_PRIVATE)
    override fun get(key: String): String? = prefs.getString(key, null)
    override fun set(key: String, value: String) {
        prefs.edit().putString(key, value).apply()
    }
}

/**
 * The SharedPreferences file the SDK keeps its own state in (the seen tale groups). A library
 * cannot exclude a file from the host app's backup: an app that wants it left out lists
 * `sharedpref/taleart-sdk.xml` in its backup rules (`android:fullBackupContent` and
 * `android:dataExtractionRules`). It holds tale group ids and the install's random visitor id (not
 * derived from the person, tied to no account), never a key. Backups restore the visitor id across a
 * reinstall unless that file is excluded.
 */
const val SDK_PREFERENCES = "taleart-sdk"

private val deviceStoreLock = Any()
private var deviceStore: KeyValueStore? = null

/** The SDK's own store, one per process: the [SDK_PREFERENCES] SharedPreferences. */
fun deviceKeyValueStore(context: Context): KeyValueStore = synchronized(deviceStoreLock) {
    deviceStore ?: SharedPreferencesKeyValueStore(context, SDK_PREFERENCES).also { deviceStore = it }
}

@Composable
actual fun rememberDeviceKeyValueStore(): KeyValueStore {
    val context = LocalContext.current.applicationContext
    return remember(context) { deviceKeyValueStore(context) }
}

internal actual fun deviceKeyValueStoreOrNull(): KeyValueStore? = synchronized(deviceStoreLock) { deviceStore }
