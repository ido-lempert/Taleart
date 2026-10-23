package site.lempert.taleart.sdk.ui

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.round
import kotlin.math.sin

// A delivered tale document (AD-15) read into the values the renderer draws, as the Web SDK's
// document renderer reads it (libs/web-sdk/src/lib/document/) with the contract's helpers
// (libs/contract/src/lib/tale-document.ts, text-style.ts): every value is checked again, and one
// that fails takes its default, so what reaches the screen is always a checked value. An element
// of a type this SDK does not know is skipped, so an older SDK still shows the rest of a tale.

/** The element types of the registry (`libs/contract/tale-document/element-types/registry.json`) this SDK draws; test-only types are not among them. */
val DOCUMENT_ELEMENT_TYPES: Set<String> = setOf("text", "image", "video", "shape", "emoji", "sticker", "button", "image-button", "swipe-up")

/** The canvas's width to height (`TALE_CANVAS_ASPECT`). */
const val CANVAS_ASPECT_WIDTH = 9.0
const val CANVAS_ASPECT_HEIGHT = 16.0

/** The longest a document's own video runs the tale (`MAX_TALE_VIDEO_MS`, R5). */
const val MAX_TALE_VIDEO_MS = 15_000L

/** A document's video that makes no progress for this long while it should play ends the tale (`VIDEO_STALL_MS`). */
const val VIDEO_STALL_MS = 5_000L

/** Where an element sits, as fractions of the canvas width (x, w) and height (y, h), and its rotation in degrees about its centre. */
data class ElementBox(val x: Double, val y: Double, val w: Double, val h: Double, val rotation: Double = 0.0)

/** The swipe-up link's box, whatever the element stores (`SWIPE_UP_BOX`). */
val SWIPE_UP_BOX = ElementBox(0.2, 0.87, 0.6, 0.09, 0.0)

/** The swipe-up link's label size as a fraction of the canvas height (`SWIPE_UP_FONT_SIZE`). */
const val SWIPE_UP_FONT_SIZE = 0.024

/** An outline button's edge as a fraction of the canvas height (`BUTTON_OUTLINE_WIDTH`). */
const val BUTTON_OUTLINE_WIDTH = 0.004

/** How much of the shorter side of its box an emoji's glyph fills (`EMOJI_BOX_FILL`). */
const val EMOJI_BOX_FILL = 0.8

/** The inline padding of a text's solid box, and of each line's highlight, in em (`TEXT_BOX_PADDING_EM`, `TEXT_HIGHLIGHT_PADDING_EM`). */
const val TEXT_BOX_PADDING_EM = 0.5
const val TEXT_HIGHLIGHT_PADDING_EM = 0.25

/** The CSS weight of a text stored before styling, whose props leave the weight out (`LEGACY_TEXT_WEIGHT`). */
const val LEGACY_TEXT_WEIGHT = 600

/** The direction a row of a tale reads in (AD-15). */
enum class ReadingDirection { Ltr, Rtl }

/** A system stack of the contract's font registry (`SYSTEM_FONT_STACKS`). */
enum class FontStack(val key: String) { Sans("sans"), Serif("serif"), Rounded("rounded"), Monospace("monospace") }

/** Where a text's font comes from (`TextFont`). */
sealed interface TextFont {
    data class System(val stack: FontStack) : TextFont
    data object Theme : TextFont
    /** A font-family list the host page loads on the web; natively only its generic families can be drawn. */
    data class Name(val family: String) : TextFont
    /** A font uploaded to the tale's project, by its id (lower case). */
    data class Project(val fontId: String) : TextFont
}

/** A text element's complete style (`TextStyle` and `resolveTextStyle` in the contract). */
data class TextLook(
    val font: TextFont = TextFont.System(FontStack.Sans),
    val fallback: FontStack = FontStack.Sans,
    /** A fraction of the canvas height. */
    val size: Double = 0.04,
    /** The CSS weight: 400, 500 or 700, or [LEGACY_TEXT_WEIGHT] when the props leave it out. */
    val weight: Int = LEGACY_TEXT_WEIGHT,
    val italic: Boolean = false,
    val color: String = "#ffffff",
    /** `start`, `center` or `end`; start and end follow the direction. */
    val align: String = "center",
    /** `auto`, `rtl` or `ltr`. */
    val direction: String = "auto",
    /** A multiple of the font size. */
    val lineHeight: Double = 1.25,
    /** `none`, `box` or `highlight`. */
    val background: String = "none",
    val backgroundColor: String = "#000000",
)

