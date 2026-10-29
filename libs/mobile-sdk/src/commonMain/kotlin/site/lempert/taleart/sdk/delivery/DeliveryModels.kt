package site.lempert.taleart.sdk.delivery

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.intOrNull

// The Delivery API's zone, as `DeliveryZone` and its parts in libs/contract (openapi/openapi.yaml
// and src/generated/api.ts); ContractModelsTest checks the field names against the spec.
//
// The zone is read field by field, as the Web SDK reads it: once the body has the shape the
// renderers rely on (`isZone`), a field of the wrong type takes its default and a tale or font that
// is not an object is left out, so one odd field never costs the whole zone. Fields the client does
// not know are ignored, so a newer server never breaks an older app.

/** A zone, named by site key and slug, with its display and tale groups (`DeliveryZone`). */
@Serializable
data class DeliveryZone(
    val id: String = "",
    val name: String = "",
    /** The zone's slug (epic UX rework R1). */
    val slug: String = "",
    /**
     * The zone's project theme (R9), every field filled with TaleArt's default. Kept as JSON as
     * sent until a display renders it; the Web SDK falls back to its default theme when it is invalid.
     */
    val theme: JsonElement? = null,
    /** The zone's display (AD-17), or null when it has none; a zone without a display lists no tale group. */
    val frame: DeliveryFrame? = null,
    /** The published tale groups placed in the zone, in the zone's order (AD-2, AD-14). */
    val taleGroups: List<DeliveryTaleGroup> = emptyList(),
)

/** A zone's display (`DeliveryFrame`). Clients skip types they do not know (AD-5). */
@Serializable
data class DeliveryFrame(
    val id: String = "",
    /** A display type key, such as `bar` or `banner`. */
    val type: String = "",
    /** The display's settings as sent, every field filled with its default from the type's JSON Schema. */
    val settings: JsonElement? = null,
)

/** A published tale group placed in the zone (`DeliveryTaleGroup`). */
@Serializable
data class DeliveryTaleGroup(
    val id: String = "",
    /** The group's title. */
    val name: String = "",
    /**
     * The names of the group's targeting tags (epic targeting R2), empty when it has none. The SDK
     * shows the group when the viewer's tags pass its rule (`TaleartConfig.tags`), never sending them.
     */
    val tags: List<String> = emptyList(),
    /** How the tags combine: `any` (the default) or `all`. */
    val tagMatch: String = "any",
    /**
     * True when the group is targeted to user lists and the viewer's external user ID is in one of
     * them (epic targeting R4). The SDK sends the viewer's external user ID in its own header
     * (`TaleartConfig.externalUserId`), and the Delivery API sets this flag from it.
     */
    val userListMatched: Boolean = false,
    /** The group's cover, or null when it has none. */
    val cover: DeliveryCover? = null,
    /** The group's published tales by position. */
    val tales: List<DeliveryTale> = emptyList(),
)

/** A published tale (`DeliveryTale`). */
@Serializable
data class DeliveryTale(
    val id: String = "",
    val title: String = "",
    /** The tale's image, GIF or video, or null; kept for SDKs from before documents. */
    val media: DeliveryMedia? = null,
    /** The tale's document (AD-15) as sent, for the viewer to check; null only from servers before R16. */
    val document: JsonElement? = null,
    /** The project fonts the document's visible text uses (R18); empty when it uses none. */
    val fonts: List<DeliveryFont> = emptyList(),
)

/** A tale's media (`DeliveryMedia`): an absolute, public URL that needs no key (AD-11). */
@Serializable
data class DeliveryMedia(
    /** `image` or `video`. */
    val kind: String = "",
    val contentType: String = "",
    val url: String = "",
)

/** A tale group's cover (`DeliveryCover`). */
@Serializable
data class DeliveryCover(
    val kind: String = "",
    val contentType: String = "",
    /** True when the cover moves; clients show it still when the person prefers reduced motion. */
    val animated: Boolean = false,
    val url: String = "",
)

/** A project font a tale's document uses (`DeliveryFont`). */
@Serializable
data class DeliveryFont(
    val id: String = "",
    /**
     * The face's family name, as the project stores it; empty from servers before story 9.8.
     * Mobile SDKs draw the text in a font the host app installed under this name (they never
     * download project fonts), else its fallback stack.
     */
    val family: String = "",
    val url: String = "",
    val weight: Int = 400,
    /** `normal` or `italic`. */
    val style: String = "normal",
)

// Reads a body that passed `isZone` field by field; see the note at the top of the file.
internal fun readZone(body: JsonObject): DeliveryZone = DeliveryZone(
    id = body.string("id"),
    name = body.string("name"),
    slug = body.string("slug"),
    theme = body["theme"],
    frame = (body["frame"] as? JsonObject)?.let { frame ->
        DeliveryFrame(id = frame.string("id"), type = frame.string("type"), settings = frame["settings"])
    },
    taleGroups = body.objects("taleGroups").map { group ->
        DeliveryTaleGroup(
            id = group.string("id"),
            name = group.string("name"),
            tags = (group["tags"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content }.orEmpty(),
            tagMatch = group.string("tagMatch", "any").takeIf { it == "any" || it == "all" } ?: "any",
            userListMatched = (group["userListMatched"] as? JsonPrimitive)?.booleanOrNull ?: false,
            cover = (group["cover"] as? JsonObject)?.let { cover ->
                DeliveryCover(
                    kind = cover.string("kind"),
                    contentType = cover.string("contentType"),
                    animated = (cover["animated"] as? JsonPrimitive)?.booleanOrNull ?: false,
                    url = cover.string("url"),
                )
            },
            tales = group.objects("tales").map { tale ->
                DeliveryTale(
                    id = tale.string("id"),
                    title = tale.string("title"),
                    media = (tale["media"] as? JsonObject)?.let { media ->
                        DeliveryMedia(kind = media.string("kind"), contentType = media.string("contentType"), url = media.string("url"))
                    },
                    document = tale["document"],
                    fonts = tale.objects("fonts").map { font ->
                        DeliveryFont(
                            id = font.string("id"),
                            family = font.string("family"),
                            url = font.string("url"),
                            weight = (font["weight"] as? JsonPrimitive)?.takeIf { !it.isString }?.intOrNull ?: 400,
                            style = font.string("style", "normal"),
                        )
                    },
                )
            },
        )
    },
)

// A text field, or its default when it is missing or not text.
private fun JsonObject.string(key: String, default: String = ""): String =
    (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: default

// The objects of a list field; anything in it that is not an object is left out.
private fun JsonObject.objects(key: String): List<JsonObject> =
    (this[key] as? JsonArray)?.filterIsInstance<JsonObject>().orEmpty()
