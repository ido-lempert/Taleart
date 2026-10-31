package site.lempert.taleart.sdk.android

import android.content.Context
import android.util.AttributeSet
import android.util.Log
import android.view.View
import android.widget.FrameLayout
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.ViewCompositionStrategy
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.findViewTreeLifecycleOwner
import site.lempert.taleart.sdk.TaleartListener
import site.lempert.taleart.sdk.delivery.DeliveryClient
import site.lempert.taleart.sdk.delivery.DeliveryZone
import site.lempert.taleart.sdk.delivery.DeliveryTaleGroup
import site.lempert.taleart.sdk.delivery.ZoneResult
import site.lempert.taleart.sdk.ui.TaleartZone
import site.lempert.taleart.sdk.ui.TaleartZoneController

/**
 * Android counterpart of the `<taleart-view>` web component: a view that shows a zone, read with the
 * zone's key (`tak_…`), through the shared [TaleartZone] composable.
 *
 * From XML: `app:taleartZoneKey`, and optionally `app:taleartApiUrl` (else the API origin of
 * `TaleartSdk.init`). From code: set [zoneKey] (and [apiUrl]) or call [configure]; it reads the zone
 * once the key is set and an API origin is known, and again whenever one changes or [reload] is
 * called, keeping the display on screen until the new zone arrives. The display is the zone's bar or
 * banner, as its frame type says, laid out at the full width with wrap_content height (the banner's
 * height follows its width and aspect ratio). The zone lives in [controller], outside composition, so
 * the view keeps it when it is detached and attached again (in a RecyclerView, a back stack).
 *
 * [locale] and [strings] are this view's texts, over the SDK's; [listener] hears this view's events
 * (see [TaleartListener]) before the SDK's global listener does.
 *
 * A tap on a group (a bar item or a banner slide) opens the full-screen tale viewer in a dialog
 * window over the activity, whatever layout the view sits in; Back or the viewer's Close returns to
 * the display. Set [opensViewer] to false to handle taps yourself.
 *
 * When the zone fails to load the view shows [fallbackView] if the host set one, else the SDK's
 * `load.failed` text with a retry button when `TaleartConfig.fallback` is `Message`, else nothing.
 * [analytics] (`app:taleartAnalytics`) turns this view's events off with false; null follows the SDK.
 *
 * It needs a ViewTreeLifecycleOwner, as every ComposeView does: an AppCompatActivity,
 * ComponentActivity or Fragment gives one. In a window without one (a plain `android.app.Activity`,
 * a bare WindowManager view) it draws nothing and logs a warning instead of crashing; set one with
 * `setViewTreeLifecycleOwner` before attaching it. Its composition is disposed when that lifecycle
 * is destroyed.
 */