/** A shape's look (`ShapeStyle`). Lengths are fractions of the canvas height. */
data class ShapeLook(
    /** `rectangle`, `ellipse` or `line`. */
    val shape: String,
    val fill: String?,
    val stroke: String?,
    val strokeWidth: Double,
    val radius: Double,
    val opacity: Double,
)

/** A button's look (`ButtonStyle`). */
data class ButtonLook(val filled: Boolean, val color: String, val fill: String, val radius: Double)

/** One element the renderer draws, of a type of the registry. */
sealed interface DocumentElement {
    val id: String
    /** Where it is drawn: its box, or [SWIPE_UP_BOX] for the swipe-up link. */
    val box: ElementBox
    /** Its place in the z-order, from 1 at the bottom (`z-index`). */
    val layer: Int
    /** Hidden from assistive technology (`a11y.decorative`; never for a link). */
    val decorative: Boolean

    data class Text(
        override val id: String,
        override val box: ElementBox,
        override val layer: Int,
        override val decorative: Boolean,
        val text: String,
        val look: TextLook,
    ) : DocumentElement

    /** An image, or an image sticker ([sticker]: always `contain`, no corner radius). */
    data class Image(
        override val id: String,
        override val box: ElementBox,
        override val layer: Int,
        override val decorative: Boolean,
        val url: String,
        val fit: MediaFit,
        val radius: Double,
        val opacity: Double,
        /** Its alt text, or null when it is decorative or has none. */
        val alt: String?,
        val sticker: Boolean = false,
    ) : DocumentElement

    data class Video(
        override val id: String,
        override val box: ElementBox,
        override val layer: Int,
        override val decorative: Boolean,
        val url: String,
        val fit: MediaFit,
        val radius: Double,
        val opacity: Double,
        val alt: String?,
    ) : DocumentElement

    data class Shape(
        override val id: String,
        override val box: ElementBox,
        override val layer: Int,
        override val decorative: Boolean,
        val look: ShapeLook,
        /** Its accessible name; a shape without one is decorative. */
        val label: String?,
    ) : DocumentElement

    data class Emoji(
        override val id: String,
        override val box: ElementBox,
        override val layer: Int,
        override val decorative: Boolean,
        val emoji: String,
        /** With a label it is an image named by it; without one, text read by the emoji's own name. */
        val label: String?,
    ) : DocumentElement

    /** A call to action that opens [href] (`button`). */
    data class Button(
        override val id: String,
        override val box: ElementBox,
        override val layer: Int,
        val label: String,
        val href: String,
        val look: ButtonLook,
    ) : DocumentElement {
        override val decorative: Boolean get() = false
    }

    /** A custom image button (`image-button`), named by its alt text or its destination's host. */
    data class ImageButton(
        override val id: String,
        override val box: ElementBox,
        override val layer: Int,
        val url: String,
        val href: String,
        val radius: Double,
        val name: String,
    ) : DocumentElement {
        override val decorative: Boolean get() = false
    }

    /** The swipe-up link (`swipe-up`): a label under an arrow, pinned to the bottom safe area. */
    data class SwipeUp(
        override val id: String,
        override val box: ElementBox,
        override val layer: Int,
        val label: String,
        val href: String,
        val color: String,
        val background: String,
    ) : DocumentElement {
        override val decorative: Boolean get() = false
    }
}

/**
 * A document's elements as the renderer draws them: those of a known type, in reading order (the
 * order screen readers follow), each with its layer in the z-order. [skipped] lists the element
 * types left out because this SDK does not know them.
 */
