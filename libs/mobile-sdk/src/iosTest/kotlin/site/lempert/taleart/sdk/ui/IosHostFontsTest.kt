package site.lempert.taleart.sdk.ui

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertSame

// iOS's fonts by family name (story 9.8): the simulator has Georgia and Courier New, as every iPhone.
class IosHostFontsTest {
    @Test
    fun aFamilyIOSHasIsFoundInAnyCaseWithItsFaces() {
        val georgia = assertNotNull(IosHostFonts.find("georgia"))
        // Found once: the same family again, whatever the case or quotes.
        assertSame(georgia, IosHostFonts.find("'GEORGIA'"))
        assertNotNull(IosHostFonts.find("Courier New"))
        assertNull(IosHostFonts.find("No Such Font Anywhere"))
        assertSame(georgia, fontFamilyOf("No Such Font, Georgia, serif", IosHostFonts))
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
