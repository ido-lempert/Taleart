package site.lempert.taleart.sdk.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.layout.wrapContentSize
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsPropertyKey
import androidx.compose.ui.semantics.SemanticsPropertyReceiver
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.isTraversalGroup
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.traversalIndex
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDirection
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.zIndex
import coil3.ImageLoader
import coil3.compose.AsyncImage
import kotlin.math.roundToInt

/** Test tag of each element the document layer draws; its [DocumentElementId] names it. */
const val DOCUMENT_ELEMENT_TAG = "taleart-document-element"

/** The id of the document element a node draws; for tests. */
val DocumentElementId = SemanticsPropertyKey<String>("TaleartDocumentElementId")
private var SemanticsPropertyReceiver.documentElementId by DocumentElementId

/**
 * How the document's own video plays (R5): the viewer drives it as the tale's clock, or beside the
 * stage's video, where it only loops along. Null (the default) shows its first frame, still.
 */
internal class DocumentVideoPlayback(
    /** It plays now. */
    val playing: Boolean,
    /** It runs the tale: its progress, end and failure go to the viewer. Otherwise it loops, silent. */
    val clock: Boolean,
    /** A new run (Play after its end) starts it again. */
    val run: Int,
    val onProgress: (positionMs: Long, durationMs: Long) -> Unit = { _, _ -> },
    val onEnded: () -> Unit = {},
    val onError: () -> Unit = {},
)

/**
 * Draws a tale document's elements (AD-16) on its 9:16 canvas, which this layer fills, as
 * `renderTaleDocument` in libs/web-sdk/src/lib/document/renderer.ts does: each element placed from
 * its box (fractions of the canvas width and height), turned by its rotation about its centre,
 * stacked in the document's z-order, and read by screen readers in [DocumentLayer]'s reading
 * order. Sizes are fractions of the canvas height, as the web's `cqh`, so a tale scales with its
 * canvas on every screen. Links open in the system browser through [LocalUriHandler], or go
 * nowhere with [inertLinks] (a preview of a draft). [themeFont] is the project theme's font list,
 * for texts that take the theme font. [topChrome] is how far down the canvas the host's controls
 * reach (the viewer's top bar), which a native video view must not cover.
 */
@Composable
internal fun DocumentElementsLayer(
    layer: DocumentLayer,
    modifier: Modifier = Modifier,
    themeFont: String? = null,
    imageLoader: ImageLoader = rememberCoverImageLoader(),
    video: DocumentVideoPlayback? = null,
    inertLinks: Boolean = false,
    topChrome: Dp = 0.dp,
) {
    // Boxes are placed from the canvas's left edge whatever the host's layout direction, as the
    // web's `left:`; each text keeps its own direction (`TextStyle.textDirection`).
    CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Ltr) {
        BoxWithConstraints(modifier.fillMaxSize().semantics { isTraversalGroup = true }) {
            val density = LocalDensity.current
            val width = constraints.maxWidth.toFloat()
            val height = constraints.maxHeight.toFloat()
            if (width <= 0f || height <= 0f) return@BoxWithConstraints
            val canvas = CanvasMetrics(width, height, density)
            layer.elements.forEachIndexed { index, element ->
                key(element.id, index) {
                    Element(element, index, canvas, themeFont, imageLoader, video, inertLinks, layer.elements.filter { it.layer > element.layer }, topChrome)
                }
            }
        }
    }
}

// The canvas's size in pixels and the density that turns pixels into dp and sp.
private class CanvasMetrics(val width: Float, val height: Float, val density: Density) {
    /** A fraction of the canvas height in pixels. */
    fun h(fraction: Double): Float = (fraction * height).toFloat()
    fun dp(px: Float): Dp = with(density) { px.toDp() }
    // Text sizes follow the canvas, never the person's font scale, as the web's `cqh`: the sp that
    // the density (with its font scale, linear or not, as Android 14's) turns back into these pixels.
    fun sp(px: Float): TextUnit = with(density) { px.toSp() }
}

