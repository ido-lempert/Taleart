package site.lempert.taleart.sdk.ui

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import site.lempert.taleart.sdk.delivery.DeliveryTale

/** How long a document tale without a video plays when its document sets no `durationMs` (`DEFAULT_TALE_DURATION_MS`). */
const val DEFAULT_TALE_DURATION_MS = 7000L

/** How long a tale sent without a document (a server from before R16) plays (`LEGACY_TALE_DURATION_MS`, `IMAGE_DURATION_MS`). */
const val LEGACY_TALE_DURATION_MS = 5000L

/** The neutral colour of a tale with neither media nor a document (`LEGACY_PLACEHOLDER_COLOR`, `span.media` in the viewer). */
internal const val LEGACY_PLACEHOLDER_COLOR = "#1f2937"

/** How a picture fills its box: `cover` crops, `contain` shows the whole picture. */
enum class MediaFit { Cover, Contain }

/** What the stage draws full-bleed behind the tale's canvas, as the Web SDK viewer's `.media`. */
sealed interface StageMedia {
    /** The accessible name, or null when the media is decorative. */
    val label: String?

    data class Image(val url: String, val fit: MediaFit, override val label: String?) : StageMedia

    /** A video: the tale's clock, played to its end. */
    data class Video(val url: String, val fit: MediaFit, override val label: String?) : StageMedia

    /** A tale sent without a document and without usable media: a neutral block named by the tale. */
    data class Placeholder(override val label: String) : StageMedia
}

/**
 * A document's 9:16 canvas (AD-16): its background colour (when it paints one), its media
 * background, and its elements ([layer], story 9.5) over them.
 */
data class TaleCanvas(
    /** `#rrggbb` or `#rrggbbaa` painted across the canvas, or null when the stage media lies below it. */
    val color: String?,
    /** The canvas's media background, filling it with its fit. */
    val background: StageMedia.Image?,
    /** The tale's document as delivered, for the element layer. */
    val document: JsonObject,
    /** The canvas's accessible name: the tale's title, or `Tale N`. */
    val label: String,
    /** The document's elements the canvas draws: all but the tale's own media when the stage draws it. */
    val layer: DocumentLayer = DocumentLayer.EMPTY,
    /** The family name of each project font the tale's text uses, by font id in lower case (story 9.8). */
    val projectFonts: Map<String, String> = emptyMap(),
)

/**
 * A tale as the viewer draws it, read as `renderContent` in libs/web-sdk/src/lib/viewer.ts reads
 * it: the stage media and the colour behind it, the document's canvas, and how long it runs on the
 * timer when it has no video (or its video fails).
 */
data class TaleView(
    val media: StageMedia?,
    /** The colour painted across the stage behind the media, or null for the viewer's black. */
    val stageColor: String?,
    /** The document's canvas, or null for a tale sent without a document. */
    val canvas: TaleCanvas?,
    val durationMs: Long,
) {
    /** The stage's video, which runs the tale for its whole length, if any. */
    val video: StageMedia.Video? get() = media as? StageMedia.Video

    /**
     * The document's own video (R5) when the stage has none: it runs the tale, for 15 s at most
     * ([MAX_TALE_VIDEO_MS]), and a stall ends it ([VIDEO_STALL_MS]). Beside a stage video it only
     * loops along, muted.
     */
    val documentVideo: DocumentElement.Video? get() = if (video == null) canvas?.layer?.video else null

    /** The tale runs on a video (the stage's or the document's), not on the timer. */
    val runsOnVideo: Boolean get() = video != null || documentVideo != null

    /** The swipe-up link's destination, which a flick up opens (R7), or null. */
    val swipeUpHref: String? get() = canvas?.layer?.swipeUpHref

    companion object {
        /**
         * Reads tale [tale] (number [index] of its group, from 0). A tale with a document plays its
         * `durationMs` (7 s by default); its own media, while it is the bottom element and fills
         * the canvas, is drawn full-bleed in the stage (`stageTaleMedia`). A tale without one (a
         * server from before R16) shows its media for 5 s, named by its title.
         */
        fun read(tale: DeliveryTale, index: Int): TaleView {
            val label = tale.title.ifEmpty { "Tale ${index + 1}" }
            val doc = tale.document as? JsonObject
            if (doc == null) {
                val media = tale.media
                val url = mediaUrl(media?.url)
                val stage = when {
                    media?.kind == "image" && url != null -> StageMedia.Image(url, MediaFit.Contain, label)
                    media?.kind == "video" && url != null -> StageMedia.Video(url, MediaFit.Contain, label)
                    else -> StageMedia.Placeholder(label)
                }
                return TaleView(stage, null, null, LEGACY_TALE_DURATION_MS)
            }
            val duration = (doc["durationMs"] as? JsonPrimitive)?.takeIf { !it.isString }?.doubleOrNull
                ?.takeIf { it.isFinite() && it > 0 }?.toLong() ?: DEFAULT_TALE_DURATION_MS
            val media = stageTaleMedia(doc)?.let(::stageMediaOf)
            val color = documentCanvasColor(doc)
            val placeholder = (doc["placeholder"] as? JsonPrimitive)?.booleanOrNull == true
            val background = (doc.obj("canvas")?.obj("background"))?.takeIf { it.text("type") == "media" }?.let { bg ->
                mediaUrl(bg.text("url"))?.let { StageMedia.Image(it, mediaFit(bg.text("fit")), null) }
            }
            val canvas = TaleCanvas(
                // The canvas paints its colour unless the stage media lies below it; a media background brings its band colour.
                color = color?.takeIf { media == null || background != null },
                background = background,
                document = doc,
                label = label,
                // The stage draws the tale's own media; the canvas draws the rest (`elements.slice(1)`).
                layer = DocumentLayer.read(doc, skipFirst = media != null),
                projectFonts = tale.fonts.filter { it.family.isNotBlank() }.associate { it.id.lowercase() to it.family },
            )
            return TaleView(
                media = media,
                stageColor = color?.takeIf { media != null || placeholder },
                canvas = canvas,
                durationMs = duration,
            )
        }
    }
}

