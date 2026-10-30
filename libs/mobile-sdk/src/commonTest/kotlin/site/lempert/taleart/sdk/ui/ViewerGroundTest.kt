package site.lempert.taleart.sdk.ui

import androidx.compose.ui.graphics.luminance
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ViewerGroundTest {
    // A tall phone letterboxes the 9:16 tale: the bands are the dark card colour, as on the Web SDK's phone viewer, not paper white.
    @Test
    fun theGroundBehindATaleIsDark() {
        assertEquals(CardDark, viewerGround())
        assertTrue(viewerGround().luminance() < 0.05f)
    }
}