data class DocumentLayer(
    val elements: List<DocumentElement>,
    val direction: ReadingDirection,
    val skipped: List<String> = emptyList(),
) {
    /** The video that runs the tale when the stage has none: the first video in reading order, as the web's `querySelector('video')`. */
    val video: DocumentElement.Video? get() = elements.firstNotNullOfOrNull { it as? DocumentElement.Video }

    /** The swipe-up link's destination, which a flick up opens (R7), or null. */
    val swipeUpHref: String? get() = elements.firstNotNullOfOrNull { (it as? DocumentElement.SwipeUp)?.href }

    companion object {
        val EMPTY = DocumentLayer(emptyList(), ReadingDirection.Ltr)

        /**
         * Reads [doc]'s elements, as `renderTaleDocument` does: [skipFirst] leaves out the bottom
         * element when the stage draws it (the tale's own media); hidden elements and elements
         * without a type, props or a box of finite numbers are left out; one swipe-up link at most.
         */
        fun read(doc: JsonObject, skipFirst: Boolean = false): DocumentLayer {
            val all = (doc["elements"] as? JsonArray).orEmpty().let { if (skipFirst) it.drop(1) else it }
            val placeable = all.mapNotNull { raw ->
                val e = raw as? JsonObject ?: return@mapNotNull null
                val type = e.text("type") ?: return@mapNotNull null
                val props = e["props"] as? JsonObject ?: return@mapNotNull null
                val box = readBox(e["box"] as? JsonObject) ?: return@mapNotNull null
                if ((e["hidden"] as? JsonPrimitive)?.booleanOrNull == true) return@mapNotNull null
                Placed(e, type, props, box)
            }
            val direction = taleReadingDirection(placeable)
            val layers = placeable.withIndex().associate { (i, p) -> p to i + 1 }
            val skipped = mutableListOf<String>()
            var swipeUp = false
            val elements = readingOrder(placeable, direction).mapNotNull { p ->
                if (p.type !in DOCUMENT_ELEMENT_TYPES) {
                    if (p.type !in skipped) skipped += p.type
                    return@mapNotNull null
                }
                if (p.type == "swipe-up") {
                    if (swipeUp) return@mapNotNull null
                    swipeUp = true
                }
                readElement(p, layers.getValue(p))
            }
            return DocumentLayer(elements, direction, skipped)
        }
    }
}

// An element with a type, props and a box of finite numbers.
internal class Placed(val json: JsonObject, val type: String, val props: JsonObject, val box: ElementBox)

private fun readBox(box: JsonObject?): ElementBox? {
    if (box == null) return null
    fun n(key: String) = box.number(key)
    return ElementBox(n("x") ?: return null, n("y") ?: return null, n("w") ?: return null, n("h") ?: return null, n("rotation") ?: return null)
}

private fun readElement(p: Placed, layer: Int): DocumentElement? {
    val id = p.json.text("id").orEmpty()
    val a11y = p.json["a11y"] as? JsonObject
    val decorative = (a11y?.get("decorative") as? JsonPrimitive)?.booleanOrNull == true
    val rawLabel = a11y?.text("label")
    val props = p.props
    return when (p.type) {
        "text" -> {
            val text = props.text("text")?.let { cleanText(it, lineFeeds = true) }.orEmpty()
            if (text.isEmpty()) null else DocumentElement.Text(id, p.box, layer, decorative, text, resolveTextLook(props))
        }
        "image", "sticker" -> {
            val url = mediaUrl(props.text("url")) ?: return null
            val sticker = p.type == "sticker"
            DocumentElement.Image(
                id, p.box, layer, decorative, url,
                fit = if (sticker) MediaFit.Contain else mediaFit(props.text("fit")),
                radius = if (sticker) 0.0 else props.numberIn("radius", 0.0, 0.5, 0.0),
                opacity = props.numberIn("opacity", 0.0, 1.0, 1.0),
                alt = altText(decorative, rawLabel),
                sticker = sticker,
            )
        }
        "video" -> {
            val url = mediaUrl(props.text("url")) ?: return null
            DocumentElement.Video(
                id, p.box, layer, decorative, url, mediaFit(props.text("fit")),
                radius = props.numberIn("radius", 0.0, 0.5, 0.0),
                opacity = props.numberIn("opacity", 0.0, 1.0, 1.0),
                alt = altText(decorative, rawLabel),
            )
        }
        "shape" -> resolveShapeLook(props)?.let { look ->
            DocumentElement.Shape(id, p.box, layer, decorative, look, labelOf(decorative, rawLabel))
        }
        "emoji" -> {
            val emoji = props.text("emoji")?.let { codePoints(cleanText(it, lineFeeds = false)).take(64).joinToString("") }.orEmpty()
            if (emoji.isBlank()) null else DocumentElement.Emoji(id, p.box, layer, decorative, emoji, labelOf(decorative, rawLabel))
        }
        "button" -> {
            val label = linkLabel(props.text("label"))
            val href = props.text("href")?.takeIf(::isLinkUrl)
            if (label.isEmpty() || href == null) null
            else DocumentElement.Button(id, p.box, layer, label, href, resolveButtonLook(props))
        }
        "image-button" -> {
            val href = props.text("href")?.takeIf(::isLinkUrl) ?: return null
            val url = mediaUrl(props.text("url")) ?: return null
            val name = linkLabel(rawLabel).ifEmpty { linkHost(href) }
            DocumentElement.ImageButton(id, p.box, layer, url, href, props.numberIn("radius", 0.0, 0.5, 0.0), name)
        }
        "swipe-up" -> {
            val label = linkLabel(props.text("label"))
            val href = props.text("href")?.takeIf(::isLinkUrl)
            if (label.isEmpty() || href == null) null
            else DocumentElement.SwipeUp(
                id, SWIPE_UP_BOX, layer, label, href,
                color = props.color("color") ?: "#FFFFFF",
                background = props.color("background") ?: "#000000B3",
            )
        }
        else -> null
    }
}

