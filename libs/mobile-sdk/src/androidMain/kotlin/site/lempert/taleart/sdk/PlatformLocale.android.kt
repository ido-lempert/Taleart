package site.lempert.taleart.sdk

import java.util.Locale

actual fun deviceLocale(): String {
    val tag = Locale.getDefault().toLanguageTag()
    return if (tag.isBlank() || tag == "und") "en" else tag
}
