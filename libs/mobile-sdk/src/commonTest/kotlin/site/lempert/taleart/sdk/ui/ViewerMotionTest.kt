package site.lempert.taleart.sdk.ui

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import site.lempert.taleart.sdk.delivery.DeliveryZone
import site.lempert.taleart.sdk.delivery.HOME_TOP_ZONE_JSON
import site.lempert.taleart.sdk.delivery.readZone
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

// The viewer's live reduced motion and its group transition's state machine (story 9.9), on the
// Delivery API fixture: Summer trips (three tales of 5 s), then Winter tales (two).
class ViewerMotionTest {
    private val zone: DeliveryZone = readZone(Json.parseToJsonElement(HOME_TOP_ZONE_JSON) as JsonObject)
    private val summer = "905ea258-ccfd-4527-9b84-380c5fbe011a"

    private fun state(reduced: Boolean = false) = TaleViewerState(zone.taleGroups, summer, reduced)

    // A group whose first tale is a video, then a still.
    private val clips = readZone(
        Json.parseToJsonElement(
            """{"id":"z","name":"Z","slug":"clips","frame":{"id":"f","type":"bar","settings":{}},"taleGroups":[
              {"id":"clips","name":"Clips","tales":[
                {"id":"v","title":"Clip","media":{"kind":"video","contentType":"video/mp4","url":"http://api.test/media/clip.mp4"}},
                {"id":"i","title":"Still","media":{"kind":"image","contentType":"image/png","url":"http://api.test/media/still.png"}}
              ]},
              {"id":"more","name":"More","tales":[{"id":"m","title":"More","media":{"kind":"image","contentType":"image/png","url":"http://api.test/media/m.png"}}]}
            ]}""",
        ) as JsonObject,
    ).taleGroups

    @Test
    fun aVideoThatEndedUnderReducedMotionGoesOnOnceItIsTurnedOffAndNothingHoldsIt() {
        val state = TaleViewerState(clips, "clips", reducedMotion = true)
        state.videoEnded(state.shows, state.videoRuns)
        assertTrue(state.videoAtEnd)
        assertTrue(state.paused)
        // Turned off while a finger holds the stage: it waits for the finger.
        state.held = true
        state.reducedMotion = false
        assertEquals(0, state.taleIndex)
        state.held = false
        assertEquals(1, state.taleIndex)
        // In the background, it waits for the app to come back.
        val away = TaleViewerState(clips, "clips", reducedMotion = true)
        away.videoEnded(away.shows, away.videoRuns)
        away.inBackground = true
        away.reducedMotion = false
        assertEquals(0, away.taleIndex)
        away.inBackground = false
        assertEquals(1, away.taleIndex)
    }

    @Test
    fun turnedOnAndOffWhileHeldOrAwayTheTaleWaitsForThemToo() {
        val state = state()
        state.tick(1_000)
        state.held = true
        state.reducedMotion = true
        state.reducedMotion = false
        assertFalse(state.paused)
        // Still held: the timer waits.
        state.tick(10_000)
        assertEquals(1_000, state.elapsedMs)
        state.held = false
        state.tick(500)
        assertEquals(1_500, state.elapsedMs)
        state.inBackground = true
        state.reducedMotion = true
        assertTrue(state.paused)
        state.reducedMotion = false
        state.tick(10_000)
        assertEquals(0, state.taleIndex)
        state.inBackground = false
        state.tick(500)
        assertEquals(2_000, state.elapsedMs)
    }

    @Test
    fun aVideoThatEndsUnderAFingerOrATurningCubeGoesOnOnceReleased() {
        val state = TaleViewerState(clips, "clips")
        state.held = true
        state.videoEnded(state.shows, state.videoRuns)
        assertEquals(0, state.taleIndex)
        state.held = false
        assertEquals(1, state.taleIndex)

        val turning = TaleViewerState(clips, "clips")
        turning.turning = true
        assertTrue(turning.stopped)
        turning.videoEnded(turning.shows, turning.videoRuns)
        assertEquals(0, turning.taleIndex)
        turning.turning = false
        assertEquals(1, turning.taleIndex)
    }

    @Test
    fun aSettleLandsOnTheGroupItWasReleasedTowardEvenIfTheNeighborChanged() {
        val state = TaleViewerState(clips, "clips")
        val motion = ViewerMotion(state)
        motion.drag(-0.4f, dir = 1)
        assertEquals(-1f, motion.commitTarget(commit = true))
        // Something replaced the neighbor meanwhile: the settle still shows the group it was released toward.
        motion.neighbor = NeighborPage(0, TaleView.read(clips[0].tales[0], 0), 1)
        motion.finishSettle()
        assertEquals(1, state.groupIndex)
        assertNull(motion.neighbor)
        // Landed once: a second call changes nothing.
        motion.settled()
        assertEquals(1, state.groupIndex)
    }

