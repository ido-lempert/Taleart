package site.lempert.taleart.sdk.android

import android.content.Context
import android.util.AttributeSet
import android.util.Log
import android.widget.FrameLayout
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.ViewCompositionStrategy
import androidx.lifecycle.findViewTreeLifecycleOwner
import site.lempert.taleart.sdk.delivery.DeliveryClient
import site.lempert.taleart.sdk.delivery.DeliveryTaleGroup
import site.lempert.taleart.sdk.delivery.ZoneResult
import site.lempert.taleart.sdk.ui.TaleartZone
import site.lempert.taleart.sdk.ui.TaleartZoneController

/**
 * Android counterpart of the `<taleart-view>` web component: a view that shows a zone, read with
 * the project's site key and the zone's slug, through the shared [TaleartZone] composable.
 *
 * From XML: `app:taleartApiUrl`, `app:taleartSiteKey` and `app:taleartZone`. From code: set
 * [apiUrl], [siteKey] and [zone] (or [configure]); it reads the zone once all three are set and
 * again whenever one changes or [reload] is called, keeping the bar on screen until the new zone
 * arrives. The zone lives in [controller], outside composition, so the view keeps it when it is
 * detached and attached again (in a RecyclerView, a back stack).
 *
 * A tap on a group opens the full-screen tale viewer in a dialog window over the activity, whatever
 * layout the view sits in; Back or the viewer's Close returns to the bar. Set [opensViewer] to false
 * to handle taps yourself.
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

    /** Called with each failed read (a refused key, an unknown slug, a network failure); the view then shows nothing. */
    var onErrorListener: ((ZoneResult.Failure) -> Unit)?
        get() = controller.onError
        set(value) { controller.onError = value }

    /** The Delivery client the next read uses; the process's shared one by default. A client set here belongs to the caller. */
    var client: DeliveryClient
        get() = controller.client
        set(value) { controller.client = value }

    /** The TaleArt API origin, such as `https://api.example.com`. */
    var apiUrl: String = ""
        set(value) {
            field = value.trim()
            controller.configure(apiUrl, siteKey, zone)
        }

    /** The project's site key (`tas_…`). */
    var siteKey: String = ""
        set(value) {
            field = value.trim()
            controller.configure(apiUrl, siteKey, zone)
        }

    /** The zone's slug, such as `home-top`. */
    var zone: String = ""
        set(value) {
            field = value.trim()
            controller.configure(apiUrl, siteKey, zone)
        }

    init {
        context.obtainStyledAttributes(attrs, R.styleable.TaleartView, defStyleAttr, 0).apply {
            try {
                getString(R.styleable.TaleartView_taleartApiUrl)?.let { apiUrl = it }
                getString(R.styleable.TaleartView_taleartSiteKey)?.let { siteKey = it }
                getString(R.styleable.TaleartView_taleartZone)?.let { zone = it }
            } finally {
                recycle()
            }
        }
    }

    /** Sets the zone to show in one call. */
    fun configure(apiUrl: String, siteKey: String, zone: String) {
        this.apiUrl = apiUrl
        this.siteKey = siteKey
        this.zone = zone
    }

    /** Reads the zone again, as reopening the screen would; the bar stays until the new zone arrives. */
    fun reload() = controller.reload()

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        // The ComposeView is made after the first attach completes, once the window's lifecycle
        // owner is known (a child added during the attach would be attached twice).
        if (composeView == null) post { if (isAttachedToWindow) addComposeView() }
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
                TaleartZone(controller, onGroupClick = { group -> onGroupClickListener?.invoke(group) }, opensViewer = opensViewer)
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