// The element's place on the canvas: its box, its layer in the z-order, its rotation, and its place in the reading order.
private fun Modifier.placed(element: DocumentElement, index: Int, canvas: CanvasMetrics, rotate: Boolean = true): Modifier {
    val box = element.box
    val x = (box.x * canvas.width).roundToInt()
    val y = (box.y * canvas.height).roundToInt()
    val w = (box.w * canvas.width).roundToInt().coerceAtLeast(0)
    val h = (box.h * canvas.height).roundToInt().coerceAtLeast(0)
    return this
        .zIndex(element.layer.toFloat())
        .offset { IntOffset(x, y) }
        .requiredSize(canvas.dp(w.toFloat()), canvas.dp(h.toFloat()))
        .then(if (rotate && box.rotation != 0.0) Modifier.graphicsLayer { rotationZ = box.rotation.toFloat() } else Modifier)
        .testTag(DOCUMENT_ELEMENT_TAG)
        .semantics {
            documentElementId = element.id
            traversalIndex = index.toFloat()
        }
}

@Composable
private fun Element(
    element: DocumentElement,
    index: Int,
    canvas: CanvasMetrics,
    themeFont: String?,
    loader: ImageLoader,
    video: DocumentVideoPlayback?,
    inertLinks: Boolean,
    above: List<DocumentElement>,
    topChrome: Dp,
) {
    val player = LocalTaleVideoPlayer.current ?: remember { platformTaleVideoPlayer() }
    // A native video view that draws its own look takes no Compose rotation.
    val native = element is DocumentElement.Video && player.drawsDocumentVideoLook
    val placed = Modifier.placed(element, index, canvas, rotate = !native)
    // Decorative elements are hidden from assistive technology (a link never is).
    val hidden = if (element.decorative) Modifier.clearAndSetSemantics { } else Modifier
    when (element) {
        is DocumentElement.Text -> TextElement(element, canvas, themeFont, placed.then(hidden))
        is DocumentElement.Image -> AsyncImage(
            model = element.url,
            contentDescription = element.alt,
            imageLoader = loader,
            contentScale = if (element.fit == MediaFit.Cover) ContentScale.Crop else ContentScale.Fit,
            modifier = placed
                .mediaLook(element.radius, element.opacity, canvas)
                .then(if (element.alt == null) Modifier.clearAndSetSemantics { } else Modifier),
        )
        is DocumentElement.Video -> VideoElement(element, canvas, video, player, above, topChrome, placed)
        is DocumentElement.Shape -> ShapeElement(element, canvas, placed.then(hidden))
        is DocumentElement.Emoji -> EmojiElement(element, canvas, placed)
        is DocumentElement.Button -> ButtonElement(element, canvas, themeFont, inertLinks, placed)
        is DocumentElement.ImageButton -> ImageButtonElement(element, canvas, loader, inertLinks, placed)
        is DocumentElement.SwipeUp -> SwipeUpElement(element, canvas, themeFont, inertLinks, placed)
    }
}

// Corner radius (a fraction of the canvas height) and opacity, as `styleMedia`.
private fun Modifier.mediaLook(radius: Double, opacity: Double, canvas: CanvasMetrics): Modifier = this
    .then(if (opacity < 1.0) Modifier.graphicsLayer { alpha = opacity.toFloat() } else Modifier)
    .then(if (radius > 0.0) Modifier.clip(RoundedCornerShape(canvas.dp(canvas.h(radius)))) else Modifier)

// ---- Text -----------------------------------------------------------------------------------

/** The font family a system stack draws in: natively, the platform's generic family closest to the web's stack. */
internal fun stackFamily(stack: FontStack): FontFamily = when (stack) {
    // `system-ui, -apple-system, Roboto`: the system font, San Francisco on iOS and Roboto on Android.
    FontStack.Sans -> FontFamily.Default
    FontStack.Serif -> FontFamily.Serif
    // `ui-rounded` has no generic family in Compose: the system font, as Android's browsers draw it.
    FontStack.Rounded -> FontFamily.Default
    FontStack.Monospace -> FontFamily.Monospace
}

