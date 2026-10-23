package site.lempert.taleart.sdk.ui

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import site.lempert.taleart.sdk.delivery.DeliveryTale
import site.lempert.taleart.sdk.delivery.DeliveryTaleGroup

/** What a bar item shows in its ring. */
sealed interface CoverSource {
    /** A picture: an image, or a video (drawn as the placeholder until the viewer story adds video). */
    data class Media(val kind: String, val url: String) : CoverSource

    /** No media to show: the first tale's canvas colour (`#rrggbb` or `#rrggbbaa`), or null for the neutral placeholder. */
    data class Placeholder(val color: String?) : CoverSource
}

/** An http or https URL, else null (`mediaUrl` in the Web SDK). */
internal fun mediaUrl(value: String?): String? {
    if (value == null) return null
    val scheme = value.substringBefore(':', "").lowercase()
    return if ((scheme == "http" || scheme == "https") && value.startsWith("$scheme://", ignoreCase = true) &&
        value.length > scheme.length + 3
    ) value else null
}

/**
 * The group's cover (R12) when it has one, else its default cover, as the Web SDK's bar picks it:
 * the lowest media element of its first tale that has media, else the first tale's canvas colour.
 */
fun coverSource(group: DeliveryTaleGroup): CoverSource {
    group.cover?.let { cover ->
        val url = mediaUrl(cover.url)
        if (url != null) return CoverSource.Media(if (cover.kind == "video") "video" else "image", url)
    }
    return defaultCover(group)
}

/** A group's default cover (web zones R12, Tale Studio R16), as `defaultCover` in the Web SDK. */
fun defaultCover(group: DeliveryTaleGroup): CoverSource {
    for (tale in group.tales) lowestMedia(tale)?.let { return it }
    val doc = group.tales.firstOrNull()?.document as? JsonObject
    return CoverSource.Placeholder(doc?.let(::canvasColor))
}

// A tale's lowest media element: its document's media background, else its first image, video or
// image sticker; a tale sent without a document (servers before R16) has its media.
private fun lowestMedia(tale: DeliveryTale): CoverSource.Media? {
    val doc = tale.document as? JsonObject
    if (doc == null) {
        val media = tale.media ?: return null
        val url = mediaUrl(media.url) ?: return null
        return CoverSource.Media(if (media.kind == "video") "video" else "image", url)
    }
    val background = ((doc["canvas"] as? JsonObject)?.get("background") as? JsonObject)
    if (background?.text("type") == "media") mediaUrl(background.text("url"))?.let { return CoverSource.Media("image", it) }
    for (element in (doc["elements"] as? JsonArray).orEmpty()) {
        val el = element as? JsonObject ?: continue
        val type = el.text("type")
        if (type != "image" && type != "video" && type != "sticker") continue
        val url = mediaUrl((el["props"] as? JsonObject)?.text("url")) ?: continue
        return CoverSource.Media(if (type == "video") "video" else "image", url)
    }
    return null
}

private fun canvasColor(doc: JsonObject): String? {
    val color = ((doc["canvas"] as? JsonObject)?.get("background") as? JsonObject)?.text("color")
    return color?.takeIf { Regex("^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$").matches(it) }
}

private fun JsonObject.text(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content