// The element's alt text, or null when it is decorative or has none.
private fun altText(decorative: Boolean, label: String?): String? = if (decorative) null else label?.trim()?.ifEmpty { null }

// The element's accessible name, cleaned to one line, or null when it is decorative or has none.
private fun labelOf(decorative: Boolean, label: String?): String? =
    if (decorative) null else label?.let { cleanText(it, lineFeeds = false).trim() }?.ifEmpty { null }

/** A text's style from props of any trust (`resolveTextStyle`): each value that passes its rule, else the default. */
fun resolveTextLook(props: JsonObject): TextLook {
    val d = TextLook()
    val fallback = FontStack.entries.firstOrNull { it.key == props.text("fallback") }
    val weight = when (props.text("weight")) {
        "regular" -> 400
        "medium" -> 500
        "bold" -> 700
        else -> LEGACY_TEXT_WEIGHT
    }
    return TextLook(
        font = readTextFont(props["font"] as? JsonObject, fallback) ?: d.font,
        fallback = fallback ?: d.fallback,
        size = props.numberIn("size", 0.01, 0.2, d.size),
        weight = weight,
        italic = (props["italic"] as? JsonPrimitive)?.takeIf { !it.isString }?.booleanOrNull ?: d.italic,
        color = props.color("color") ?: d.color,
        align = props.text("align")?.takeIf { it in setOf("start", "center", "end") } ?: d.align,
        direction = props.text("direction")?.takeIf { it in setOf("auto", "rtl", "ltr") } ?: d.direction,
        lineHeight = props.numberIn("lineHeight", 0.8, 3.0, d.lineHeight),
        background = props.text("background")?.takeIf { it in setOf("none", "box", "highlight") } ?: d.background,
        backgroundColor = props.color("backgroundColor") ?: d.backgroundColor,
    )
}

private val FONT_ID = Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")

// The contract's font-list rule (`isFontFamily`), as TaleartTheme reads a theme's font.
private const val FONT_KEYWORDS = "inherit|initial|unset|revert|revert-layer|default"
private const val FONT_NAME = """(?:[A-Za-z][A-Za-z0-9 -]*|"[A-Za-z0-9 -]+"|'[A-Za-z0-9 -]+')"""
private val FONT_FAMILY_LIST = Regex(
    """^(?!.*(?:^|[\s,"'])(?:$FONT_KEYWORDS)(?=$|[\s,"']))(?!.*(?:^|[\s,"'])taleart-font-)\s*$FONT_NAME\s*(?:,\s*$FONT_NAME\s*)*$""",
    RegexOption.IGNORE_CASE,
)

