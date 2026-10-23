package site.lempert.taleart.sdk.ui

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import site.lempert.taleart.sdk.delivery.DeliveryTale
import site.lempert.taleart.sdk.delivery.DeliveryTaleGroup

/** What a bar item shows in its ring. */
sealed interface CoverSource {
    /** A still image to load from [url]. */
    data class Image(val url: String) : CoverSource

    /** No image to show: the first tale's canvas colour (`#rrggbb` or `#rrggbbaa`), or null for the neutral placeholder. */
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
 * The picture a bar item shows, in the Web SDK's order (bar.ts `cover` and `defaultCover`): the
 * group's own cover (R12), else the lowest media of its tales in order (a document's media
 * background, then its image, video and sticker elements; a tale without a document has its
 * media), else the first tale's canvas colour, else the neutral placeholder.
 *
 * The Web SDK draws a video's first frame. The Delivery API sends no poster or thumbnail for a
 * video, and the SDK does not decode video yet, so a video candidate is skipped and the next image
 * candidate in that order is used instead: a group whose cover is a video still shows a picture
 * from its tales rather than a flat placeholder.
 */
fun coverSource(group: DeliveryTaleGroup): CoverSource {
    group.cover?.let { cover ->
        val url = mediaUrl(cover.url)
        if (url != null && cover.kind != "video") return CoverSource.Image(url)
    }
    return defaultCoverSource(group)
}

/**
 * A group's default cover (`defaultCover` in the Web SDK): [coverSource] without the group's own
 * cover. A banner slide shows it, as the Web SDK's banner does (`coverMedia`): the lowest image of
 * its tales in order, else the first tale's canvas colour, else the neutral placeholder.
 */
fun defaultCoverSource(group: DeliveryTaleGroup): CoverSource {
    for (tale in group.tales) imageCandidates(tale).firstOrNull()?.let { return CoverSource.Image(it) }
    val doc = group.tales.firstOrNull()?.document as? JsonObject
    return CoverSource.Placeholder(doc?.let(::canvasColor))
}

// A tale's image candidates, lowest first: its document's media background, then its image and
// sticker elements (video elements are skipped, see coverSource); a tale sent without a document
// (servers before R16) has its media, when that is an image.
private fun imageCandidates(tale: DeliveryTale): List<String> {
    val doc = tale.document as? JsonObject
    if (doc == null) {
        val media = tale.media ?: return emptyList()
        return listOfNotNull(mediaUrl(media.url)?.takeIf { media.kind != "video" })
    }
    val found = mutableListOf<String>()
    val background = (doc["canvas"] as? JsonObject)?.get("background") as? JsonObject
    if (background?.text("type") == "media") mediaUrl(background.text("url"))?.let(found::add)
    // The elements the renderer would draw: at most MAX_TALE_ELEMENTS, each with a box inside the schema's ranges.
    for (element in (doc["elements"] as? JsonArray).orEmpty().take(MAX_TALE_ELEMENTS)) {
        val el = element as? JsonObject ?: continue
        val type = el.text("type")
        if (type != "image" && type != "sticker") continue
        if (readBox(el["box"] as? JsonObject) == null) continue
        mediaUrl((el["props"] as? JsonObject)?.text("url"))?.let(found::add)
    }
    return found
}

private fun canvasColor(doc: JsonObject): String? {
    val color = ((doc["canvas"] as? JsonObject)?.get("background") as? JsonObject)?.text("color")
    return color?.takeIf { Regex("^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$").matches(it) }
}

private fun JsonObject.text(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content