/**
 * The font a text draws in (`textFontFamily`): a system stack's family; for the theme's font or a
 * named font list, the first entry the app has ([TaleartFonts]: a registered family, a font the
 * host app installed, a generic family), as a browser picks from `font-family`; else the text's
 * fallback stack. A project font (uploaded to the project as WOFF2, R18) is not downloaded on mobile
 * (owner decision 2026-10-23): its text draws in its fallback stack.
 */
@Composable
internal fun textFontFamily(look: TextLook, themeFont: String?): FontFamily {
    val fallback = stackFamily(look.fallback)
    return when (val font = look.font) {
        is TextFont.System -> stackFamily(font.stack)
        is TextFont.Theme -> rememberFontFamily(themeFont?.takeIf(::isFontFamily)) ?: fallback
        is TextFont.Name -> rememberFontFamily(font.family) ?: fallback
        is TextFont.Project -> fallback
    }
}

/**
 * A text element (`renderText`): its plain text in its box, lines centred vertically and wrapped
 * to the box (a line feed starts a line), at its size (a fraction of the canvas height), weight,
 * style, colour and line height, aligned to the start, centre or end of its direction (`auto`
 * takes it from the first strong character), on a solid box filling the element or a highlight
 * behind each line. Text taller than its box overflows it, as on the web.
 */
@Composable
private fun TextElement(element: DocumentElement.Text, canvas: CanvasMetrics, themeFont: String?, modifier: Modifier) {
    val look = element.look
    val fontPx = canvas.h(look.size)
    val style = TextStyle(
        color = parseHexColor(look.color) ?: Color.White,
        fontSize = canvas.sp(fontPx),
        fontWeight = FontWeight(look.weight),
        fontStyle = if (look.italic) FontStyle.Italic else FontStyle.Normal,
        fontFamily = textFontFamily(look, themeFont),
        lineHeight = look.lineHeight.em,
        lineHeightStyle = LineHeightStyle(LineHeightStyle.Alignment.Center, LineHeightStyle.Trim.None),
        textAlign = when (look.align) {
            "start" -> TextAlign.Start
            "end" -> TextAlign.End
            else -> TextAlign.Center
        },
        textDirection = when (look.direction) {
            "rtl" -> TextDirection.Rtl
            "ltr" -> TextDirection.Ltr
            else -> TextDirection.Content
        },
    )
    val background = parseHexColor(look.backgroundColor) ?: Color.Black
    val box = look.background == "box"
    val highlight = look.background == "highlight"
    val padPx = when {
        box -> (fontPx * TEXT_BOX_PADDING_EM).toFloat()
        highlight -> (fontPx * TEXT_HIGHLIGHT_PADDING_EM).toFloat()
        else -> 0f
    }
    // A highlight covers each line's glyphs, as an inline background: the font's own line height, centred in the line.
    val measurer = rememberTextMeasurer()
    val glyphHeight = if (highlight) {
        remember(style, measurer) { measurer.measure("Ag", style.copy(lineHeight = androidx.compose.ui.unit.TextUnit.Unspecified)).size.height.toFloat() }
    } else 0f
    var layout by remember { mutableStateOf<TextLayoutResult?>(null) }
    Box(
        modifier.then(if (box) Modifier.background(background) else Modifier),
        contentAlignment = Alignment.Center,
    ) {
        BasicText(
            element.text,
            style = style,
            onTextLayout = { layout = it },
            modifier = Modifier
                .fillMaxWidth()
                .wrapContentHeight(unbounded = true)
                .then(
                    if (highlight) {
                        Modifier.drawBehind {
                            val result = layout ?: return@drawBehind
                            for (line in 0 until result.lineCount) {
                                val left = result.getLineLeft(line)
                                val right = result.getLineRight(line)
                                if (right <= left) continue
                                val centre = (result.getLineTop(line) + result.getLineBottom(line)) / 2f
                                // The text sits `padPx` in from this edge, and each line's highlight reaches `padPx` past its glyphs.
                                drawRect(
                                    background,
                                    topLeft = Offset(left, centre - glyphHeight / 2f),
                                    size = Size(right - left + 2 * padPx, glyphHeight),
                                )
                            }
                        }
                    } else Modifier,
                )
                .padding(horizontal = canvas.dp(padPx)),
        )
    }
}