/** True for a font-family list that passes the contract's font-list rule (`isFontFamily`). */
internal fun isFontFamily(value: String): Boolean = value.length <= 200 && FONT_FAMILY_LIST.matches(value)

// `readTextFont`: an unknown source, or a project font without a usable id, draws in the fallback stack.
private fun readTextFont(font: JsonObject?, fallback: FontStack?): TextFont? {
    if (font == null) return null
    val fallbackFont = fallback?.let { TextFont.System(it) }
    return when (font.text("source")) {
        "system" -> FontStack.entries.firstOrNull { it.key == font.text("stack") }?.let { TextFont.System(it) }
        "theme" -> TextFont.Theme
        "name" -> font.text("family")?.takeIf(::isFontFamily)?.let { TextFont.Name(it) }
        "project" -> font.text("fontId")?.takeIf { FONT_ID.matches(it) }?.let { TextFont.Project(it.lowercase()) } ?: fallbackFont
        else -> fallbackFont
    }
}

/** A shape's look from props of any trust (`resolveShapeStyle`); null for an unknown shape. */
fun resolveShapeLook(props: JsonObject): ShapeLook? {
    val shape = props.text("shape")?.takeIf { it == "rectangle" || it == "ellipse" || it == "line" } ?: return null
    val stroke = props.color("stroke")
    return ShapeLook(
        shape = shape,
        fill = if (shape == "line") null else props.color("fill"),
        stroke = stroke,
        strokeWidth = if (stroke == null) 0.0 else props.numberIn("strokeWidth", 0.0, 0.05, 0.0),
        radius = if (shape == "rectangle") props.numberIn("radius", 0.0, 0.5, 0.0) else 0.0,
        opacity = props.numberIn("opacity", 0.0, 1.0, 1.0),
    )
}

/** A button's look from props of any trust (`resolveButtonStyle`): a filled white button with near-black text by default. */
fun resolveButtonLook(props: JsonObject): ButtonLook = ButtonLook(
    filled = props.text("variant") != "outline",
    color = props.color("color") ?: "#111827",
    fill = props.color("fill") ?: "#FFFFFF",
    radius = props.numberIn("radius", 0.0, 0.5, 0.0),
)

/** A button's label size as a fraction of the canvas height (`buttonFontSize`): 40 % of its box's height, at most 6 % of the canvas. */
fun buttonFontSize(box: ElementBox): Double = round(min(box.h * 0.4, 0.06) * 100000) / 100000

/** An emoji's size as a fraction of the canvas height (`emojiFontSize`): 80 % of the shorter side of its box on the 9:16 canvas. */
fun emojiFontSize(box: ElementBox): Double {
    val side = min(box.h, box.w * CANVAS_ASPECT_WIDTH / CANVAS_ASPECT_HEIGHT)
    return round(side * EMOJI_BOX_FILL * 100000) / 100000
}

// ---- Text rules -----------------------------------------------------------------------------

// The UTF-16 units the character at `i` takes when it is allowed, else 0 (`allowedWidth`): C0
// controls (a line feed only where kept), DEL, C1 controls, lone surrogates and the bidi
// embeddings and overrides U+202A to U+202E are not.
private fun allowedWidth(text: String, i: Int, lineFeeds: Boolean): Int {
    val code = text[i].code
    if (code in 0xD800..0xDBFF) {
        val next = if (i + 1 < text.length) text[i + 1].code else 0
        return if (next in 0xDC00..0xDFFF) 2 else 0
    }
    if (code in 0xDC00..0xDFFF) return 0
    if (code <= 0x1F) return if (code == 0x0A && lineFeeds) 1 else 0
    if (code in 0x7F..0x9F) return 0
    if (code in 0x202A..0x202E) return 0
    return 1
}

/** The text without the characters the contract does not allow in it (`cleanText`). */
fun cleanText(text: String, lineFeeds: Boolean): String {
    val clean = StringBuilder()
    var i = 0
    while (i < text.length) {
        val width = allowedWidth(text, i, lineFeeds)
        if (width == 0) i++ else {
            clean.append(text, i, i + width)
            i += width
        }
    }
    return clean.toString()
}

