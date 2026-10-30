package site.lempert.taleart.sdk.ui

import androidx.compose.ui.graphics.Color
import kotlin.math.max
import kotlin.math.min
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

// The viewer's chrome: the press scale of its controls, their touch targets, and the contrast of the
// icon the accent draws on the dark scrim (the viewer's controls, as the canvas's `.ib`).
class ViewerChromeTest {
    private fun contrast(a: Color, b: Color): Double {
        val la = relativeLuminance(a)
        val lb = relativeLuminance(b)
        return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)
    }

    @Test
    fun `a pressed control shrinks on a spring and reduced motion keeps it in place`() {
        assertEquals(0.94f, controlScale(pressed = true, reducedMotion = false))
        assertEquals(1f, controlScale(pressed = true, reducedMotion = true))
        assertEquals(1f, controlScale(pressed = false, reducedMotion = false))
        assertEquals(1f, controlScale(pressed = false, reducedMotion = true))
    }

    @Test
    fun `a control's touch target is at least 48 dp and its disc fits inside it`() {
        assertTrue(CONTROL_TOUCH_DP >= 48, "Android's 48 dp, above iOS's 44 pt")
        assertTrue(CONTROL_DISC_DP <= CONTROL_TOUCH_DP)
        // The web's `.control`: a 44 px disc with a 24 px icon.
        assertEquals(44, CONTROL_DISC_DP)
        assertEquals(24, CONTROL_ICON_DP)
    }

    @Test
    fun `a tale's content rises 24 dp and grows from 96 percent while fading in and stays put under reduced motion`() {
        val (alpha0, rise0, scale0) = taleEntrance(0f, reducedMotion = false)
        assertEquals(0f, alpha0)
        assertEquals(24f, rise0)
        assertEquals(0.96f, scale0)
        val (alphaEnd, riseEnd, scaleEnd) = taleEntrance(1f, reducedMotion = false)
        assertEquals(1f, alphaEnd)
        assertEquals(0f, riseEnd)
        assertEquals(1f, scaleEnd)
        assertEquals(Triple(1f, 0f, 1f), taleEntrance(0f, reducedMotion = true))
        assertEquals(700, TALE_ENTER_MS)
    }

    @Test
    fun `the accent icon on the dark scrim reads at the WCAG AA ratio or more whatever the accent`() {
        val scrim = CardDark
        val accents = listOf(Color.Black, Color.White, Color(0xFF1365FC), Color(0xFFFFFF00), Color(0xFF6B7280), Color(0xFF111827))
        for (accent in accents) {
            val ink = readableOn(accent, scrim)
            assertTrue(contrast(ink, scrim) >= 4.5, "accent $accent gives ${contrast(ink, scrim)}")
        }
    }
}
