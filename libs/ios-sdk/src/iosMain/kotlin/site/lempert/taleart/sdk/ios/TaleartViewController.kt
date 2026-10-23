package site.lempert.taleart.sdk.ios

import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.window.ComposeUIViewController
import platform.UIKit.UIViewController
import site.lempert.taleart.sdk.delivery.DeliveryClient
import site.lempert.taleart.sdk.delivery.DeliveryTaleGroup
import site.lempert.taleart.sdk.delivery.ZoneResult
import site.lempert.taleart.sdk.ui.TaleartZone
import site.lempert.taleart.sdk.ui.TaleartZoneController

/**
 * iOS counterpart of the `<taleart-view>` web component: the zone with slug [zone], read from the
 * TaleArt API at [apiUrl] with the project's [siteKey], shown by [viewController] through the
 * shared [TaleartZone] composable. Embed [viewController] as a child view controller (or in SwiftUI
 * through `UIViewControllerRepresentable`). Keep this object for as long as the view controller:
 * its inputs can change at any time, and [reload] reads the zone again, keeping the bar on screen
 * until the new zone arrives.
 *
 * The bar fills the width it is given and scrolls sideways. Its height is 8 points of padding plus
 * the cover size (48, 64 or 80), plus, when titles show, 6 and one or two 16-point title lines: at
 * most 126 points. [height] holds its current height (0 while there is nothing to show) and
 * [onHeightChange] reports each change, so a host can size its container to fit.
 *
 * From Swift: `let zone = TaleartZoneView(apiUrl: url, siteKey: key, zone: "home-top")`, then
 * `zone.viewController`.
 */
class TaleartZoneView(apiUrl: String, siteKey: String, zone: String) {
    /** The zone shown, read with the process's shared Delivery client unless [client] is set. */
    val controller = TaleartZoneController()

    /** Called with the tapped tale group; the viewer comes with story 9.4. */
    var onGroupClick: ((DeliveryTaleGroup) -> Unit)? = null

    /** Called with each failed read (a refused key, an unknown slug, a network failure); nothing shows then. */
    var onError: ((ZoneResult.Failure) -> Unit)?
        get() = controller.onError
        set(value) { controller.onError = value }

    /** Called with the bar's new height in points. */
    var onHeightChange: ((Double) -> Unit)? = null

    /** The bar's current height in points; 0 while there is nothing to show. */
    var height: Double by mutableStateOf(0.0)
        private set

    /** The Delivery client the next read uses; the process's shared one by default. A client set here belongs to the caller. */
    var client: DeliveryClient
        get() = controller.client
        set(value) { controller.client = value }

    var apiUrl: String = apiUrl
        set(value) {
            field = value
            controller.configure(this.apiUrl, siteKey, this.zone)
        }

    var siteKey: String = siteKey
        set(value) {
            field = value
            controller.configure(this.apiUrl, siteKey, this.zone)
        }

    var zone: String = zone
        set(value) {
            field = value
            controller.configure(this.apiUrl, siteKey, this.zone)
        }

    init {
        controller.configure(apiUrl, siteKey, zone)
    }

    /** Sets the zone to show in one call. */
    fun configure(apiUrl: String, siteKey: String, zone: String) {
        this.apiUrl = apiUrl
        this.siteKey = siteKey
        this.zone = zone
    }

    /** Reads the zone again, as reopening the screen would. */
    fun reload() = controller.reload()

    /** The view controller showing the zone. */
    val viewController: UIViewController by lazy {
        ComposeUIViewController {
            val density = LocalDensity.current
            val empty = controller.zone == null
            SideEffect { if (empty) reportHeight(0.0) }
            TaleartZone(
                controller,
                modifier = Modifier.onSizeChanged { size -> reportHeight(with(density) { size.height.toDp().value.toDouble() }) },
                onGroupClick = { group -> onGroupClick?.invoke(group) },
            )
        }
    }

    private fun reportHeight(value: Double) {
        if (value == height) return
        height = value
        onHeightChange?.invoke(value)
    }
}

/** A view controller showing the zone with slug [zone] (see [TaleartZoneView], which can also change it later). */
fun TaleartViewController(apiUrl: String, siteKey: String, zone: String): UIViewController =
    TaleartZoneView(apiUrl, siteKey, zone).viewController

/** A view controller showing the zone with slug [zone], calling [onGroupClick] with each tapped group. */
fun TaleartViewController(
    apiUrl: String,
    siteKey: String,
    zone: String,
    onGroupClick: (DeliveryTaleGroup) -> Unit,
): UIViewController = TaleartZoneView(apiUrl, siteKey, zone).also { it.onGroupClick = onGroupClick }.viewController