// ---- Shapes and emoji -------------------------------------------------------------------------

/**
 * A shape (`renderShape`): a rectangle (rounded), an ellipse or a line drawn from its checked values,
 * filled and stroked inside its box; a line is a bar of its stroke width across the box's middle.
 * Lengths are fractions of the canvas height. Named by its label, else decorative.
 */
@Composable
private fun ShapeElement(element: DocumentElement.Shape, canvas: CanvasMetrics, modifier: Modifier) {
    val look = element.look
    val fill = parseHexColor(look.fill)
    val stroke = parseHexColor(look.stroke)
    val strokeWidth = if (stroke != null) canvas.h(look.strokeWidth) else 0f
    val radius = canvas.h(look.radius)
    val named = element.label?.let { label -> Modifier.clearAndSetSemantics { contentDescription = label; role = Role.Image } }
        ?: Modifier.clearAndSetSemantics { }
    Canvas(
        modifier
            .then(if (look.opacity < 1.0) Modifier.graphicsLayer { alpha = look.opacity.toFloat() } else Modifier)
            .then(named),
    ) {
        when (look.shape) {
            "line" -> if (stroke != null && strokeWidth > 0f) {
                drawRect(stroke, topLeft = Offset(0f, size.height / 2f - strokeWidth / 2f), size = Size(size.width, strokeWidth))
            }
            "ellipse" -> {
                if (fill != null) drawOval(fill)
                if (stroke != null && strokeWidth > 0f) {
                    drawOval(
                        stroke,
                        topLeft = Offset(strokeWidth / 2f, strokeWidth / 2f),
                        size = Size(size.width - strokeWidth, size.height - strokeWidth),
                        style = Stroke(strokeWidth),
                    )
                }
            }
            else -> {
                // CSS caps a radius at half the shorter side.
                val r = minOf(radius, size.minDimension / 2f)
                if (fill != null) drawRoundRect(fill, cornerRadius = CornerRadius(r, r))
                if (stroke != null && strokeWidth > 0f) {
                    val inner = (r - strokeWidth / 2f).coerceAtLeast(0f)
                    drawRoundRect(
                        stroke,
                        topLeft = Offset(strokeWidth / 2f, strokeWidth / 2f),
                        size = Size(size.width - strokeWidth, size.height - strokeWidth),
                        cornerRadius = CornerRadius(inner, inner),
                        style = Stroke(strokeWidth),
                    )
                }
            }
        }
    }
}

/**
 * An emoji (`renderEmoji`): its emoji as text in the platform's colour emoji font, filling 80 % of
 * the shorter side of its box, centred, on one line. Named by its label as an image; decorative,
 * hidden; otherwise text, read by the emoji's own name.
 */
@Composable
private fun EmojiElement(element: DocumentElement.Emoji, canvas: CanvasMetrics, modifier: Modifier) {
    val semantics = when {
        element.label != null -> Modifier.clearAndSetSemantics { contentDescription = element.label; role = Role.Image }
        element.decorative -> Modifier.clearAndSetSemantics { }
        else -> Modifier
    }
    Box(modifier.then(semantics), contentAlignment = Alignment.Center) {
        BasicText(
            element.emoji,
            style = TextStyle(
                fontSize = canvas.sp(canvas.h(emojiFontSize(element.box))),
                lineHeight = 1.em,
                lineHeightStyle = LineHeightStyle(LineHeightStyle.Alignment.Center, LineHeightStyle.Trim.None),
                textAlign = TextAlign.Center,
            ),
            softWrap = false,
            maxLines = 1,
            modifier = Modifier.wrapContentSize(unbounded = true),
        )
    }
}