/** `cover` or `contain`; anything else is `cover` (`mediaFit` in the Web SDK). */
internal fun mediaFit(value: String?): MediaFit = if (value == "contain") MediaFit.Contain else MediaFit.Cover

/** The document's canvas colour when it is `#RRGGBB` or `#RRGGBBAA`, else null (`canvasColor`). */
internal fun documentCanvasColor(doc: JsonObject): String? {
    val color = doc.obj("canvas")?.obj("background")?.text("color")
    return color?.takeIf { Regex("^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$").matches(it) }
}

/**
 * The document's element drawn full-bleed behind the canvas, as tale media always was
 * (`stageTaleMedia` in the contract): its bottom element when it is the tale's own media
 * (`taleMedia`), with the full-canvas box, unrotated, unrounded and opaque.
 */
internal fun stageTaleMedia(doc: JsonObject): JsonObject? {
    val first = (doc["elements"] as? JsonArray)?.firstOrNull() as? JsonObject ?: return null
    val type = first.text("type")
    val props = first.obj("props") ?: return null
    if (type != "image" && type != "video") return null
    if ((props["taleMedia"] as? JsonPrimitive)?.booleanOrNull != true) return null
    val box = first.obj("box") ?: return null
    fun num(o: JsonObject, key: String) = (o[key] as? JsonPrimitive)?.takeIf { !it.isString }?.doubleOrNull
    val rotation = box["rotation"]?.let { num(box, "rotation") ?: return null } ?: 0.0
    val radius = props["radius"]?.let { num(props, "radius") ?: return null } ?: 0.0
    val opacity = props["opacity"]?.let { num(props, "opacity") ?: return null } ?: 1.0
    val full = num(box, "x") == 0.0 && num(box, "y") == 0.0 && num(box, "w") == 1.0 && num(box, "h") == 1.0
    return first.takeIf { full && rotation == 0.0 && radius == 0.0 && opacity == 1.0 }
}

// The stage media of a document element (`renderStageMedia`): named by its alt text, or decorative.
private fun stageMediaOf(element: JsonObject): StageMedia? {
    val props = element.obj("props") ?: return null
    val url = mediaUrl(props.text("url")) ?: return null
    val a11y = element.obj("a11y")
    val decorative = (a11y?.get("decorative") as? JsonPrimitive)?.booleanOrNull == true
    val label = if (decorative) null else a11y?.text("label")?.trim()?.ifEmpty { null }
    val fit = props.text("fit")
    return if (element.text("type") == "video") {
        StageMedia.Video(url, if (fit == "cover") MediaFit.Cover else MediaFit.Contain, label)
    } else {
        StageMedia.Image(url, mediaFit(fit), label)
    }
}

private fun JsonObject.obj(key: String): JsonObject? = this[key] as? JsonObject

private fun JsonObject.text(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content
