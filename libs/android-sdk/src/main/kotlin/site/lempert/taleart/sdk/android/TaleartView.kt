package site.lempert.taleart.sdk.android

import android.content.Context
import android.util.AttributeSet
import android.widget.FrameLayout

/** Android counterpart of the `<taleart-view>` web component. Rendering is not implemented yet. */
class TaleartView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
) : FrameLayout(context, attrs)
