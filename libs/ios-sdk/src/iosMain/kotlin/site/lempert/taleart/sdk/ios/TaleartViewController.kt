package site.lempert.taleart.sdk.ios

import androidx.compose.ui.window.ComposeUIViewController
import platform.UIKit.UIViewController
import site.lempert.taleart.sdk.delivery.DeliveryTaleGroup
import site.lempert.taleart.sdk.ui.TaleartZone

/**
 * iOS counterpart of the `<taleart-view>` web component: a view controller showing the zone with
 * slug [zone], read from the TaleArt API at [apiUrl] with the project's [siteKey], through the
 * shared [TaleartZone] composable. Embed it as a child view controller (or in SwiftUI through
 * `UIViewControllerRepresentable`). [onGroupClick] gets the tapped tale group; the viewer comes
 * with story 9.4. From Swift: `TaleartViewControllerKt.TaleartViewController(apiUrl:siteKey:zone:onGroupClick:)`.
 */
fun TaleartViewController(
    apiUrl: String,
    siteKey: String,
    zone: String,
    onGroupClick: (DeliveryTaleGroup) -> Unit = {},
): UIViewController = ComposeUIViewController {
    TaleartZone(apiUrl = apiUrl, siteKey = siteKey, zone = zone, onGroupClick = onGroupClick)
}
