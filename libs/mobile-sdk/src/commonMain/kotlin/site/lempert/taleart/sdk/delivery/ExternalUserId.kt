package site.lempert.taleart.sdk.delivery

/**
 * The request header that carries the viewer's external user ID (`EXTERNAL_USER_ID_HEADER` in
 * libs/contract/src/lib/external-user-id.ts). Separate from the visitor id: the two are never linked.
 */
internal const val EXTERNAL_USER_ID_HEADER = "X-TaleArt-External-User-Id"

/** The longest external user ID a user list can hold, in code points (`MAX_EXTERNAL_USER_ID_LENGTH`). */
internal const val MAX_EXTERNAL_USER_ID_LENGTH = 256

private const val BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"

/**
 * An external user ID as it is matched: trimmed, exact otherwise (case counts, no Unicode
 * normalization). Null when it is blank, longer than [MAX_EXTERNAL_USER_ID_LENGTH] code points, or
 * holds a control character (C0, DEL or C1), as `normalizeExternalUserId` in the contract.
 */
internal fun normalizeExternalUserId(value: String?): String? {
    val id = value?.trim() ?: return null
    if (id.isEmpty() || codePointCount(id) > MAX_EXTERNAL_USER_ID_LENGTH) return null
    if (id.any { c -> c.code <= 0x1F || c.code in 0x7F..0x9F }) return null
    return id
}

/**
 * The header value for an external user ID: the normalized ID's UTF-8 bytes in base64url without
 * padding (`encodeExternalUserIdHeader`). Null when the ID is not one a user list can hold, so no
 * header is sent for it. The ID never travels in a URL.
 */
internal fun encodeExternalUserIdHeader(id: String?): String? {
    val normalized = normalizeExternalUserId(id) ?: return null
    val bytes = normalized.encodeToByteArray()
    val out = StringBuilder()
    var i = 0
    while (i < bytes.size) {
        val b0 = bytes[i].toInt() and 0xFF
        val b1 = if (i + 1 < bytes.size) bytes[i + 1].toInt() and 0xFF else 0
        val b2 = if (i + 2 < bytes.size) bytes[i + 2].toInt() and 0xFF else 0
        val n = (b0 shl 16) or (b1 shl 8) or b2
        out.append(BASE64URL[(n shr 18) and 63]).append(BASE64URL[(n shr 12) and 63])
        if (i + 1 < bytes.size) out.append(BASE64URL[(n shr 6) and 63])
        if (i + 2 < bytes.size) out.append(BASE64URL[n and 63])
        i += 3
    }
    return out.toString()
}

internal fun codePointCount(value: String): Int {
    var count = 0
    var i = 0
    while (i < value.length) {
        i += if (value[i].isHighSurrogate() && i + 1 < value.length && value[i + 1].isLowSurrogate()) 2 else 1
        count++
    }
    return count
}
