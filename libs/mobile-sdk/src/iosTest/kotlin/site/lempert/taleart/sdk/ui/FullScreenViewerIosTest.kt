package site.lempert.taleart.sdk.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.v2.runComposeUiTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

// The iOS modal when it cannot be presented: a test executable has no app and no window, as an app
// whose top controller cannot present has none to use. The viewer must then ask to close, once per
// open request, so the zone does not think a viewer is showing.
@OptIn(ExperimentalTestApi::class)
class FullScreenViewerIosTest : ComposeUiTestBase() {
    @Test
    fun withNoWindowToPresentOverTheViewerAsksToCloseOncePerRequest() = runComposeUiTest {
        assertNull(topViewController())
        val dismissed = mutableListOf<Int>()
        var request by mutableIntStateOf(1)
        setContent {
            val current = request
            FullScreenViewer(current, onDismissRequest = { dismissed += current }) { Box {} }
        }
        waitForIdle()
        assertEquals(listOf(1), dismissed)
        request = 2
        waitForIdle()
        assertEquals(listOf(1, 2), dismissed)
    }
}
