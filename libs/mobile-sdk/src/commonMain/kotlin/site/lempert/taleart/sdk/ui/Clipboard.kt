package site.lempert.taleart.sdk.ui

/** Puts [text] on the platform's clipboard (a promo code's Copy); true when it did. */
internal expect fun copyToClipboard(text: String): Boolean
