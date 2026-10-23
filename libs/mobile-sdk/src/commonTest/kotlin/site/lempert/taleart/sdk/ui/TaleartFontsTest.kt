package site.lempert.taleart.sdk.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.ComposeUiTest
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.v2.runComposeUiTest
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import site.lempert.taleart.sdk.delivery.DeliveryTale
import site.lempert.taleart.sdk.delivery.DeliveryTaleGroup
import site.lempert.taleart.sdk.storage.InMemoryKeyValueStore
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull

// Fonts the host app installs, by the family name in the content (story 9.8). Generic families
// stand in for the host's fonts: a test cannot ship a font file to every host.
@OptIn(ExperimentalTestApi::class)
class TaleartFontsTest : ComposeUiTestBase() {
    @AfterTest
    fun forget() = TaleartFonts.clear()

    // A host that has "Lobster" (any case) and "Brand Sans", as Cursive and Monospace.
    private val host = HostFontLookup { name ->
        when (fontKey(name)) {
            "lobster" -> FontFamily.Cursive
            "brand sans" -> FontFamily.Monospace
            else -> null
        }
    }

    @Test
    fun namesAreReadAsTheWebReadsAFontFamilyList() {
        assertEquals(listOf("Open Sans", "Brand Sans", "serif"), fontListNames(""" "Open Sans" , 'Brand   Sans',serif """))
        assertEquals(emptyList(), fontListNames(" , ,"))
        assertEquals("brand sans", fontKey("  'Brand \t Sans' "))
        assertEquals("brand_sans", fontResourceName("Brand Sans"))
        assertEquals("brand_sans", fontResourceName("brand-sans"))
        assertEquals("lobster_regular", fontResourceName("Lobster-Regular"))
        assertEquals("pt_serif_2", fontResourceName("PT  Serif 2"))
        assertNull(fontResourceName("--"))
    }

    @Test
    fun theFirstEntryAvailableWinsThenAGenericFamilyElseNone() {
        // Case-insensitive, quoted or not.
        assertEquals(FontFamily.Cursive, fontFamilyOf("LOBSTER, serif", host))
        assertEquals(FontFamily.Monospace, fontFamilyOf("\"brand sans\", Lobster", host))
        // A name the app lacks is skipped, as a browser skips a font it does not have.
        assertEquals(FontFamily.Cursive, fontFamilyOf("Missing Font, 'Lobster'", host))
        assertEquals(FontFamily.Serif, fontFamilyOf("Missing Font, serif, Lobster", host))
        assertEquals(FontFamily.Serif, fontFamilyOf("Georgia, ui-serif"))
        assertEquals(FontFamily.Monospace, fontFamilyOf("\"Fira Code\", monospace"))
        assertEquals(FontFamily.SansSerif, fontFamilyOf("Missing, sans-serif", host))
        assertEquals(FontFamily.Default, fontFamilyOf("system-ui", host))
        // Nothing available: the caller's fallback.
        assertNull(fontFamilyOf("Missing Font, Other", host))
        assertNull(fontFamilyOf(null, host))
        // A host that fails to read a font is a font it does not have.
        assertEquals(FontFamily.Serif, fontFamilyOf("Broken, serif", HostFontLookup { error("unreadable") }))
    }

    @Test
    fun aRegisteredFamilyTakesPriorityOverTheHostsFont() {
        TaleartFonts.register("'Lobster'", FontFamily.SansSerif)
        assertEquals(FontFamily.SansSerif, fontFamilyOf("lobster", host))
        assertEquals(FontFamily.SansSerif, fontFamilyOf("Missing, LOBSTER", host))
        // An earlier entry the host has still wins: the list's order decides.
        assertEquals(FontFamily.Monospace, fontFamilyOf("Brand Sans, Lobster", host))
        TaleartFonts.register("Only Registered", FontFamily.Serif)
        assertEquals(FontFamily.Serif, fontFamilyOf("Only  Registered", HostFontLookup.None))
        TaleartFonts.unregister("LOBSTER")
        assertEquals(FontFamily.Cursive, fontFamilyOf("lobster", host))
        assertFailsWith<IllegalArgumentException> { TaleartFonts.register(" '' ", FontFamily.Serif) }
    }

    @Test
    fun documentTextDrawsInTheRegisteredFamilyAndFallsBackAsOnTheWeb() = runComposeUiTest {
        setContent {
            CompositionLocalProvider(LocalHostFonts provides host) {
                Box(Modifier.size(180.dp, 320.dp)) {
                    DocumentElementsLayer(
                        layerOf(
                            text("Registered", """{"source":"name","family":"'Brand Display', serif"}""", "sans"),
                            text("Hosted", """{"source":"name","family":"Missing, Lobster"}""", "sans"),
                            text("Missing", """{"source":"name","family":"Missing Font"}""", "monospace"),
                            text("Themed", """{"source":"theme"}""", "sans"),
                            text("Project", """{"source":"project","fontId":"0f0e0d0c-0000-4000-8000-00000000000a"}""", "serif"),
                        ),
                        themeFont = "Brand Sans, serif",
                    )
                }
            }
        }
        waitForIdle()
        // Not registered yet: the list's next entry.
        assertEquals(FontFamily.Serif, family("Registered"))
        TaleartFonts.register("Brand Display", FontFamily.Cursive)
        waitForIdle()
        // Registered while it shows: it redraws in the registered family.
        assertEquals(FontFamily.Cursive, family("Registered"))
        assertEquals(FontFamily.Cursive, family("Hosted"))
        // A name the app lacks: the text's fallback stack.
        assertEquals(FontFamily.Monospace, family("Missing"))
        assertEquals(FontFamily.Monospace, family("Themed"))
        // A project font is not downloaded on mobile: its fallback stack.
        assertEquals(FontFamily.Serif, family("Project"))
    }

    @Test
    fun theViewersGroupNameUsesTheThemesNamedFont() = runComposeUiTest {
        TaleartFonts.register("Brand Display", FontFamily.Cursive)
        val groups = listOf(
            DeliveryTaleGroup(id = "g1", name = "Summer", tales = listOf(DeliveryTale(id = "t1"))),
        )
        setContent {
            CompositionLocalProvider(LocalHostFonts provides host) {
                TaleartViewer(
                    groups,
                    "g1",
                    onClose = {},
                    seenGroups = SeenGroups(InMemoryKeyValueStore()),
                    theme = TaleartTheme(fontFamily = "Missing, 'brand display', serif"),
                    reducedMotion = true,
                )
            }
        }
        waitForIdle()
        assertEquals(FontFamily.Cursive, family("Summer"))
    }

    private fun ComposeUiTest.family(text: String): FontFamily? {
        val results = mutableListOf<TextLayoutResult>()
        onNodeWithText(text, useUnmergedTree = true).fetchSemanticsNode().config[SemanticsActions.GetTextLayoutResult].action!!.invoke(results)
        return results.single().layoutInput.style.fontFamily
    }

    private var y = 0.0

    private fun text(label: String, font: String, fallback: String): String {
        y += 0.15
        return """{"id":"$label","type":"text","box":{"x":0.1,"y":$y,"w":0.8,"h":0.1,"rotation":0},"hidden":false,"locked":false,"a11y":{},
            "props":{"text":"$label","font":$font,"fallback":"$fallback","size":0.03}}"""
    }

    private fun layerOf(vararg elements: String) = DocumentLayer.read(
        Json.parseToJsonElement("""{"version":1,"canvas":{"background":{"type":"color","color":"#000000"}},"elements":[${elements.joinToString(",")}]}""") as JsonObject,
    )
}
