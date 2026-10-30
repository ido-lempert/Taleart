package site.lempert.taleart.sdk.ui

import androidx.compose.ui.graphics.Color
import kotlinx.serialization.json.Json
import kotlin.math.max
import kotlin.math.min
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

// The theme's colour fields and the colours derived from them, as the Web SDK's theme.spec.ts checks them.
class ThemeColorsTest {
    private fun theme(json: String) = TaleartTheme.read(Json.parseToJsonElement(json))

    private fun contrast(a: Color, b: Color): Double {
        val la = relativeLuminance(a)
        val lb = relativeLuminance(b)
        return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)
    }

    private fun hex(value: String): Color = checkNotNull(parseHexColor(value)) { value }

    @Test
    fun `reads the new theme fields and keeps the defaults for missing or broken ones`() {
        assertEquals(TaleartTheme.DEFAULT, theme("{}"))
        assertEquals(ColorScheme.Auto, TaleartTheme.DEFAULT.colorScheme)
        assertEquals(null, TaleartTheme.DEFAULT.liveColor)
        assertEquals("#047857", TaleartTheme.DEFAULT.successColor)
        assertEquals("#b91c1c", TaleartTheme.DEFAULT.errorColor)

        val set = theme("""{"colorScheme":"dark","liveColor":"#00ff00","successColor":"#00aa00","errorColor":"#aa0000"}""")
        assertEquals(ColorScheme.Dark, set.colorScheme)
        assertEquals("#00ff00", set.liveColor)
        assertEquals("#00aa00", set.successColor)
        assertEquals("#aa0000", set.errorColor)

        val broken = theme("""{"colorScheme":"sepia","liveColor":"#fff","successColor":"green","errorColor":null}""")
        assertEquals(ColorScheme.Auto, broken.colorScheme)
        assertEquals(null, broken.liveColor)
        assertEquals("#047857", broken.successColor)
        assertEquals("#b91c1c", broken.errorColor)
        assertEquals(null, theme("""{"liveColor":null}""").liveColor)
    }

    @Test
    fun `auto follows the host's light or dark setting and light and dark force it`() {
        assertTrue(TaleartTheme.DEFAULT.colors(Color.Unspecified, systemDark = true).dark)
        assertEquals(false, TaleartTheme.DEFAULT.colors(Color.Unspecified, systemDark = false).dark)
        val light = theme("""{"colorScheme":"light"}""")
        val dark = theme("""{"colorScheme":"dark"}""")
        assertEquals(false, light.colors(Color.Unspecified, systemDark = true).dark)
        assertEquals(true, dark.colors(Color.Unspecified, systemDark = false).dark)
        // The card ground and its ink come from the resolved scheme.
        assertEquals(CardDark, dark.colors(Color.Unspecified, systemDark = false).paper)
        assertEquals(InkDark, dark.colors(Color.Unspecified, systemDark = false).ink)
        assertEquals(CardLight, light.colors(Color.Unspecified, systemDark = true).paper)
        assertEquals(InkLight, light.colors(Color.Unspecified, systemDark = true).ink)
    }

    @Test
    fun `derives the muted surface gap live success and error colours`() {
        val titled = theme("""{"titleColor":"#000000"}""").colors(Color.Unspecified, systemDark = false)
        assertEquals(hex("#000000"), titled.title)
        assertEquals(0.65f, titled.muted.alpha, 0.01f)
        assertEquals(0f, titled.muted.red)
        // A transparent background: the surface is the title at 6 %, and the cover's edge is the card ground.
        assertEquals(0.06f, titled.surface.alpha, 0.01f)
        assertEquals(CardLight, titled.gap)

        val banded = theme("""{"backgroundColor":"#fafafa"}""").colors(Color.Unspecified, systemDark = false)
        assertEquals(hex("#fafafa"), banded.surface)
        assertEquals(hex("#fafafa"), banded.gap)

        // The host's title colour when the theme sets none; the ink when the host gives none either.
        assertEquals(hex("#123456"), TaleartTheme.DEFAULT.colors(hex("#123456"), systemDark = false).title)
        assertEquals(InkLight, TaleartTheme.DEFAULT.colors(Color.Unspecified, systemDark = false).title)

        // The live colour is the last ring colour unless the theme sets one.
        assertEquals(hex("#7c3aed"), TaleartTheme.DEFAULT.colors(Color.Unspecified, systemDark = false).live)
        assertEquals(hex("#00ff00"), theme("""{"liveColor":"#00ff00"}""").colors(Color.Unspecified, systemDark = false).live)

        val marks = TaleartTheme.DEFAULT.colors(Color.Unspecified, systemDark = false)
        assertEquals(hex("#047857"), marks.success)
        assertEquals(hex("#b91c1c"), marks.error)
    }

    @Test
    fun `picks white or near-black on the accent by contrast`() {
        assertEquals(InkLight, onAccentColor(Color(0xFFFFFFFF)))
        assertEquals(InkLight, onAccentColor(hex("#ffff00")))
        assertEquals(Color(0xFFFFFFFF), onAccentColor(InkLight))
        assertEquals(Color(0xFFFFFFFF), onAccentColor(hex("#000080")))
        assertEquals(Color(0xFFFFFFFF), theme("""{"accentColor":"#000080"}""").colors(Color.Unspecified, false).onAccent)
    }

    @Test
    fun `the picked colour on any accent has at least the contrast of the other`() {
        for (accent in listOf("#ffffff", "#ffff00", "#111827", "#000080", "#ea580c", "#7c3aed", "#777777", "#fde68a")) {
            val picked = onAccentColor(hex(accent))
            val other = if (picked == Color(0xFFFFFFFF)) InkLight else Color(0xFFFFFFFF)
            assertTrue(contrast(picked, hex(accent)) >= contrast(other, hex(accent)), accent)
        }
    }

    @Test
    fun `the default success and error colours pass a 4 point 5 contrast on white`() {
        assertTrue(contrast(hex("#047857"), Color(0xFFFFFFFF)) >= 4.5)
        assertTrue(contrast(hex("#b91c1c"), Color(0xFFFFFFFF)) >= 4.5)
        // The dark card: the marks are lightened until they read at 4.5:1 on it, the defaults and custom colours alike.
        val dark = TaleartTheme.DEFAULT.colors(Color.Unspecified, systemDark = true)
        assertTrue(contrast(dark.successOnDark, CardDark) >= 4.5)
        assertTrue(contrast(dark.errorOnDark, CardDark) >= 4.5)
        assertEquals(dark.successOnDark, dark.successInk)
        val light = TaleartTheme.DEFAULT.colors(Color.Unspecified, systemDark = false)
        assertEquals(light.success, light.successInk)
        assertEquals(hex("#ffcc00"), readableOn(hex("#ffcc00"), CardDark))
        assertTrue(contrast(readableOn(hex("#0000ff"), CardDark), CardDark) >= 4.5)
    }
}
