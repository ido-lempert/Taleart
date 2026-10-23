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

    // A host that has "Lobster" (any case) and "Brand Sans", as Cursive and SansSerif: families no
    // fallback stack in these tests draws in (a missing name falls back to Serif or Monospace).
    private val host = HostFontLookup { name ->
        when (fontKey(name)) {
            "lobster" -> FontFamily.Cursive
            "brand sans" -> FontFamily.SansSerif
            else -> null
        }
    }

    @Test
    fun namesAreReadAsTheWebReadsAFontFamilyList() {
        assertEquals(listOf("Open Sans", "Brand Sans", "serif"), fontListNames(""" "Open Sans" , 'Brand   Sans',serif """))
        assertEquals(emptyList(), fontListNames(" , ,"))
        // A quoted name may hold a comma; an unclosed quote runs to the end.
        assertEquals(listOf("Brand, Inc Sans", "serif"), fontListNames(""""Brand, Inc Sans", serif"""))
        assertEquals(listOf("A", "B, c"), fontListNames("A, 'B, c"))
        assertEquals(
            listOf(FontListEntry("serif", quoted = true), FontListEntry("monospace", quoted = false)),
            fontListEntries("'serif', monospace"),
        )
        assertEquals("brand sans", fontKey("  'Brand \t Sans' "))
    }

    @Test
    fun distinctFamilyNamesHaveDistinctAndroidResourceNames() {
        assertEquals("brand_sans", fontResourceName("Brand Sans"))
        assertEquals("brand__sans", fontResourceName("Brand-Sans"))
        assertEquals("brand___sans", fontResourceName("Brand -Sans"))
        assertEquals("pt_serif_2", fontResourceName("PT  Serif 2"))
        assertEquals("lobster", fontResourceName("Lobster"))
        // A resource cannot carry these: the assets lookup still can.
        assertNull(fontResourceName("--"))
        assertNull(fontResourceName("2Brand"))
        assertNull(fontResourceName("Hébreu Sans"))
        val names = listOf("Brand Sans", "Brand-Sans", "Brand  Sans", "BrandSans", "Brand Sans 2", "Brand-Sans-2")
        assertEquals(5, names.mapNotNull(::fontResourceName).toSet().size, "only the double space collapses")
    }

    @Test
    fun theFirstEntryAvailableWinsThenAGenericFamilyElseNone() {
        // Case-insensitive, quoted or not.
        assertEquals(FontFamily.Cursive, fontFamilyOf("LOBSTER, serif", host))
        assertEquals(FontFamily.SansSerif, fontFamilyOf("\"brand sans\", Lobster", host))
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
        // A quoted generic keyword is a family name, as in CSS: the app has none of that name.
        assertNull(fontFamilyOf("'serif'", host))
        assertEquals(FontFamily.Monospace, fontFamilyOf("\"serif\", monospace", host))
        // A quoted name with a comma is one name.
        assertNull(fontFamilyOf("\"Lobster, serif\"", host))
    }

    @Test
    fun aRegisteredFamilyTakesPriorityOverTheHostsFont() {
        TaleartFonts.register("'Lobster'", FontFamily.SansSerif)
        assertEquals(FontFamily.SansSerif, fontFamilyOf("lobster", host))
        assertEquals(FontFamily.SansSerif, fontFamilyOf("Missing, LOBSTER", host))
        // An earlier entry the host has still wins: the list's order decides.
        assertEquals(FontFamily.SansSerif, fontFamilyOf("Brand Sans, Lobster", host))
        TaleartFonts.register("Only Registered", FontFamily.Serif)
        assertEquals(FontFamily.Serif, fontFamilyOf("Only  Registered", HostFontLookup.None))
        TaleartFonts.unregister("LOBSTER")
        assertEquals(FontFamily.Cursive, fontFamilyOf("lobster", host))
        assertFailsWith<IllegalArgumentException> { TaleartFonts.register(" '' ", FontFamily.Serif) }
        // A registration wins over a generic family of the same name.
        TaleartFonts.register("cursive", FontFamily.Monospace)
        assertEquals(FontFamily.Monospace, fontFamilyOf("cursive", host))
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
                            text("Project gone", """{"source":"project","fontId":"0f0e0d0c-0000-4000-8000-00000000000b"}""", "monospace"),
                            text("Project unnamed", """{"source":"project","fontId":"0f0e0d0c-0000-4000-8000-00000000000c"}""", "serif"),
                            text("Project generic", """{"source":"project","fontId":"0f0e0d0c-0000-4000-8000-00000000000d"}""", "monospace"),
                        ),
                        themeFont = "Brand Sans, serif",
                        projectFonts = mapOf(
                            "0f0e0d0c-0000-4000-8000-00000000000a" to "Lobster",
                            "0f0e0d0c-0000-4000-8000-00000000000b" to "Gone Font",
                            "0f0e0d0c-0000-4000-8000-00000000000d" to "cursive",
                        ),
                    )
                }
            }
        }
        waitForIdle()
        // Not registered yet: the list's next entry.
        assertEquals(FontFamily.Serif, family("Registered"))
        TaleartFonts.register("Brand Display", FontFamily.Default)
        waitForIdle()
        // Registered while it shows: it redraws in the registered family.
        assertEquals(FontFamily.Default, family("Registered"))
        assertEquals(FontFamily.Cursive, family("Hosted"))
        // A name the app lacks: the text's fallback stack.
        assertEquals(FontFamily.Monospace, family("Missing"))
        // The theme's font: the host's Brand Sans.
        assertEquals(FontFamily.SansSerif, family("Themed"))
        // A project font is never downloaded on mobile: the host's font of its family, else its fallback.
        assertEquals(FontFamily.Cursive, family("Project"))
        assertEquals(FontFamily.Monospace, family("Project gone"))
        assertEquals(FontFamily.Serif, family("Project unnamed"))
        // A project family is a name, never a generic keyword.
        assertEquals(FontFamily.Monospace, family("Project generic"))
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
        y += 0.09
        return """{"id":"$label","type":"text","box":{"x":0.1,"y":$y,"w":0.8,"h":0.08,"rotation":0},"hidden":false,"locked":false,"a11y":{},
            "props":{"text":"$label","font":$font,"fallback":"$fallback","size":0.03}}"""
    }

    private fun layerOf(vararg elements: String) = DocumentLayer.read(
        Json.parseToJsonElement("""{"version":1,"canvas":{"background":{"type":"color","color":"#000000"}},"elements":[${elements.joinToString(",")}]}""") as JsonObject,
    )
}
