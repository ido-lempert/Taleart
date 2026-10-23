package site.lempert.taleart.taller

import android.graphics.Typeface
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontListFontFamily
import androidx.compose.ui.text.font.ResourceFont
import android.content.Context
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import site.lempert.taleart.sdk.ui.TaleartFonts
import site.lempert.taleart.sdk.ui.findInstalled
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertSame
import kotlin.test.assertTrue

// The SDK finds the fonts Taller ships by the family name in the content (story 9.8), on the
// app's real resources: Lobster in res/font, Pacifico in assets/fonts (Google Fonts' file name).
@RunWith(RobolectricTestRunner::class)
class HostFontsTest {
    private val context: Context = RuntimeEnvironment.getApplication()

    @Test
    fun lobsterIsFoundInResFontByItsResourceNameInAnyCase() {
        val family = assertNotNull(TaleartFonts.findInstalled(context, "Lobster"))
        val font = (family as FontListFontFamily).fonts.single()
        assertEquals(R.font.lobster, (font as ResourceFont).resId)
        assertSame(family, TaleartFonts.findInstalled(context, "'LOBSTER'"))
        // The resource is a real font Android loads.
        val typeface: Typeface? = context.resources.getFont(R.font.lobster)
        assertNotNull(typeface)
    }

    @Test
    fun pacificoIsFoundInAssetsFontsByItsRegularFace() {
        val family = assertNotNull(TaleartFonts.findInstalled(context, "pacifico"))
        val font = (family as FontListFontFamily).fonts.single()
        assertTrue(font.toString().contains("fonts/Pacifico-Regular.ttf"), "$font")
        assertNotNull(Typeface.createFromAsset(context.assets, "fonts/Pacifico-Regular.ttf"))
    }

    @Test
    fun aNameTheAppLacksIsNotFoundAndARegistrationWins() {
        assertNull(TaleartFonts.findInstalled(context, "Brand Sans"))
        // "Lob-ster" is another family than "Lobster" ("lob__ster"), and the OFL text is no font.
        assertNull(TaleartFonts.findInstalled(context, "Lob-ster"))
        assertNull(TaleartFonts.findInstalled(context, "Pacifico-OFL"))
        TaleartFonts.register("Lobster", FontFamily.Cursive)
        try {
            assertSame(FontFamily.Cursive, TaleartFonts.findInstalled(context, "lobster"))
        } finally {
            TaleartFonts.unregister("Lobster")
        }
    }
}
