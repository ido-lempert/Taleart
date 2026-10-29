package site.lempert.taleart.sdk.targeting

import java.text.Normalizer

internal actual fun normalizeNfc(value: String): String = Normalizer.normalize(value, Normalizer.Form.NFC)
