package site.lempert.taleart.sdk.delivery

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

// The Delivery API's zone, as `DeliveryZone` and its parts in libs/contract (openapi/ and
// src/generated/api.ts). The client ignores fields it does not know, so a newer server never breaks
// an older app; every field the renderers do not need at once has a default, as the Web SDK reads them.

/** A zone, named by site key and slug, with its display and tale groups (`DeliveryZone`). */
@Serializable
data class DeliveryZone(
    val id: String = "",
    val name: String = "",
    /** The zone's slug (epic UX rework R1). */
    val slug: String = "",
    /**
     * The zone's project theme (R9), every field filled with TaleArt's default. Kept as JSON until
     * a display renders it; the Web SDK falls back to its default theme when it is missing or invalid.
     */
    val theme: JsonObject? = null,
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
    /** The display's settings, every field filled with its default from the type's JSON Schema. */
    val settings: JsonObject = JsonObject(emptyMap()),
)

/** A published tale group placed in the zone (`DeliveryTaleGroup`). */
@Serializable
data class DeliveryTaleGroup(
    val id: String = "",
    /** The group's title. */
    val name: String = "",
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
    /** The tale's document (AD-15) as SDKs render it; null only from servers before R16. */
    val document: JsonObject? = null,
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
    val url: String = "",
    val weight: Int = 400,
    /** `normal` or `italic`. */
    val style: String = "normal",
)
