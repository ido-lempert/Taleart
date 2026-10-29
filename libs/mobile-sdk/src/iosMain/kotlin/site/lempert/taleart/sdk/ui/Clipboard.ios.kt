package site.lempert.taleart.sdk.ui

import platform.UIKit.UIPasteboard

// The general pasteboard holds the text; true once it is set.
internal actual fun copyToClipboard(text: String): Boolean {
    UIPasteboard.generalPasteboard.string = text
    return UIPasteboard.generalPasteboard.string == text
}
