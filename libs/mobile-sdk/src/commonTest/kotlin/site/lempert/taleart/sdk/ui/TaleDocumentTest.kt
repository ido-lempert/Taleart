package site.lempert.taleart.sdk.ui

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import site.lempert.taleart.sdk.delivery.readZone
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

// Reading delivered tale documents (AD-15) as the Web SDK's renderer reads them, from a real
// Delivery API response (STUDIO_ZONE_JSON) and documents built here for the edge cases.
class TaleDocumentTest {
    private val zone = readZone(Json.parseToJsonElement(STUDIO_ZONE_JSON) as JsonObject)
    private val everyElement = zone.taleGroups.single().tales[0]
    private val videoTale = zone.taleGroups.single().tales[1]

    private fun layerOf(json: String) = DocumentLayer.read(Json.parseToJsonElement(json) as JsonObject)

    private fun doc(vararg elements: String) = layerOf("""{"version":1,"canvas":{"background":{"type":"color","color":"#000000"}},"elements":[${elements.joinToString(",")}]}""")

    private fun element(type: String, props: String, box: String = """{"x":0.1,"y":0.2,"w":0.5,"h":0.1,"rotation":0}""", a11y: String = "{}", id: String = type) =
        """{"id":"$id","type":"$type","box":$box,"a11y":$a11y,"props":$props}"""

    @Test
    fun readsEveryElementTypeOfATaleStudioDocument() {
        val view = TaleView.read(everyElement, 0)
        val layer = view.canvas!!.layer
        assertEquals(
            listOf("image", "sticker", "image-button", "emoji", "text", "shape", "shape", "text", "button", "swipe-up").sorted(),
            layer.elements.map { typeOf(it) }.sorted(),
        )
        assertEquals(emptyList(), layer.skipped)
        assertEquals(15_000, view.durationMs)
        assertEquals("#1E3A8A", view.canvas!!.color)
        // Each element keeps its place in the z-order (the document's order, from 1).
        assertEquals((1..10).toList(), layer.elements.map { it.layer }.sorted())
    }

    private fun typeOf(e: DocumentElement) = when (e) {
        is DocumentElement.Text -> "text"
        is DocumentElement.Image -> if (e.sticker) "sticker" else "image"
        is DocumentElement.Video -> "video"
        is DocumentElement.Shape -> "shape"
        is DocumentElement.Emoji -> "emoji"
        is DocumentElement.Button -> "button"
        is DocumentElement.ImageButton -> "image-button"
        is DocumentElement.SwipeUp -> "swipe-up"
        is DocumentElement.Countdown -> "countdown"
        is DocumentElement.PromoCode -> "promo-code"
        is DocumentElement.Poll -> "poll"
        is DocumentElement.Quiz -> "quiz"
        is DocumentElement.Rating -> "rating"
        is DocumentElement.Reaction -> "reaction"
    }

    @Test
    fun readsTextInBothStyles() {
        val texts = TaleView.read(everyElement, 0).canvas!!.layer.elements.filterIsInstance<DocumentElement.Text>()
        val sale = texts.single { it.text == "Summer\nSale" }
        assertEquals(TextFont.System(FontStack.Serif), sale.look.font)
        assertEquals(0.06, sale.look.size)
        assertEquals(700, sale.look.weight)
        assertEquals("start", sale.look.align)
        assertEquals(1.1, sale.look.lineHeight)
        assertEquals("highlight", sale.look.background)
        assertEquals("#E11D48", sale.look.backgroundColor)
        assertEquals(-4.0, sale.box.rotation)
        val hebrew = texts.single { it.text.startsWith("מבצע") }
        assertEquals(TextFont.System(FontStack.Sans), hebrew.look.font)
        assertEquals(400, hebrew.look.weight)
        assertTrue(hebrew.look.italic)
        assertEquals("#0F172A", hebrew.look.color)
        assertEquals("box", hebrew.look.background)
        assertEquals("#FDE68AE6", hebrew.look.backgroundColor)
        assertEquals("auto", hebrew.look.direction)
        assertEquals(ReadingDirection.Rtl, firstStrongDirection(hebrew.text))
    }

