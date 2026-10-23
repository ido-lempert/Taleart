package site.lempert.taleart.sdk.ui

import android.graphics.Color as AndroidColor
import android.provider.Settings
import android.view.ViewGroup
import androidx.compose.runtime.Composable
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

// "Remove animations" in the accessibility settings sets the animator duration scale to 0.
@Composable
internal actual fun rememberPrefersReducedMotion(): Boolean {
    val context = LocalContext.current
    return remember(context) {
        Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
    }
}

// TalkBack reads the viewer's live region as it changes.
internal actual fun announceForAccessibility(text: String) = Unit
