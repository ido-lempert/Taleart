package site.lempert.taleart.sdk.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.window.ComposeUIViewController
import kotlinx.cinterop.ExperimentalForeignApi
import platform.Foundation.NSBundle
import platform.Foundation.NSNotificationCenter
import platform.Foundation.NSOperationQueue
import platform.UIKit.UIAccessibilityAnnouncementNotification
import platform.UIKit.UIAccessibilityIsReduceMotionEnabled
import platform.UIKit.UIAccessibilityPostNotification
import platform.UIKit.UIAccessibilityReduceMotionStatusDidChangeNotification
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
    private val onAppeared: () -> Unit = {},
) : UIViewController(nibName = null, bundle = null) {
    /** True once the viewer itself asked for the dismissal. */
    var dismissing = false

    override fun viewDidLoad() {
        super.viewDidLoad()
        // Clear: the viewer draws its own black backdrop, fading in and out over the app (story 9.9).
        // Where Compose clears its canvas over a native view (a video), the video's own view shows:
        // the stage's video letterboxes on black.
        view.backgroundColor = UIColor.clearColor
        content.view.backgroundColor = UIColor.clearColor
        content.view.opaque = false
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

    // On screen: the viewer may start its opening motion and its tale.
    override fun viewDidAppear(animated: Boolean) {
        super.viewDidAppear(animated)
        onAppeared()
    }

    override fun viewDidDisappear(animated: Boolean) {
        super.viewDidDisappear(animated)
        if (!dismissing && presentingViewController == null) onDismissedFromOutside()
    }
}

// A modal view controller over the app's top view controller: it covers the whole screen wherever
// the bar sits (a child view controller, a SwiftUI representable, a whole Compose screen). When it
// cannot be presented (no window, the top controller busy presenting or dismissing, UIKit refusing)
// or UIKit dismisses it from outside, the viewer is asked to close, so the zone's state matches.
@OptIn(ExperimentalComposeUiApi::class)
@Composable
internal actual fun FullScreenViewer(requestKey: Any, onDismissRequest: () -> Unit, onBack: () -> Unit, content: @Composable () -> Unit) {
    val current by rememberUpdatedState(content)
    val dismiss by rememberUpdatedState(onDismissRequest)
    // The modal's view takes a moment to reach the screen (Compose sets up its canvas first): the
    // viewer waits for it before it opens and its tale starts.
    val appeared = remember(requestKey) { mutableStateOf(false) }
    DisposableEffect(requestKey) {
        var disposed = false
        val failed = { if (!disposed) dismiss() }
        val host = topViewController()
        if (host == null) {
            failed()
            return@DisposableEffect onDispose { disposed = true }
        }
        // A transparent Compose view over a clear modal: the viewer draws its own backdrop and opens and
        // closes with its own motion over the app (story 9.9), so UIKit presents it without a transition.
        val compose = ComposeUIViewController(configure = { opaque = false }) {
            CompositionLocalProvider(LocalViewerAppeared provides appeared) { current() }
        }
        val modal = ViewerModalController(compose, onDismissedFromOutside = failed, onAppeared = { appeared.value = true })
        modal.modalPresentationStyle = UIModalPresentationOverFullScreen
        modal.modalTransitionStyle = UIModalTransitionStyleCrossDissolve
        // The viewer sets the status bar's look while it covers the app.
        modal.modalPresentationCapturesStatusBarAppearance = true
        host.presentViewController(modal, animated = false) {
            // UIKit refuses some presentations without an error: the modal then has no presenter.
            if (modal.presentingViewController == null) failed()
        }
        if (modal.presentingViewController == null && !modal.isBeingPresented()) failed()
        onDispose {
            disposed = true
            modal.dismissing = true
            if (modal.presentingViewController != null) modal.dismissViewControllerAnimated(false, completion = null)
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

// Reduce Motion, observed: a change while the app runs reaches the banner at once, and the next viewer.
@Composable
internal actual fun rememberPrefersReducedMotion(): Boolean {
    val reduced = remember { mutableStateOf(UIAccessibilityIsReduceMotionEnabled()) }
    DisposableEffect(Unit) {
        val center = NSNotificationCenter.defaultCenter
        val observer = center.addObserverForName(
            UIAccessibilityReduceMotionStatusDidChangeNotification,
            `object` = null,
            queue = NSOperationQueue.mainQueue,
        ) { _ -> reduced.value = UIAccessibilityIsReduceMotionEnabled() }
        reduced.value = UIAccessibilityIsReduceMotionEnabled()
        onDispose { center.removeObserver(observer) }
    }
    return reduced.value
}

internal actual fun announceForAccessibility(text: String) {
    UIAccessibilityPostNotification(UIAccessibilityAnnouncementNotification, text)
}
