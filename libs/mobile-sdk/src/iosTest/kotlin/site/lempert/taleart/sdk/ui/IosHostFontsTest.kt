package site.lempert.taleart.sdk.ui

import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontListFontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.platform.LoadedFont
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertSame
import kotlin.test.assertTrue

// The app's own fonts by family name on iOS (story 9.8): faces from the app bundle only, each
// file read once, collections and oversized files skipped.
class IosHostFontsTest {
    private val reads = mutableListOf<String>()

    private fun lookup(faces: Map<String, List<HostFace>>, sizes: Map<String, Long> = emptyMap()) = IosHostFonts(
        faces = { key -> faces[key].orEmpty() },
        size = { path -> sizes[path] ?: 100L },
        read = { path -> reads += path; path.encodeToByteArray() },
    )

    private fun FontFamily.loaded(): List<LoadedFont> = (this as FontListFontFamily).fonts.map { it as LoadedFont }

    @Test
    fun eachFaceGetsTheBytesOfItsOwnFileReadOncePerFile() {
        val fonts = lookup(
            mapOf(
                "brand sans" to listOf(
                    HostFace("BrandSans-Regular", "/app/Fonts/BrandSans-Regular.ttf", 400, false),
                    HostFace("BrandSans-Bold", "/app/Fonts/BrandSans-Bold.otf", 700, false),
                    HostFace("BrandSans-Italic", "/app/Fonts/BrandSans-Italic.ttf", 400, true),
                ),
                // Two faces in one (variable) file: read once.
                "flex" to listOf(
                    HostFace("Flex-Regular", "/app/Flex.ttf", 400, false),
                    HostFace("Flex-Black", "/app/Flex.ttf", 900, false),
                ),
            ),
        )
        val brand = fonts.find("'BRAND  sans'")!!.loaded()
        assertEquals(
            listOf(
                Triple("/app/Fonts/BrandSans-Regular.ttf", FontWeight.Normal, FontStyle.Normal),
                Triple("/app/Fonts/BrandSans-Bold.otf", FontWeight.Bold, FontStyle.Normal),
                Triple("/app/Fonts/BrandSans-Italic.ttf", FontWeight.Normal, FontStyle.Italic),
            ),
            brand.map { Triple(it.data.decodeToString(), it.weight, it.style) },
        )
        assertEquals("taleart-host-font-BrandSans-Bold", brand[1].identity)
        val flex = fonts.find("Flex")!!.loaded()
        assertEquals(listOf("/app/Flex.ttf", "/app/Flex.ttf"), flex.map { it.data.decodeToString() })
        assertSame(flex[0].data, flex[1].data)
        assertEquals(1, reads.count { it == "/app/Flex.ttf" })
        // Found once: asked again, nothing is read.
        fonts.find("brand sans")
        fonts.find("Flex")
        assertEquals(4, reads.size)
    }

    @Test
    fun collectionsAndFilesOverTheCapAreSkipped() {
        val fonts = lookup(
            mapOf(
                "pack" to listOf(HostFace("Pack", "/app/Pack.TTC", 400, false), HostFace("PackO", "/app/Pack.otc", 400, false)),
                "huge" to listOf(HostFace("Huge", "/app/Huge.ttf", 400, false)),
                "mixed" to listOf(HostFace("Mixed", "/app/Mixed.ttc", 400, false), HostFace("Mixed-Bold", "/app/Mixed-Bold.ttf", 700, false)),
            ),
            sizes = mapOf("/app/Huge.ttf" to MAX_HOST_FONT_BYTES + 1L),
        )
        assertNull(fonts.find("pack"))
        assertNull(fonts.find("huge"))
        assertEquals(listOf(FontWeight.Bold), fonts.find("mixed")!!.loaded().map { it.weight })
        assertTrue(reads.none { it.endsWith(".TTC") || it.endsWith(".otc") || it.endsWith(".ttc") || it == "/app/Huge.ttf" })
    }

    @Test
    fun fontsIOSHasAreNotTheApps() {
        // The test runner's bundle holds no font: Georgia and Courier New, on every iPhone, are not used.
        assertNull(IosHostFonts.shared.find("Georgia"))
        assertNull(IosHostFonts.shared.find("Courier New"))
        assertEquals(FontFamily.Serif, fontFamilyOf("Georgia, serif", IosHostFonts.shared))
    }

    @Test
    fun uiKitWeightsAreCssWeights() {
        assertEquals(400, cssWeight(0.0))
        assertEquals(700, cssWeight(0.4))
        assertEquals(100, cssWeight(-0.8))
        assertEquals(900, cssWeight(0.62))
        assertEquals(500, cssWeight(0.23))
    }
}
