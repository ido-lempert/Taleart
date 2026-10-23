package site.lempert.taleart.sdk.android

import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.shadows.ShadowDialog
import site.lempert.taleart.sdk.delivery.DeliveryClient
import site.lempert.taleart.sdk.ui.VIEWER_TAG
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

// The viewer (story 9.4) from TaleartView in a host layout: a tap on a group opens it full screen
// in a dialog window over the activity, and closing it returns to the bar with the ring seen.
@RunWith(RobolectricTestRunner::class)
class TaleartViewViewerTest {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    // Two groups of tales sent without media or a document: each shows a placeholder, without a request.
    private val zone = """{"id":"z","name":"Z","slug":"home-top","frame":{"id":"f","type":"bar","settings":{}},"taleGroups":[
        {"id":"summer","name":"Summer","tales":[{"id":"a","title":"Beach"},{"id":"b","title":"Hike"}]},
        {"id":"winter","name":"Winter","tales":[{"id":"c","title":"Snow"}]}]}"""

    private fun client() = DeliveryClient(HttpClient(MockEngine {
        respond(zone, HttpStatusCode.OK, headersOf(HttpHeaders.ContentType, "application/json"))
    }))

    // A few frames: the dialog's window attaches, then its content composes and lays out.
    private fun frames() = repeat(5) {
        compose.mainClock.advanceTimeByFrame()
        compose.waitForIdle()
    }

    @Test
    fun aTapOnAGroupOpensTheViewerFullScreenInADialogAndCloseReturnsToTheBar() {
        lateinit var view: TaleartView
        compose.runOnUiThread {
            val activity = compose.activity
            view = TaleartView(activity).apply {
                client = client()
                configure("http://api.test", "tas_key", "home-top")
            }
            // A bar embedded in a host layout, 140 px high.
            val host = FrameLayout(activity)
            host.addView(view, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 140))
            activity.setContentView(host)
        }
        compose.waitUntil(5_000) { compose.onAllNodesWithContentDescription("Summer", substring = true).fetchSemanticsNodes().isNotEmpty() }
        assertEquals(0, compose.onAllNodesWithTag(VIEWER_TAG).fetchSemanticsNodes().size)

        // The viewer runs on the test's clock from here on.
        compose.mainClock.autoAdvance = false
        compose.onNodeWithContentDescription("Summer").performClick()
        frames()

        compose.onNodeWithTag(VIEWER_TAG).assertExists()
        val dialog = assertNotNull(ShadowDialog.getLatestDialog())
        assertTrue(dialog.isShowing)
        val params = assertNotNull(dialog.window).attributes
        assertEquals(ViewGroup.LayoutParams.MATCH_PARENT, params.width)
        assertEquals(ViewGroup.LayoutParams.MATCH_PARENT, params.height)
        // Not inside the 140 px bar: the viewer's window is the dialog's, not the activity's.
        assertTrue(dialog.window!!.decorView !== compose.activity.window.decorView)

        compose.onNodeWithContentDescription("Close").performClick()
        frames()
        assertEquals(0, compose.onAllNodesWithTag(VIEWER_TAG).fetchSemanticsNodes().size)
        assertFalse(dialog.isShowing)
        compose.onNodeWithContentDescription("Summer, seen").assertExists()
        assertTrue(view.hostsComposition)
    }

    @Test
    fun aViewDetachedFromItsWindowClosesItsViewer() {
        lateinit var host: FrameLayout
        lateinit var view: TaleartView
        compose.runOnUiThread {
            view = TaleartView(compose.activity).apply {
                client = client()
                configure("http://api.test", "tas_key", "home-top")
            }
            host = FrameLayout(compose.activity)
            host.addView(view)
            compose.activity.setContentView(host)
        }
        compose.waitUntil(5_000) { compose.onAllNodesWithContentDescription("Winter", substring = true).fetchSemanticsNodes().isNotEmpty() }
        compose.mainClock.autoAdvance = false
        compose.onNodeWithContentDescription("Winter", substring = true).performClick()
        frames()
        val dialog = assertNotNull(ShadowDialog.getLatestDialog())
        assertTrue(dialog.isShowing)

        compose.runOnUiThread { host.removeView(view) }
        frames()
        assertFalse(dialog.isShowing)
    }

    @Test
    fun aHostListenerIsCalledAndTheViewerStillOpens() {
        val tapped = mutableListOf<String>()
        compose.runOnUiThread {
            val view = TaleartView(compose.activity).apply {
                client = client()
                onGroupClickListener = { tapped += it.id }
                configure("http://api.test", "tas_key", "home-top")
            }
            compose.activity.setContentView(view)
        }
        compose.waitUntil(5_000) { compose.onAllNodesWithContentDescription("Winter", substring = true).fetchSemanticsNodes().isNotEmpty() }
        compose.mainClock.autoAdvance = false
        compose.onNodeWithContentDescription("Winter", substring = true).performClick()
        frames()
        assertEquals(listOf("winter"), tapped)
        compose.onNodeWithTag(VIEWER_TAG).assertExists()
    }

    @Test
    fun aHostThatHandlesTapsGetsTheGroupAndNoViewer() {
        val tapped = mutableListOf<String>()
        compose.runOnUiThread {
            val view = TaleartView(compose.activity).apply {
                client = client()
                opensViewer = false
                onGroupClickListener = { tapped += it.id }
                configure("http://api.test", "tas_key", "home-top")
            }
            compose.activity.setContentView(view)
        }
        compose.waitUntil(5_000) { compose.onAllNodesWithContentDescription("Winter", substring = true).fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithContentDescription("Winter", substring = true).performClick()
        compose.waitForIdle()
        assertEquals(listOf("winter"), tapped)
        assertEquals(0, compose.onAllNodesWithTag(VIEWER_TAG).fetchSemanticsNodes().size)
    }
}