    @Test
    fun aSettleTowardAGroupNoLongerBesideTheOneOnScreenLandsBack() {
        val state = state()
        val motion = ViewerMotion(state)
        motion.drag(-0.4f, dir = 1)
        motion.commitTarget(commit = true)
        // The viewer moved on meanwhile (Winter is now on screen): nothing more changes.
        state.nextGroup()
        motion.settled()
        assertEquals(1, state.groupIndex)
        assertEquals(0f, motion.offset)
    }

    @Test
    fun reducedMotionTurnedOnPausesWhereTheTaleIsAndTurnedOffGoesOn() {
        val state = state()
        state.tick(1_000)
        assertEquals(0.2f, state.progress, 0.001f)

        state.reducedMotion = true
        assertTrue(state.paused)
        // The progress snaps full and the timer waits.
        assertEquals(1f, state.progress)
        state.tick(10_000)
        assertEquals(1_000, state.elapsedMs)
        assertEquals(0, state.taleIndex)

        state.reducedMotion = false
        assertFalse(state.paused)
        assertEquals(0.2f, state.progress, 0.001f)
        state.tick(4_000)
        assertEquals(1, state.taleIndex)
        assertTrue(state.isOpen)
    }

    @Test
    fun aPauseThePersonMadeOutlastsReducedMotion() {
        val state = state()
        state.togglePause()
        state.reducedMotion = true
        state.reducedMotion = false
        assertTrue(state.paused)
        // A tale opened under reduced motion starts paused, then plays once it is turned off.
        val reducedFirst = state(reduced = true)
        assertTrue(reducedFirst.paused)
        reducedFirst.next()
        reducedFirst.reducedMotion = false
        assertFalse(reducedFirst.paused)
        assertEquals(1, reducedFirst.taleIndex)
    }

    @Test
    fun aDragTurnsTheCubeTowardTheNextGroupAndSettlesThere() {
        val state = state()
        val motion = ViewerMotion(state)
        motion.drag(-0.3f, dir = 1)
        assertTrue(motion.dragging)
        assertEquals(-0.3f, motion.offset)
        assertEquals(1, motion.neighbor?.groupIndex)
        assertEquals(1, motion.neighbor?.side)

        val target = motion.commitTarget(commit = true)
        assertEquals(-1f, target)
        assertFalse(motion.dragging)
        motion.settled()
        assertEquals(1, state.groupIndex)
        assertEquals(0, state.taleIndex)
        assertEquals(0f, motion.offset)
        assertNull(motion.neighbor)
    }

    @Test
    fun aShortDragSettlesBackAndTheFirstGroupResists() {
        val state = state()
        val motion = ViewerMotion(state)
        // Toward the previous group, which there is none of: the page moves a quarter of the way.
        motion.drag(0.4f, dir = 1)
        assertNull(motion.neighbor)
        assertEquals(0.4f * EDGE_RESISTANCE, motion.offset, 0.0001f)
        motion.drag(-0.1f, dir = 1)
        val target = motion.commitTarget(commit = false)
        assertEquals(0f, target)
        motion.settled()
        assertEquals(0, state.groupIndex)
        assertNull(motion.neighbor)
    }

    @Test
    fun rightToLeftTheNextGroupLiesToTheLeft() {
        val state = state()
        val motion = ViewerMotion(state)
        motion.drag(-0.3f, dir = -1)
        assertNull(motion.neighbor)
        motion.drag(0.3f, dir = -1)
        assertEquals(1, motion.neighbor?.groupIndex)
        assertEquals(-1, motion.neighbor?.side)
        assertEquals(1f, motion.commitTarget(commit = true))
    }

    @Test
    fun aGroupChangeWithoutADragTurnsTheCubeByItself() {
        val state = state()
        val motion = ViewerMotion(state)
        state.onGroupChange = { from, view, to -> motion.groupChanged(from, view, to, dir = 1) }
        val before = motion.settles
        state.nextGroup()
        // The new group comes in from the right, the old one (still) turning out to the left.
        assertEquals(1f, motion.offset)
        assertEquals(0, motion.neighbor?.groupIndex)
        assertEquals(-1, motion.neighbor?.side)
        assertEquals(before + 1, motion.settles)
        // Back: from the left.
        state.previousGroup()
        assertEquals(-1f, motion.offset)
        assertEquals(1, motion.neighbor?.side)
        // A tale change within a group does not turn the cube.
        motion.stop()
        state.next()
        assertNull(motion.neighbor)
        assertEquals(0f, motion.offset)
    }

    @Test
    fun underReducedMotionNothingMoves() {
        val state = state(reduced = true)
        val motion = ViewerMotion(state)
        state.onGroupChange = { from, view, to -> motion.groupChanged(from, view, to, dir = 1) }
        motion.drag(-0.5f, dir = 1)
        assertFalse(motion.dragging)
        assertEquals(0f, motion.offset)
        state.nextGroup()
        assertEquals(1, state.groupIndex)
        assertNull(motion.neighbor)
        assertEquals(0f, motion.offset)
    }
}
