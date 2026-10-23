package site.lempert.taleart.sdk.android

import android.content.Context
import android.util.AttributeSet
import android.widget.FrameLayout
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.ComposeView
import site.lempert.taleart.sdk.delivery.DeliveryTaleGroup
import site.lempert.taleart.sdk.ui.TaleartZone

/**
 * Android counterpart of the `<taleart-view>` web component: a view that shows a zone, read with
 * the project's site key and the zone's slug, through the shared [TaleartZone] composable.
 *
 * From XML: `app:taleartApiUrl`, `app:taleartSiteKey` and `app:taleartZone`. From code: set
 * [apiUrl], [siteKey] and [zone] (or [configure]); it reads the zone once all three are set and
 * again whenever one changes or [reload] is called. Hosted in an activity or fragment, which gives
 * the ComposeView its lifecycle.
 */
class TaleartView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = 0,
) : FrameLayout(context, attrs, defStyleAttr) {
    private var apiUrlState by mutableStateOf("")
    private var siteKeyState by mutableStateOf("")
    private var zoneState by mutableStateOf("")
    private var reloads by mutableIntStateOf(0)

    /** Called with the tapped tale group (its id and title); the viewer comes with story 9.4. */
    var onGroupClickListener: ((DeliveryTaleGroup) -> Unit)? = null

    /** The TaleArt API origin, such as `https://api.example.com`. */
    var apiUrl: String
        get() = apiUrlState
        set(value) { apiUrlState = value.trim() }

    /** The project's site key (`tas_…`). */
    var siteKey: String
        get() = siteKeyState
        set(value) { siteKeyState = value.trim() }

    /** The zone's slug, such as `home-top`. */
    var zone: String
        get() = zoneState
        set(value) { zoneState = value.trim() }

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
        addView(
            ComposeView(context).apply {
                setContent {
                    TaleartZone(
                        apiUrl = apiUrlState,
                        siteKey = siteKeyState,
                        zone = zoneState,
                        onGroupClick = { group -> onGroupClickListener?.invoke(group) },
                        reloadKey = reloads,
                    )
                }
            },
            LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT),
        )
    }

    /** Sets the zone to show in one call. */
    fun configure(apiUrl: String, siteKey: String, zone: String) {
        this.apiUrl = apiUrl
        this.siteKey = siteKey
        this.zone = zone
    }

    /** Reads the zone again, as reopening the screen would. */
    fun reload() {
        reloads++
    }
}
