package site.lempert.taleart.sdk.ui

import android.graphics.Color as AndroidColor
import android.database.ContentObserver
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.ViewGroup
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.DialogWindowProvider
import androidx.core.view.WindowCompat

// A full-screen dialog window over the activity, edge to edge on black: it works wherever the bar
// sits (a ComposeView in any host layout), and Back closes it.
@Composable
internal actual fun FullScreenViewer(requestKey: Any, onDismissRequest: () -> Unit, content: @Composable () -> Unit) {
    Dialog(
        onDismissRequest = onDismissRequest,
        properties = DialogProperties(
            usePlatformDefaultWidth = false,
            decorFitsSystemWindows = false,
            dismissOnClickOutside = false,
        ),
    ) {
        val view = LocalView.current
        val window = (view.parent as? DialogWindowProvider)?.window
        SideEffect {
            window?.let {
                it.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
                it.setBackgroundDrawableResource(android.R.color.black)
                it.setDimAmount(0f)
                @Suppress("DEPRECATION")
                it.statusBarColor = AndroidColor.TRANSPARENT
                // Light icons on the viewer's black.
                WindowCompat.getInsetsController(it, view).isAppearanceLightStatusBars = false
                WindowCompat.getInsetsController(it, view).isAppearanceLightNavigationBars = false
            }
        }
        content()
    }
}

// "Remove animations" in the accessibility settings sets the animator duration scale to 0. The
// setting is observed: a change while the app runs reaches the banner at once, and the next viewer.
@Composable
internal actual fun rememberPrefersReducedMotion(): Boolean {
    val resolver = LocalContext.current.contentResolver
    fun read() = Settings.Global.getFloat(resolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
    val reduced = remember(resolver) { mutableStateOf(read()) }
    DisposableEffect(resolver) {
        val observer = object : ContentObserver(Handler(Looper.getMainLooper())) {
            override fun onChange(selfChange: Boolean) {
                reduced.value = read()
            }
        }
        resolver.registerContentObserver(Settings.Global.getUriFor(Settings.Global.ANIMATOR_DURATION_SCALE), false, observer)
        // A change between the first read and the registration.
        reduced.value = read()
        onDispose { resolver.unregisterContentObserver(observer) }
    }
    return reduced.value
}

// TalkBack reads the viewer's live region as it changes.
internal actual fun announceForAccessibility(text: String) = Unit