    @Test
    fun readsMediaShapesStickersAndLinks() {
        val layer = TaleView.read(everyElement, 0).canvas!!.layer
        val image = layer.elements.filterIsInstance<DocumentElement.Image>().single { !it.sticker }
        assertEquals(MediaFit.Cover, image.fit)
        assertEquals(0.02, image.radius)
        assertEquals("A beach at sunset", image.alt)
        assertTrue(image.url.startsWith("http://localhost:3595/media/"))
        assertEquals(ElementBox(0.08, 0.14, 0.6, 0.22, 0.0), image.box)
        val sticker = layer.elements.filterIsInstance<DocumentElement.Image>().single { it.sticker }
        assertEquals(MediaFit.Contain, sticker.fit)
        assertEquals(0.0, sticker.radius)
        assertEquals(12.0, sticker.box.rotation)
        val shapes = layer.elements.filterIsInstance<DocumentElement.Shape>()
        assertEquals(ShapeLook("ellipse", "#F59E0B", "#FFFFFF", 0.004, 0.0, 0.9), shapes.single { it.look.shape == "ellipse" }.look)
        assertEquals(ShapeLook("line", null, "#FDE68A", 0.006, 0.0, 1.0), shapes.single { it.look.shape == "line" }.look)
        assertTrue(shapes.all { it.label == null })
        val emoji = layer.elements.filterIsInstance<DocumentElement.Emoji>().single()
        assertEquals("🌴", emoji.emoji)
        assertEquals("palm tree", emoji.label)
        val button = layer.elements.filterIsInstance<DocumentElement.Button>().single()
        assertEquals("Shop the sale", button.label)
        assertEquals("https://example.com/sale", button.href)
        assertEquals(ButtonLook(true, "#111827", "#FFFFFF", 0.035), button.look)
        val imageButton = layer.elements.filterIsInstance<DocumentElement.ImageButton>().single()
        assertEquals("Open the lookbook", imageButton.name)
        assertEquals("https://example.com/lookbook", imageButton.href)
        val swipeUp = layer.elements.filterIsInstance<DocumentElement.SwipeUp>().single()
        assertEquals(SWIPE_UP_BOX, swipeUp.box)
        assertEquals("https://example.com/deals", layer.swipeUpHref)
        assertEquals("#000000B3", swipeUp.background)
    }

    @Test
    fun aDocumentVideoRunsTheTaleAndAProjectFontIsNamedById() {
        val view = TaleView.read(videoTale, 1)
        val video = view.documentVideo
        assertIs<DocumentElement.Video>(video)
        assertTrue(video.decorative)
        assertNull(video.alt)
        assertEquals(0.02, video.radius)
        assertTrue(view.runsOnVideo)
        assertNull(view.video)
        val text = view.canvas!!.layer.elements.filterIsInstance<DocumentElement.Text>().single()
        assertEquals(TextFont.Project(videoTale.fonts.single().id.lowercase()), text.look.font)
        assertEquals(FontStack.Serif, text.look.fallback)
        assertEquals(1, videoTale.fonts.size)
        // Its family comes with it (story 9.8), for the host's font of that name.
        assertEquals(mapOf(videoTale.fonts.single().id.lowercase() to "Inter"), view.canvas!!.projectFonts)
        val outline = view.canvas!!.layer.elements.filterIsInstance<DocumentElement.Button>().single()
        assertFalse(outline.look.filled)
    }

    @Test
    fun readingOrderIsTopToBottomThenAlongTheRow() {
        val layer = TaleView.read(everyElement, 0).canvas!!.layer
        // Hebrew and English texts: a tie, so the first text (top) decides: left to right.
        assertEquals(ReadingDirection.Ltr, layer.direction)
        assertEquals(
            listOf("image", "sticker", "image-button", "emoji", "text", "shape", "shape", "text", "button", "swipe-up"),
            layer.elements.map(::typeOf),
        )
    }

    @Test
    fun aRightToLeftTaleReadsEachRowFromTheRight() {
        val left = element("text", """{"text":"שלום"}""", """{"x":0.1,"y":0.2,"w":0.3,"h":0.1,"rotation":0}""", id = "left")
        val right = element("text", """{"text":"עולם"}""", """{"x":0.6,"y":0.2,"w":0.3,"h":0.1,"rotation":0}""", id = "right")
        val layer = doc(left, right)
        assertEquals(ReadingDirection.Rtl, layer.direction)
        assertEquals(listOf("right", "left"), layer.elements.map { it.id })
        val ltr = doc(left.replace("שלום", "Hello"), right.replace("עולם", "World"))
        assertEquals(listOf("left", "right"), ltr.elements.map { it.id })
    }

