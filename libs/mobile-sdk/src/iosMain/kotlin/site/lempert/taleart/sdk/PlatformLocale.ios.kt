package site.lempert.taleart.sdk

import platform.Foundation.NSLocale
import platform.Foundation.currentLocale
import platform.Foundation.localeIdentifier

actual fun deviceLocale(): String {
    // `he_IL`, or `en_US@calendar=...`: the language and region as a BCP 47 tag.
    val identifier = NSLocale.currentLocale.localeIdentifier.substringBefore('@').replace('_', '-')
    return identifier.ifBlank { "en" }
}
