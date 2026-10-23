package site.lempert.taleart.taller

import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.ui.tooling.preview.Preview

// Android 17 asks before an app reaches the local network, which a local API (10.0.2.2) is.
// Only debug builds declare it (src/debug/AndroidManifest.xml).
private const val ACCESS_LOCAL_NETWORK = "android.permission.ACCESS_LOCAL_NETWORK"

class MainActivity : ComponentActivity() {
    // The app opens (and loads the saved zone) once the person has answered, so its first request
    // is not one the platform holds back.
    private val askLocalNetwork = registerForActivityResult(ActivityResultContracts.RequestPermission()) { showApp() }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)

        if (needsLocalNetworkPermission()) askLocalNetwork.launch(ACCESS_LOCAL_NETWORK) else showApp()
    }

    private fun showApp() {
        val store = SharedPreferencesStore(applicationContext)
        setContent {
            App(store = store)
        }
    }

    private fun needsLocalNetworkPermission(): Boolean {
        if (Build.VERSION.SDK_INT < 37) return false
        if (checkSelfPermission(ACCESS_LOCAL_NETWORK) == PackageManager.PERMISSION_GRANTED) return false
        val requested = packageManager.getPackageInfo(packageName, PackageManager.GET_PERMISSIONS).requestedPermissions
        return requested?.contains(ACCESS_LOCAL_NETWORK) == true
    }
}

@Preview
@Composable
fun AppAndroidPreview() {
    App()
}