    @Test
    fun unknownTypesHiddenElementsAndUnusableValuesAreSkipped() {
        val layer = doc(
            element("spinner", """{"question":"?"}"""),
            element("test-badge", """{"label":"x","color":"#ff0000","tone":"solid"}"""),
            element("text", """{"text":"hidden"}""").replace("\"a11y\"", "\"hidden\":true,\"a11y\""),
            element("text", """{"text":"\u0007"}""", id = "empty"),
            element("image", """{"url":"javascript:alert(1)","fit":"cover"}"""),
            element("button", """{"label":"Go","href":"javascript:alert(1)","variant":"filled","color":"#000000","fill":"#ffffff"}"""),
            element("button", """{"label":"Go","href":"https://user@evil.example","variant":"filled","color":"#000000","fill":"#ffffff"}"""),
            element("shape", """{"shape":"star"}"""),
            element("text", """{"text":"no box"}""", box = """{"x":"0.1","y":0,"w":1,"h":1,"rotation":0}"""),
            element("text", """{"text":"kept"}""", id = "kept"),
        )
        assertEquals(listOf("kept"), layer.elements.map { it.id })
        assertEquals(listOf("spinner", "test-badge"), layer.skipped)
    }

    @Test
    fun invalidStylesTakeTheirDefaults() {
        val text = doc(element("text", """{"text":"a","size":5,"color":"red","weight":"heavy","align":"left","lineHeight":0,"font":{"source":"later"},"fallback":"monospace"}"""))
            .elements.single() as DocumentElement.Text
        assertEquals(0.04, text.look.size)
        assertEquals("#ffffff", text.look.color)
        assertEquals(LEGACY_TEXT_WEIGHT, text.look.weight)
        assertEquals("center", text.look.align)
        assertEquals(1.25, text.look.lineHeight)
        // An unknown source draws in the fallback stack.
        assertEquals(TextFont.System(FontStack.Monospace), text.look.font)
        val named = doc(element("text", """{"text":"a","font":{"source":"name","family":"inherit"}}""")).elements.single() as DocumentElement.Text
        assertEquals(TextFont.System(FontStack.Sans), named.look.font)
    }

    @Test
    fun onlyOneSwipeUpLinkAndItIsPinned() {
        val one = element("swipe-up", """{"label":"One","href":"https://a.example","color":"#ffffff","background":"#000000"}""", id = "one")
        val two = element("swipe-up", """{"label":"Two","href":"https://b.example","color":"#ffffff","background":"#000000"}""", id = "two")
        val layer = doc(one, two)
        assertEquals(1, layer.elements.size)
        assertEquals(SWIPE_UP_BOX, layer.elements.single().box)
    }

    @Test
    fun sizesMatchTheWeb() {
        assertEquals(0.028, buttonFontSize(ElementBox(0.0, 0.0, 0.6, 0.07)))
        assertEquals(0.06, buttonFontSize(ElementBox(0.0, 0.0, 0.6, 0.3)))
        // 80 % of the shorter side on the 9:16 canvas: 0.16 wide is 0.09 high.
        assertEquals(0.072, emojiFontSize(ElementBox(0.0, 0.0, 0.16, 0.09)))
        // A box turned 90° shows as its upright bounds, in canvas units.
        val bounds = elementBounds(ElementBox(0.4, 0.4, 0.2, 0.1, 90.0))
        assertEquals(0.1 * 16 / 9, bounds.w, 1e-9)
        assertEquals(0.2 * 9 / 16, bounds.h, 1e-9)
    }

    @Test
    fun textAndLinksAreCleanedAsTheContractCleansThem() {
        assertEquals("pay x", cleanText("pay‮ \u0007x\ud800", lineFeeds = true))
        assertEquals("a\nb", cleanText("a\nb", lineFeeds = true))
        assertEquals("ab", cleanText("a\nb", lineFeeds = false))
        assertEquals("Shop now", linkLabel("  Shop \n\t now "))
        assertTrue(isLinkUrl("https://example.com/a?b#c"))
        assertTrue(isLinkUrl("HTTP://example.com"))
        assertFalse(isLinkUrl("https://:@example.com"))
        assertFalse(isLinkUrl("https://exa mple.com"))
        assertFalse(isLinkUrl("ftp://example.com"))
        assertFalse(isLinkUrl("//example.com"))
        assertFalse(isLinkUrl("https://"))
        assertFalse(isLinkUrl("https://example.com/" + "a".repeat(2048)))
    }

