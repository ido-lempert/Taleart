package site.lempert.taleart.sdk.ios

import kotlinx.cinterop.ExperimentalForeignApi
import kotlinx.cinterop.readValue
import platform.CoreGraphics.CGRectZero
import platform.UIKit.UIView

/** iOS counterpart of the `<taleart-view>` web component. Rendering is not implemented yet. */
@OptIn(ExperimentalForeignApi::class)
class TaleartView : UIView(frame = CGRectZero.readValue())