// The string's characters as code points (a surrogate pair is one), as JavaScript's `[...text]`.
private fun codePoints(text: String): List<String> {
    val out = ArrayList<String>(text.length)
    var i = 0
    while (i < text.length) {
        val pair = text[i].isHighSurrogate() && i + 1 < text.length && text[i + 1].isLowSurrogate()
        out += text.substring(i, if (pair) i + 2 else i + 1)
        i += if (pair) 2 else 1
    }
    return out
}

/** A link's label as drawn (`linkLabel`): one line, without the characters a label may not hold, at most 80 characters. */
fun linkLabel(value: String?): String {
    if (value == null) return ""
    val spaced = StringBuilder()
    var inSpace = false
    for (c in value) {
        if (c.isWhitespace()) {
            if (!inSpace) spaced.append(' ')
            inSpace = true
        } else {
            spaced.append(c)
            inSpace = false
        }
    }
    return codePoints(cleanText(spaced.toString(), lineFeeds = false)).take(80).joinToString("").trim()
}

// Characters no link may hold (`LINK_URL_BAD_CHARACTER`).
private fun isBadUrlCharacter(c: Char): Boolean {
    val code = c.code
    return code <= 0x20 || code in 0x7F..0xA0 || code == 0xAD || code == 0x61C || code == 0x1680 ||
        code in 0x2000..0x200F || code in 0x2028..0x202F || code == 0x205F || code in 0x2066..0x2069 ||
        code == 0x3000 || code == 0xFEFF
}

/**
 * True when [value] is a destination a link may open (`isLinkUrl`): an absolute `http` or `https`
 * URL of at most 2,048 characters, with a host, without credentials, spaces or control characters.
 * The server checked it on write; the SDK checks it again before it draws a link.
 */
fun isLinkUrl(value: String?): Boolean {
    if (value.isNullOrEmpty() || value.length > 2048) return false
    if (value.any(::isBadUrlCharacter)) return false
    val scheme = value.substringBefore("://", "")
    if (!scheme.equals("http", ignoreCase = true) && !scheme.equals("https", ignoreCase = true)) return false
    val authority = value.substring(scheme.length + 3).split('/', '?', '#', '\\').first()
    if (authority.contains('@')) return false
    return linkHost(value).isNotEmpty()
}

// The host of an http(s) URL, lower case, without its port.
private fun linkHost(href: String): String {
    val authority = href.substringAfter("://").split('/', '?', '#', '\\').first()
    val host = if (authority.startsWith("[")) authority.substringBefore("]") + "]" else authority.substringBefore(':')
    return host.lowercase()
}

// ---- Reading order (AD-15) -----------------------------------------------------------------

// Letters of the scripts written right to left (`RTL_LETTER`), by code point.
private fun isRtlLetter(cp: Int): Boolean =
    cp in 0x0590..0x08FF || cp in 0xFB1D..0xFDFF || cp in 0xFE70..0xFEFF || cp in 0x1E900..0x1E95F || cp in 0x10D00..0x10D3F

/** The direction of the text's first strong character, as `dir="auto"` takes it, or null when it has no letter (`firstStrongDirection`). */
fun firstStrongDirection(text: String): ReadingDirection? {
    var i = 0
    while (i < text.length) {
        val c = text[i]
        if (c.isHighSurrogate() && i + 1 < text.length && text[i + 1].isLowSurrogate()) {
            val cp = 0x10000 + ((c.code - 0xD800) shl 10) + (text[i + 1].code - 0xDC00)
            when {
                isRtlLetter(cp) -> return ReadingDirection.Rtl
                // Supplementary letters: historic scripts, CJK extensions, mathematical letters; emoji are not letters.
                cp in 0x10000..0x1EFFF || cp in 0x20000..0x3FFFF -> if (cp !in 0x1D000..0x1D3FF) return ReadingDirection.Ltr
            }
            i += 2
            continue
        }
        if (c.isLetter()) return if (isRtlLetter(c.code)) ReadingDirection.Rtl else ReadingDirection.Ltr
        i++
    }
    return null
}

