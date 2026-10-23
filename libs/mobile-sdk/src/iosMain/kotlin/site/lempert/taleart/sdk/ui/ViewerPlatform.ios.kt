package site.lempert.taleart.sdk.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.window.ComposeUIViewController
import platform.Foundation.NSBundle
import platform.UIKit.UIAccessibilityAnnouncementNotification
import platform.UIKit.UIAccessibilityIsReduceMotionEnabled
import platform.UIKit.UIAccessibilityPostNotification
import platform.UIKit.UIApplication
import platform.UIKit.UIModalPresentationOverFullScreen
import platform.UIKit.UIModalTransitionStyleCrossDissolve
import platform.UIKit.UIViewController
import platform.UIKit.UIWindow
import platform.UIKit.UIWindowScene

// A modal view controller over the app's top view controller: it covers the whole screen wherever
// the bar sits (a child view controller, a SwiftUI representable, a whole Compose screen). Without a
// window to present over (tests) the viewer cannot show, and asks to be dismissed.
@Composable
internal actual fun FullScreenViewer(onDismissRequest: () -> Unit, content: @Composable () -> Unit) {
    val current by rememberUpdatedState(content)
    val dismiss by rememberUpdatedState(onDismissRequest)
    val reduced = rememberPrefersReducedMotion()
    DisposableEffect(Unit) {
        val host = topViewController()
        if (host == null) {
            dismiss()
            return@DisposableEffect onDispose { }
        }
        val viewer = ComposeUIViewController { current() }
        viewer.modalPresentationStyle = UIModalPresentationOverFullScreen
        viewer.modalTransitionStyle = UIModalTransitionStyleCrossDissolve
        host.presentViewController(viewer, animated = !reduced, completion = null)
        onDispose {
            if (viewer.presentingViewController != null) viewer.dismissViewControllerAnimated(!reduced, completion = null)
        }
    }
}

// The key window's root view controller, and then whatever it presents, to the top.
private fun topViewController(): UIViewController? {
    // A process that is not an app (a test executable) has no UIApplication: sharedApplication is
    // nil there, which Kotlin cannot check, so it is never asked. Every app bundle has an identifier.
    if (NSBundle.mainBundle.bundleIdentifier == null) return null
    val windows = UIApplication.sharedApplication.connectedScenes
        .mapNotNull { it as? UIWindowScene }
        .flatMap { scene -> scene.windows.mapNotNull { it as? UIWindow } }
    val window = windows.firstOrNull { it.isKeyWindow() } ?: windows.firstOrNull() ?: return null
    var top = window.rootViewController ?: return null
    while (true) top = top.presentedViewController?.takeUnless { it.isBeingDismissed() } ?: break
    return top
}

@Composable
internal actual fun rememberPrefersReducedMotion(): Boolean = remember { UIAccessibilityIsReduceMotionEnabled() }

internal actual fun announceForAccessibility(text: String) {
    UIAccessibilityPostNotification(UIAccessibilityAnnouncementNotification, text)
}