    @Test
    fun boxesOutsideTheSchemaAreNotLaidOut() {
        val layer = doc(
            element("text", """{"text":"wide"}""", """{"x":0.1,"y":0.1,"w":1000,"h":0.1,"rotation":0}""", id = "wide"),
            element("text", """{"text":"far"}""", """{"x":1e9,"y":-1e9,"w":0.5,"h":0.1,"rotation":0}""", id = "far"),
            element("text", """{"text":"flat"}""", """{"x":0.1,"y":0.1,"w":0,"h":0.1,"rotation":0}""", id = "flat"),
            element("text", """{"text":"spun"}""", """{"x":0.1,"y":0.1,"w":0.5,"h":0.1,"rotation":720}""", id = "spun"),
            element("text", """{"text":"edge"}""", """{"x":1,"y":1,"w":1,"h":1,"rotation":-180}""", id = "edge"),
        )
        assertEquals(listOf("edge"), layer.elements.map { it.id })
    }

    @Test
    fun coversPickOnlyElementsTheRendererWouldDraw() {
        fun group(vararg elements: String) = readZone(
            Json.parseToJsonElement(
                """{"taleGroups":[{"id":"g","name":"G","tales":[{"id":"t","title":"T","document":{"version":1,"canvas":{"background":{"type":"color","color":"#112233"}},"elements":[${elements.joinToString(",")}]}}]}]}""",
            ) as JsonObject,
        ).taleGroups.single()
        val image = { url: String, box: String -> element("image", "{\"url\":\"https://cdn.test/$url.png\",\"fit\":\"cover\"}", box) }
        // A box outside the schema is not drawn, so it is no cover.
        val bad = image("bad", """{"x":0,"y":0,"w":5,"h":1,"rotation":0}""")
        val good = image("good", """{"x":0,"y":0,"w":1,"h":1,"rotation":0}""")
        assertEquals(CoverSource.Image("https://cdn.test/good.png"), defaultCoverSource(group(bad, good)))
        // An image past the sixtieth element is not drawn either.
        val filler = (0 until 60).map { element("shape", """{"shape":"rectangle","fill":"#ffffff"}""") }
        assertEquals(CoverSource.Placeholder("#112233"), defaultCoverSource(group(*(filler + good).toTypedArray())))
    }

    @Test
    fun aDocumentDrawsAtMostSixtyElements() {
        val many = (0 until 500).map { i ->
            element("shape", """{"shape":"rectangle","fill":"#ffffff"}""", """{"x":0,"y":${i / 1000.0},"w":0.1,"h":0.01,"rotation":0}""", id = "e$i")
        }
        val layer = doc(*many.toTypedArray())
        assertEquals(MAX_TALE_ELEMENTS, layer.elements.size)
        assertEquals((0 until 60).map { "e$it" }.toSet(), layer.elements.map { it.id }.toSet())
    }

    @Test
    fun linksAreCheckedAndNormalizedForEveryPlatform() {
        assertNull(linkHref("intent://scan/#Intent;scheme=zxing;end"))
        assertNull(linkHref("file:///etc/passwd"))
        assertNull(linkHref("javascript:alert(1)"))
        assertNull(linkHref("HTTPS://user:pw@example.com"))
        // A backslash ends the authority, as browsers read it: the link opens example.com.
        assertEquals("https://example.com/@evil.example", linkHref("https://example.com\\@evil.example"))
        assertEquals("https://Example.COM/A?b=C#D", linkHref("HTTPS://Example.COM/A?b=C#D"))
        assertEquals("http://example.com:8080/x", linkHref("HtTp://example.com:8080/x"))
        // Characters a URL parser may refuse are percent-encoded as UTF-8.
        assertEquals("https://example.com/caf%C3%A9/%F0%9F%8C%B4?q=%7Bx%7D", linkHref("https://example.com/café/🌴?q={x}"))
        // No IDNA: a host that is not ASCII is refused.
        assertNull(linkHref("https://exämple.com/"))
        assertEquals("https://[::1]:8443/", linkHref("https://[::1]:8443/"))
        // A backslash is a slash only before the query; after it, it is data.
        assertEquals("https://example.com/a/b?q=c%5Cd#e%5Cf", linkHref("https://example.com\\a\\b?q=c\\d#e\\f"))
        assertNull(linkHref("https://example.com:65536/"), "port over 65535")
        assertEquals("https://example.com:65535/", linkHref("https://example.com:65535/"))
        assertNull(linkHref("https://[:]/"), "empty IPv6 literal")
        assertNull(linkHref("https://example.com/100%"), "a lone percent sign")
        assertNull(linkHref("https://example.com/%zz"), "a percent sign without two hex digits")
        assertEquals("https://example.com/a%20b", linkHref("https://example.com/a%20b"))
        val button = doc(element("button", """{"label":"Go","href":"HTTPS://Example.com/a b","variant":"filled","color":"#000000","fill":"#ffffff"}"""))
        // A space is refused by the contract's rule.
        assertEquals(emptyList(), button.elements)
    }
}
