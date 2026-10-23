package site.lempert.taleart.sdk.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.window.ComposeUIViewController
import kotlinx.cinterop.ExperimentalForeignApi
import platform.Foundation.NSBundle
import platform.UIKit.UIAccessibilityAnnouncementNotification
import platform.UIKit.UIAccessibilityIsReduceMotionEnabled
import platform.UIKit.UIAccessibilityPostNotification
import platform.UIKit.UIApplication
import platform.UIKit.UIColor
import platform.UIKit.UIModalPresentationOverFullScreen
import platform.UIKit.UIModalTransitionStyleCrossDissolve
import platform.UIKit.UISceneActivationStateForegroundActive
import platform.UIKit.UIStatusBarStyle
import platform.UIKit.UIStatusBarStyleLightContent
import platform.UIKit.UIViewAutoresizingFlexibleHeight
import platform.UIKit.UIViewAutoresizingFlexibleWidth
import platform.UIKit.UIViewController
import platform.UIKit.UIWindow
import platform.UIKit.UIWindowScene
import platform.UIKit.addChildViewController
import platform.UIKit.didMoveToParentViewController

/**
 * The modal that holds the viewer: the viewer's Compose view controller as its child, light status
 * bar content on the viewer's black, and a report when UIKit dismisses it without the viewer
 * asking (another presentation replacing it, the host dismissing its presented controllers).
 */
@OptIn(ExperimentalForeignApi::class)
internal class ViewerModalController(
    private val content: UIViewController,
    private val onDismissedFromOutside: () -> Unit,
) : UIViewController(nibName = null, bundle = null) {
    /** True once the viewer itself asked for the dismissal. */
    var dismissing = false

    override fun viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor.blackColor
        // Compose clears its canvas over a native view (the video), showing the view controller's own
        // background there, white by default: black, as the viewer is.
        content.view.backgroundColor = UIColor.blackColor
        addChildViewController(content)
        content.view.setFrame(view.bounds)
        content.view.autoresizingMask = UIViewAutoresizingFlexibleWidth or UIViewAutoresizingFlexibleHeight
        view.addSubview(content.view)
        content.didMoveToParentViewController(this)
    }

    // The viewer fills the modal, whatever size UIKit gives it.
    override fun viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        content.view.setFrame(view.bounds)
    }

    override fun preferredStatusBarStyle(): UIStatusBarStyle = UIStatusBarStyleLightContent

    override fun viewDidDisappear(animated: Boolean) {
        super.viewDidDisappear(animated)
        if (!dismissing && presentingViewController == null) onDismissedFromOutside()
    }
}

// A modal view controller over the app's top view controller: it covers the whole screen wherever
// the bar sits (a child view controller, a SwiftUI representable, a whole Compose screen). When it
// cannot be presented (no window, the top controller busy presenting or dismissing, UIKit refusing)
// or UIKit dismisses it from outside, the viewer is asked to close, so the zone's state matches.
@Composable
internal actual fun FullScreenViewer(requestKey: Any, onDismissRequest: () -> Unit, content: @Composable () -> Unit) {
    val current by rememberUpdatedState(content)
    val dismiss by rememberUpdatedState(onDismissRequest)
    val reduced = rememberPrefersReducedMotion()
    DisposableEffect(requestKey) {
        var disposed = false
        val failed = { if (!disposed) dismiss() }
        val host = topViewController()
        if (host == null) {
            failed()
            return@DisposableEffect onDispose { disposed = true }
        }
        val modal = ViewerModalController(ComposeUIViewController { current() }, onDismissedFromOutside = failed)
        modal.modalPresentationStyle = UIModalPresentationOverFullScreen
        modal.modalTransitionStyle = UIModalTransitionStyleCrossDissolve
        // The viewer sets the status bar's look while it covers the app.
        modal.modalPresentationCapturesStatusBarAppearance = true
        host.presentViewController(modal, animated = !reduced) {
            // UIKit refuses some presentations without an error: the modal then has no presenter.
            if (modal.presentingViewController == null) failed()
        }
        if (modal.presentingViewController == null && !modal.isBeingPresented()) failed()
        onDispose {
            disposed = true
            modal.dismissing = true
            if (modal.presentingViewController != null) modal.dismissViewControllerAnimated(!reduced, completion = null)
        }
    }
}

// The foreground-active scene's key window, then whatever its root presents, to the top; null when
// there is none or the top controller is in the middle of a presentation or dismissal.
internal fun topViewController(): UIViewController? {
    // A process that is not an app (a test executable) has no UIApplication: sharedApplication is
    // nil there, which Kotlin cannot check, so it is never asked. Every app bundle has an identifier.
    if (NSBundle.mainBundle.bundleIdentifier == null) return null
    val scenes = UIApplication.sharedApplication.connectedScenes.mapNotNull { it as? UIWindowScene }
    val scene = scenes.firstOrNull { it.activationState == UISceneActivationStateForegroundActive } ?: return null
    val windows = scene.windows.mapNotNull { it as? UIWindow }
    val window = windows.firstOrNull { it.isKeyWindow() } ?: windows.firstOrNull() ?: return null
    var top = window.rootViewController ?: return null
    while (true) {
        val next = top.presentedViewController ?: break
        // A controller on its way out is not one to present over: stop at its presenter.
        if (next.isBeingDismissed()) break
        top = next
    }
    if (top.isBeingPresented() || top.isBeingDismissed()) return null
    return top
}

@Composable
internal actual fun rememberPrefersReducedMotion(): Boolean = remember { UIAccessibilityIsReduceMotionEnabled() }

internal actual fun announceForAccessibility(text: String) {
    UIAccessibilityPostNotification(UIAccessibilityAnnouncementNotification, text)
}
