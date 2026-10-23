package site.lempert.taleart.sdk.ui

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import site.lempert.taleart.sdk.delivery.readZone
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

// A document's own video runs its tale (R5) with the Web SDK's rules: at most 15 s, and a stall of
// 5 s while it should play ends the tale (`useVideo`, `armWatchdog` in viewer.ts).
class DocumentVideoStateTest {
    private val groups = readZone(Json.parseToJsonElement(STUDIO_ZONE_JSON) as JsonObject).taleGroups
    private val group = groups.single()

    // A viewer on the video tale (the group's second).
    private fun onVideoTale(reduced: Boolean = false): TaleViewerState =
        TaleViewerState(groups, group.id, reducedMotion = reduced).also { it.next() }

    @Test
    fun theDocumentVideoIsTheClockAndIsCapped() {
        val state = onVideoTale()
        assertEquals(1, state.taleIndex)
        assertFalse(state.timed)
        assertTrue(state.capped)
        // A 30 s video fills its segment over 15 s.
        state.videoProgress(state.shows, state.videoRuns, 7_500, 30_000)
        assertEquals(0.5f, state.progress, 0.001f)
        state.videoProgress(state.shows, state.videoRuns, 15_000, 30_000)
        // The last tale of the last group: the viewer closes.
        assertFalse(state.isOpen)
    }

    @Test
    fun aShortVideoFillsOverItsOwnLength() {
        val state = onVideoTale()
        state.videoProgress(state.shows, state.videoRuns, 1_000, 4_000)
        assertEquals(0.25f, state.progress, 0.001f)
    }

    @Test
    fun aStallOfFiveSecondsEndsTheTaleButProgressRearmsTheCheck() {
        val state = onVideoTale()
        state.stallTick(4_000)
        state.videoProgress(state.shows, state.videoRuns, 500, 4_000)
        state.stallTick(4_000)
        assertTrue(state.isOpen)
        // The same position again is no progress.
        state.videoProgress(state.shows, state.videoRuns, 500, 4_000)
        state.stallTick(1_000)
        assertFalse(state.isOpen)
    }

    @Test
    fun noStallCheckWhilePausedOrUnderReducedMotion() {
        val state = onVideoTale()
        state.togglePause()
        state.stallTick(10_000)
        assertTrue(state.isOpen)
        val reduced = onVideoTale(reduced = true)
        reduced.togglePause()
        reduced.stallTick(10_000)
        assertTrue(reduced.isOpen)
    }

    @Test
    fun aVideoThatFailsRunsTheTaleOnTheTimer() {
        val state = onVideoTale()
        state.videoFailed(state.shows, state.videoRuns)
        assertTrue(state.timed)
        assertFalse(state.capped)
        state.stallTick(10_000)
        assertTrue(state.isOpen)
    }

    @Test
    fun aTaleWithoutVideoRunsOnTheTimer() {
        val state = TaleViewerState(groups, group.id)
        assertTrue(state.timed)
        assertEquals(15_000, state.view.durationMs)
    }
}
