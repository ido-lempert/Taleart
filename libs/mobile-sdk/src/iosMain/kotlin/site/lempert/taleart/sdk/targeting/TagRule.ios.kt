package site.lempert.taleart.sdk.targeting

import platform.Foundation.NSString
import platform.Foundation.precomposedStringWithCanonicalMapping

internal actual fun normalizeNfc(value: String): String =
    (value as NSString).precomposedStringWithCanonicalMapping
