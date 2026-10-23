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

/** The SharedPreferences file the SDK keeps its own state in. */
const val SDK_PREFERENCES = "taleart-sdk"

@Composable
actual fun rememberDeviceKeyValueStore(): KeyValueStore {
    val context = LocalContext.current.applicationContext
    return remember(context) { SharedPreferencesKeyValueStore(context, SDK_PREFERENCES) }
}
