package site.lempert.taleart.sdk.ios

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.window.ComposeUIViewController
import platform.UIKit.UIViewController
import site.lempert.taleart.sdk.TaleartListener
import site.lempert.taleart.sdk.delivery.DeliveryClient
import site.lempert.taleart.sdk.delivery.DeliveryTaleGroup
import site.lempert.taleart.sdk.delivery.ZoneResult
import site.lempert.taleart.sdk.ui.TaleartZone
import site.lempert.taleart.sdk.ui.TaleartZoneController

/**
 * iOS counterpart of the `<taleart-view>` web component: the zone with the zone key [zoneKey]
 * (`tak_…`), read from the TaleArt API at [apiUrl] (empty uses the one of `TaleartSdk.init`), shown
 * by [viewController] through the shared [TaleartZone] composable. Embed [viewController] as a child
 * view controller (or in SwiftUI through `UIViewControllerRepresentable`). Keep this object for as
 * long as the view controller: its inputs can change at any time, and [reload] reads the zone again,
 * keeping the display on screen until the new zone arrives.
 *
 * The zone shows its display, a bar or a banner, as its frame type says; the display can change
 * from one to the other when the zone is read again. Either fills the width it is given:
 * - The bar scrolls sideways. Its height is 8 points of padding plus the cover size (48, 64 or 80),
 *   plus, when titles show, 6 and one or two 16-point title lines: at most 126 points.
 * - The banner's height follows its width: 16 points (8 above, 8 below) plus the width divided by
 *   its aspect ratio (16:9, 3:1 or 1:1), plus, with two or more slides showing dots or autoplaying,
 *   4 and a 44-point row (with the autoplay button) or a 24-point row (dots only). At 393 points
 *   wide and 16:9, with autoplay: 16 + 221 + 48 = 285 points.
 *
 * [height] holds the display's current height (0 whenever nothing shows: before the zone loads,
 * or with no display, a display type the SDK does not know, or a banner without tales), measured
 * whatever height the container gives it, and [onHeightChange] reports each change, so a host can
 * size its container to fit; with a banner, give the container its width first.
 *
 * A tap on a group (a bar item or a banner slide) opens the full-screen tale viewer, presented
 * modally over the app's top view controller wherever the display is embedded; its Close or a swipe down dismisses it. Set
 * [opensViewer] to false to handle taps yourself.
 *
 * [listener] hears this view's events (see [TaleartListener]); subclass [TaleartListenerBase] in
 * Swift. [locale] and [strings] are this view's texts, over the SDK's.
 *
 * From Swift: `let zone = TaleartZoneView(apiUrl: url, zoneKey: key)`, then `zone.viewController`.
 */
class TaleartZoneView(apiUrl: String?, zoneKey: String) {
    /** The zone shown, read with the process's shared Delivery client unless [client] is set. */
    val controller = TaleartZoneController()

    /** Called with the tapped tale group, before the viewer opens (unless [opensViewer] is false). */
    var onGroupClick: ((DeliveryTaleGroup) -> Unit)? = null

    /**
     * True (the default) when a tap on a group opens the full-screen tale viewer, presented modally
     * over the app's top view controller; false when the host handles taps itself through [onGroupClick].
     */
    var opensViewer: Boolean by mutableStateOf(true)

    /** Called with each failed read (a refused key, a network failure); nothing shows then. */
    var onError: ((ZoneResult.Failure) -> Unit)?
        get() = controller.onError
        set(value) { controller.onError = value }

    /** This view's hooks (see [TaleartListener]); null for none. The SDK's global listener hears every view. */
    var listener: TaleartListener?
        get() = controller.listener
        set(value) { controller.listener = value }

    /** This view's texts per locale, over the SDK's (`TaleartSdk.init`); null for none. */
    var strings: Map<String, Map<String, String>>?
        get() = controller.strings
        set(value) { controller.strings = value }

    /** This view's locale (BCP 47, such as `he-IL`); null to use the SDK's. */
    var locale: String?
        get() = controller.locale
        set(value) { controller.locale = value }

    /** Called with the display's new height in points (bar or banner). */
    var onHeightChange: ((Double) -> Unit)? = null

    /** The display's current height in points (bar or banner); 0 while there is nothing to show. */
    var height: Double by mutableStateOf(0.0)
        private set

    /** The Delivery client the next read uses; the process's shared one by default. A client set here belongs to the caller. */
    var client: DeliveryClient
        get() = controller.client
        set(value) { controller.client = value }

    /** The TaleArt API origin; null or empty uses the one of `TaleartSdk.init`. */
    var apiUrl: String? = apiUrl
        set(value) {
            field = value
            controller.configure(this.apiUrl.orEmpty(), this.zoneKey)
        }

    /** The zone's key (`tak_…`). */
    var zoneKey: String = zoneKey
        set(value) {
            field = value
            controller.configure(this.apiUrl.orEmpty(), this.zoneKey)
        }

    init {
        controller.configure(apiUrl.orEmpty(), zoneKey)
    }

    /** Sets the zone to show in one call. */
    fun configure(apiUrl: String?, zoneKey: String) {
        this.apiUrl = apiUrl
        this.zoneKey = zoneKey
    }

    /** Reads the zone again, as reopening the screen would. */
    fun reload() = controller.reload()

    /** The view controller showing the zone. */
    val viewController: UIViewController by lazy {
        ComposeUIViewController {
            val density = LocalDensity.current
            // The display's own height, even in a container still shorter than it; 0 whenever nothing
            // renders (no zone yet, no display, an unknown type, a banner without tales), as the box is
            // then empty.
            Box(
                Modifier
                    .fillMaxWidth()
                    .wrapContentHeight(Alignment.Top, unbounded = true)
                    .onSizeChanged { size -> reportHeight(with(density) { size.height.toDp().value.toDouble() }) },
            ) {
                TaleartZone(
                    controller,
                    onGroupClick = { group -> onGroupClick?.invoke(group) },
                    opensViewer = opensViewer,
                )
            }
        }
    }

    private fun reportHeight(value: Double) {
        if (value == height) return
        height = value
        onHeightChange?.invoke(value)
    }
}

/** A view controller showing the zone with key [zoneKey] (see [TaleartZoneView], which can also change it later). */
fun TaleartViewController(apiUrl: String?, zoneKey: String): UIViewController =
    TaleartZoneView(apiUrl, zoneKey).viewController

/** A view controller showing the zone with key [zoneKey], calling [onGroupClick] with each tapped group before the viewer opens. */
fun TaleartViewController(
    apiUrl: String?,
    zoneKey: String,
    onGroupClick: (DeliveryTaleGroup) -> Unit,
): UIViewController = TaleartZoneView(apiUrl, zoneKey).also { it.onGroupClick = onGroupClick }.viewController