// ---- Video ------------------------------------------------------------------------------------

/**
 * A video element (`renderVideo`): muted, filling its box with its fit, rounded and faded as set,
 * named by its alt text. It plays with the tale through [playback]: as the tale's clock, or looping
 * beside the stage's video. Without [playback] it shows its first frame.
 */
@Composable
private fun VideoElement(
    element: DocumentElement.Video,
    canvas: CanvasMetrics,
    playback: DocumentVideoPlayback?,
    player: TaleVideoPlayer,
    above: List<DocumentElement>,
    topChrome: Dp,
    modifier: Modifier,
) {
    val bounds = elementBounds(element.box)
    val nothingAbove = above.none { overlaps(elementBounds(it.box), bounds) }
    val inside = bounds.x >= 0.0 && bounds.y >= 0.0 && bounds.x + bounds.w <= 1.0 && bounds.y + bounds.h <= 1.0
    val clearOfChrome = bounds.y * canvas.height >= with(canvas.density) { topChrome.toPx() }
    val overlay = nothingAbove && inside && clearOfChrome
    val named = element.alt?.let { alt -> Modifier.semantics { contentDescription = alt; role = Role.Image } }
        ?: Modifier.clearAndSetSemantics { }
    val clock = playback?.clock == true
    key(playback?.run ?: 0) {
        player.DocumentVideo(
            url = element.url,
            fit = element.fit,
            playing = playback?.playing == true,
            // A video beside the stage's video loops in place.
            loop = !clock,
            look = DocumentVideoLook(canvas.dp(canvas.h(element.radius)), element.box.rotation.toFloat(), element.opacity.toFloat(), overlay),
            onProgress = { position, duration -> if (clock) playback?.onProgress?.invoke(position, duration) },
            onEnded = { if (clock) playback?.onEnded?.invoke() },
            onError = { if (clock) playback?.onError?.invoke() },
            modifier = (if (player.drawsDocumentVideoLook) modifier else modifier.mediaLook(element.radius, element.opacity, canvas)).then(named),
        )
    }
}

// True when two upright rectangles on the canvas share some area.
private fun overlaps(a: ElementBox, b: ElementBox): Boolean =
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

// ---- Links (R7) -------------------------------------------------------------------------------

/**
 * What screen readers say a link does: it leaves the app for the browser (the web's
 * "(opens in a new tab)", `NEW_TAB_NOTE`).
 */
const val LINK_ACTION_LABEL = "Open in browser"

// Opens the link in the system browser; a link that cannot open changes nothing. A button for
// assistive technology, whose action says it leaves the app. An inert link (a preview of a draft)
// is focusable and goes nowhere.
@Composable
private fun Modifier.link(href: String, label: String, inert: Boolean): Modifier {
    val uri = LocalUriHandler.current
    return if (inert) this.semantics { contentDescription = label; role = Role.Button }.focusable()
    else this.clickable(role = Role.Button, onClickLabel = LINK_ACTION_LABEL) { runCatching { uri.openUri(href) } }
}

/**
 * A button (`renderButton`): its label, bold on one line (ellipsized), at 40 % of its box's height
 * (at most 6 % of the canvas), filled with its colour or outlined in it, with its corner radius.
 * A tap opens its destination.
 */
