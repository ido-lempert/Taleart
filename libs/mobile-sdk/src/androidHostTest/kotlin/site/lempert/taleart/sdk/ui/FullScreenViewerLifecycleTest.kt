package site.lempert.taleart.sdk.ui

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.v2.runComposeUiTest
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import androidx.lifecycle.compose.LocalLifecycleOwner
import kotlin.test.Test
import kotlin.test.assertSame

// The full-screen viewer's dialog has a lifecycle of its own, which stays resumed while the app is
// in the background: the viewer must see the host's, so the tale waits while the app is away.
@OptIn(ExperimentalTestApi::class)
class FullScreenViewerLifecycleTest : ComposeUiTestBase() {
    @Test
    fun theViewerFollowsTheHostsLifecycleNotTheDialogs() = runComposeUiTest {
        val host = object : LifecycleOwner {
            val registry = LifecycleRegistry.createUnsafe(this).apply { currentState = Lifecycle.State.RESUMED }
            override val lifecycle: Lifecycle get() = registry
        }
        var seen: LifecycleOwner? = null
        setContent {
            CompositionLocalProvider(LocalLifecycleOwner provides host) {
                FullScreenViewer(Unit, onDismissRequest = {}) { seen = LocalLifecycleOwner.current }
            }
        }
        waitForIdle()
        assertSame(host, seen)
    }
}
