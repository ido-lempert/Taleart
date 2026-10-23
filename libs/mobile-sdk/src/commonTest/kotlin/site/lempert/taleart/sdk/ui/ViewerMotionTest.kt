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
        motion.settled(target)
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
        motion.settled(target)
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