// The tale's own direction (`taleReadingDirection`): the majority of its texts; on a tie, the first text in the canvas.
internal fun taleReadingDirection(elements: List<Placed>): ReadingDirection {
    var rtl = 0
    var ltr = 0
    var first: Triple<Double, Double, ReadingDirection>? = null
    for (e in elements) {
        if (e.type != "text") continue
        val dir = when (e.props.text("direction")) {
            "rtl" -> ReadingDirection.Rtl
            "ltr" -> ReadingDirection.Ltr
            else -> e.props.text("text")?.let(::firstStrongDirection)
        } ?: continue
        if (dir == ReadingDirection.Rtl) rtl++ else ltr++
        val (x, y) = e.box.x to e.box.y
        val f = first
        if (f == null || y < f.first || (y == f.first && x < f.second)) first = Triple(y, x, dir)
    }
    if (rtl != ltr) return if (rtl > ltr) ReadingDirection.Rtl else ReadingDirection.Ltr
    return first?.third ?: ReadingDirection.Ltr
}

/** The upright rectangle a rotated box covers on the 9:16 canvas (`elementBounds`). */
fun elementBounds(box: ElementBox): ElementBox {
    if (box.rotation == 0.0) return box.copy(rotation = 0.0)
    val angle = box.rotation * PI / 180
    val c = abs(cos(angle))
    val s = abs(sin(angle))
    val halfW = box.w * CANVAS_ASPECT_WIDTH / 2
    val halfH = box.h * CANVAS_ASPECT_HEIGHT / 2
    val w = 2 * (c * halfW + s * halfH) / CANVAS_ASPECT_WIDTH
    val h = 2 * (s * halfW + c * halfH) / CANVAS_ASPECT_HEIGHT
    return ElementBox(box.x + box.w / 2 - w / 2, box.y + box.h / 2 - h / 2, w, h, 0.0)
}

/** The tallest element, as a fraction of the canvas height, that takes others into its reading row (`READING_ROW_MAX_HEIGHT`). */
const val READING_ROW_MAX_HEIGHT = 0.5

// `sameReadingRow`.
private fun sameReadingRow(anchor: ElementBox, item: ElementBox): Boolean {
    if (anchor.h > READING_ROW_MAX_HEIGHT || item.h > READING_ROW_MAX_HEIGHT) return false
    val centre = item.y + item.h / 2
    if (centre >= anchor.y && centre <= anchor.y + anchor.h) return true
    val overlap = min(anchor.y + anchor.h, item.y + item.h) - maxOf(anchor.y, item.y)
    return overlap > 0 && overlap >= min(anchor.h, item.h) / 2
}

// `readingOrder`: top to bottom, then along each row in the tale's direction; ties keep the z-order.
internal fun readingOrder(elements: List<Placed>, direction: ReadingDirection): List<Placed> {
    class Item(val placed: Placed, val index: Int, val at: ElementBox)
    val items = elements.mapIndexed { i, e -> Item(e, i, if (e.type == "swipe-up") SWIPE_UP_BOX else elementBounds(e.box)) }
        .sortedWith(compareBy<Item> { it.at.y }.thenBy { it.index })
    val rows = mutableListOf<MutableList<Item>>()
    for (item in items) {
        val row = rows.lastOrNull { sameReadingRow(it[0].at, item.at) }
        if (row != null) row += item else rows += mutableListOf(item)
    }
    val across: Comparator<Item> = if (direction == ReadingDirection.Rtl) {
        compareByDescending { it.at.x + it.at.w }
    } else {
        compareBy { it.at.x }
    }
    return rows.flatMap { row -> row.sortedWith(across.thenBy { it.at.y }.thenBy { it.index }).map { it.placed } }
}

// ---- JSON helpers --------------------------------------------------------------------------

private val HEX_COLOR = Regex("^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")

private fun JsonObject.text(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content

private fun JsonObject.number(key: String): Double? =
    (this[key] as? JsonPrimitive)?.takeIf { !it.isString }?.doubleOrNull?.takeIf { it.isFinite() }

private fun JsonObject.numberIn(key: String, min: Double, max: Double, fallback: Double): Double =
    number(key)?.takeIf { it in min..max } ?: fallback

private fun JsonObject.color(key: String): String? = text(key)?.takeIf { HEX_COLOR.matches(it) }