@Composable
private fun ButtonElement(element: DocumentElement.Button, canvas: CanvasMetrics, themeFont: String?, inert: Boolean, modifier: Modifier) {
    val look = element.look
    val fontPx = canvas.h(buttonFontSize(element.box))
    val fill = parseHexColor(look.fill) ?: Color.White
    val shape = RoundedCornerShape(canvas.dp(canvas.h(look.radius)))
    val edge = canvas.h(BUTTON_OUTLINE_WIDTH)
    Box(
        modifier
            .clip(shape)
            .then(
                if (look.filled) Modifier.background(fill, shape)
                else Modifier.border(canvas.dp(edge), fill, shape).padding(canvas.dp(edge)),
            )
            .link(element.href, element.label, inert)
            .padding(horizontal = canvas.dp(fontPx * 0.8f)),
        contentAlignment = Alignment.Center,
    ) {
        BasicText(
            element.label,
            style = linkTextStyle(look.color, fontPx, canvas, linkFontFamily(themeFont)),
            maxLines = 1,
            softWrap = false,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

// The theme's font for a link's label (the viewer's own), else the system font.
@Composable
private fun linkFontFamily(themeFont: String?): FontFamily = rememberFontFamily(themeFont?.takeIf(::isFontFamily)) ?: FontFamily.Default

// The label of a link: bold, line height 1.2, in [family].
private fun linkTextStyle(color: String, fontPx: Float, canvas: CanvasMetrics, family: FontFamily) = TextStyle(
    color = parseHexColor(color) ?: Color.White,
    fontSize = canvas.sp(fontPx),
    fontWeight = FontWeight.Bold,
    fontFamily = family,
    lineHeight = 1.2.em,
    lineHeightStyle = LineHeightStyle(LineHeightStyle.Alignment.Center, LineHeightStyle.Trim.None),
    textAlign = TextAlign.Center,
)

/** A custom image button (`renderImageButton`): its image, shown whole and rounded, opening its destination; named by its alt text or the destination's host. */
@Composable
private fun ImageButtonElement(element: DocumentElement.ImageButton, canvas: CanvasMetrics, loader: ImageLoader, inert: Boolean, modifier: Modifier) {
    Box(
        modifier
            .then(if (element.radius > 0.0) Modifier.clip(RoundedCornerShape(canvas.dp(canvas.h(element.radius)))) else Modifier)
            .link(element.href, element.name, inert)
            .semantics(mergeDescendants = true) { contentDescription = element.name },
    ) {
        AsyncImage(
            model = element.url,
            contentDescription = null,
            imageLoader = loader,
            contentScale = ContentScale.Fit,
            modifier = Modifier.fillMaxSize(),
        )
    }
}

/**
 * The swipe-up link (`renderSwipeUp`): an arrow over its label on a pill, pinned to the bottom safe
 * area, at 2.4 % of the canvas height. A tap opens it; the viewer also opens it on a flick up.
 */
@Composable
private fun SwipeUpElement(element: DocumentElement.SwipeUp, canvas: CanvasMetrics, themeFont: String?, inert: Boolean, modifier: Modifier) {
    val fontPx = canvas.h(SWIPE_UP_FONT_SIZE)
    val em = { n: Double -> canvas.dp((fontPx * n).toFloat()) }
    val color = parseHexColor(element.color) ?: Color.White
    BoxWithConstraints(modifier.link(element.href, element.label, inert), contentAlignment = Alignment.Center) {
        val maxWidth = maxWidth
        Column(
            Modifier.wrapContentSize(unbounded = true),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(em(0.2)),
        ) {
            // The arrow: the top and left edges of a 0.7 em square, turned 45° and moved down 0.2 em (`.ta-swipe-arrow`).
            Canvas(Modifier.size(em(0.7)).graphicsLayer { translationY = (fontPx * 0.2).toFloat() }.clearAndSetSemantics { }) {
                val t = (fontPx * 0.16).toFloat()
                rotate(45f) {
                    drawRect(color, topLeft = Offset.Zero, size = Size(size.width, t))
                    drawRect(color, topLeft = Offset.Zero, size = Size(t, size.height))
                }
            }
            BasicText(
                element.label,
                style = linkTextStyle(element.color, fontPx, canvas, linkFontFamily(themeFont)),
                maxLines = 1,
                softWrap = false,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier
                    .widthIn(max = maxWidth)
                    .clip(RoundedCornerShape(50))
                    .background(parseHexColor(element.background) ?: Color.Transparent)
                    .padding(horizontal = em(1.0), vertical = em(0.35)),
            )
        }
    }
}
