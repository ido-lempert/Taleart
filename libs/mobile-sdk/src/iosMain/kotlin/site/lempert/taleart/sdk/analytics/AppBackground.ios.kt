package site.lempert.taleart.sdk.analytics

import platform.Foundation.NSNotificationCenter
import platform.UIKit.UIApplicationWillResignActiveNotification

// The app will resign active: it is leaving the foreground (a call, the app switcher, the home screen).
internal actual fun observeAppBackground(onBackground: () -> Unit) {
    NSNotificationCenter.defaultCenter.addObserverForName(
        name = UIApplicationWillResignActiveNotification,
        `object` = null,
        queue = null,
    ) { _ -> onBackground() }
}