class TaleartView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = 0,
) : FrameLayout(context, attrs, defStyleAttr) {
    /** The zone this view shows, read with the process's shared Delivery client unless [client] is set. */
    val controller = TaleartZoneController()

    private var composeView: ComposeView? = null

    /** Called with the tapped tale group (its id and title), before the viewer opens (unless [opensViewer] is false). */
    var onGroupClickListener: ((DeliveryTaleGroup) -> Unit)? = null

    /**
     * True (the default) when a tap on a group opens the full-screen tale viewer, a dialog window
     * over the activity; false when the host handles taps itself through [onGroupClickListener].
     */
    var opensViewer: Boolean by mutableStateOf(true)

    // The viewer shows only while the view is in a window: detached, its dialog closes and its video stops.
    private var inWindow by mutableStateOf(false)

    /** Called with each failed read (a refused key, a network failure); the view then shows nothing. */
    var onErrorListener: ((ZoneResult.Failure) -> Unit)?
        get() = controller.onError
        set(value) { controller.onError = value }

    /**
     * This view's hooks (see [TaleartListener]): `onLoaded`, `onLoadFailed`, `onPresented`,
     * `onActionClicked` and the rest. Null for none; the SDK's global listener hears every view.
     */
    var listener: TaleartListener?
        get() = controller.listener
        set(value) { controller.listener = value }

    /**
     * The host's own placeholder, shown instead of the zone when its read fails (see the class doc).
     * Set null for none. The view is placed in the view's composition, so it must not be attached elsewhere.
     */
    var fallbackView: View? by mutableStateOf(null)

    /** Whether this view sends analytics events: false turns them off, null (the default) follows `TaleartConfig.analytics`. */
    var analytics: Boolean?
        get() = controller.analytics
        set(value) { controller.analytics = value }

    /** This view's texts per locale, over the SDK's (`TaleartSdk.init`); null for none. */
    var strings: Map<String, Map<String, String>>?
        get() = controller.strings
        set(value) { controller.strings = value }

    /**
     * This view's viewer properties (see `TaleartConfig.properties`), replacing the SDK's; null to use the SDK's.
     * Set them here when a screen knows the viewer better than the app did at start. A change reads the zone again.
     */
    var properties: Map<String, Any?>?
        get() = controller.properties
        set(value) { controller.properties = value }

    /** This view's locale (BCP 47, such as `he-IL`); null to use the SDK's (see `TaleartSdk.init`). */
    var locale: String?
        get() = controller.locale
        set(value) { controller.locale = value }

    /** The Delivery client the next read uses; the process's shared one by default. A client set here belongs to the caller. */
    var client: DeliveryClient
        get() = controller.client
        set(value) { controller.client = value }

    /**
     * Shows a zone without any backend: the body of `GET /delivery/v1/zone` as JSON text (inline, a bundled
     * asset, copied from the dashboard). Nothing is read from or sent to the API: no zone request, no
     * analytics, and a poll answer is marked on the device only. Targeting by tags and properties, the
     * frequency cap, the theme, the listener and RTL work as for a fetched zone; JSON that is no zone is a
     * failed read (logged once, [onErrorListener], `onLoadFailed`), never a crash; check it first with
     * `TaleartSdk.parseZoneJson`. Setting [zoneKey] or [apiUrl] afterwards reads from the API again (this
     * is then null). Null clears the zone data.
     */
    var zoneJson: String?
        get() = json
        set(value) {
            json = value
            if (value != null) controller.configureLocalJson(value) else controller.configure(apiUrl, zoneKey)
        }

    private var json: String? = null

    /** Shows [zone], a zone the app already holds, as [zoneJson] does for its JSON text. */
    fun setZone(zone: DeliveryZone) {
        json = null
        controller.configureLocal(zone)
    }

    /** The TaleArt API origin, such as `https://api.example.com`; empty uses the one of `TaleartSdk.init`. */
    var apiUrl: String = ""
        set(value) {
            field = value.trim()
            json = null
            controller.configure(apiUrl, zoneKey)
        }

    /** The zone's key (`tak_…`), issued in the dashboard: the view renders nothing without it. */
    var zoneKey: String = ""
        set(value) {
            field = value.trim()
            json = null
            controller.configure(apiUrl, zoneKey)
        }

    init {
        context.obtainStyledAttributes(attrs, R.styleable.TaleartView, defStyleAttr, 0).apply {
            try {
                getString(R.styleable.TaleartView_taleartApiUrl)?.let { apiUrl = it }
                getString(R.styleable.TaleartView_taleartZoneKey)?.let { zoneKey = it }
                if (hasValue(R.styleable.TaleartView_taleartAnalytics)) analytics = getBoolean(R.styleable.TaleartView_taleartAnalytics, true)
            } finally {
                recycle()
            }
        }
    }

    /** Sets the zone to show in one call: the API origin (empty for the SDK's) and the zone's key. */
    fun configure(apiUrl: String, zoneKey: String) {
        this.apiUrl = apiUrl
        this.zoneKey = zoneKey
    }

    /** Reads the zone again, as reopening the screen would; the display stays until the new zone arrives. */
    fun reload() = controller.reload()

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        inWindow = true
        // The ComposeView is made after the first attach completes, once the window's lifecycle
        // owner is known (a child added during the attach would be attached twice).
        if (composeView == null) post { if (isAttachedToWindow) addComposeView() }
    }

    override fun onDetachedFromWindow() {
        inWindow = false
        super.onDetachedFromWindow()
    }

    private fun addComposeView() {
        if (composeView != null) return
        if (findViewTreeLifecycleOwner() == null) {
            Log.w(TAG, "TaleartView needs a ViewTreeLifecycleOwner (such as a ComponentActivity); it shows nothing")
            return
        }
        val view = ComposeView(context).apply {
            setViewCompositionStrategy(ViewCompositionStrategy.DisposeOnViewTreeLifecycleDestroyed)
            setContent {
                val hostView = fallbackView
                val placeholder: (@Composable () -> Unit)? = if (hostView == null) null else {
                    @Composable { AndroidView(factory = { hostView }) }
                }
                TaleartZone(
                    controller,
                    onGroupClick = { group -> onGroupClickListener?.invoke(group) },
                    opensViewer = opensViewer && inWindow,
                    fallback = placeholder,
                )
            }
        }
        composeView = view
        addView(view, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT))
    }

    /** True once the view hosts its composition (it has been attached in a window with a lifecycle owner). */
    val hostsComposition: Boolean get() = composeView != null

    private companion object {
        const val TAG = "TaleArt"
    }
}
