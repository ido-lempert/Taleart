package site.lempert.taleart.sdk.ui

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

// The banner variants' pure logic: the slides' places, looks, the strip's marquee, the dismissal key.
class BannerVariantLogicTest {
    @Test
    fun withoutLoopASlideIsItsPlainDistanceFromTheTrack() {
        assertEquals(2f, bannerRelative(2, 0f, 3, loop = false))
        assertEquals(-1f, bannerRelative(0, 1f, 3, loop = false))
    }

    @Test
    fun withLoopTheDistanceWrapsToTheNearestSlide() {
        // Three slides: the last is just before the first, the first just after the last.
        assertEquals(-1f, bannerRelative(2, 0f, 3, loop = true))
        assertEquals(1f, bannerRelative(0, 2f, 3, loop = true))
        assertEquals(0f, bannerRelative(1, 1f, 3, loop = true))
        // Halfway through a move the distance is fractional, and still within half the count.
        assertEquals(0.5f, bannerRelative(1, 0.5f, 3, loop = true))
        assertEquals(0f, bannerRelative(0, 0f, 1, loop = true))
    }

    @Test
    fun theCoverflowLooksFallOffWithDistance() {
        val front = coverflowLook(0f)
        assertEquals(1f, front.scale)
        assertEquals(0f, front.rotation)
        assertEquals(1f, front.alpha)
        val next = coverflowLook(1f)
        assertEquals(0.74f, next.scale, 0.001f)
        assertEquals(32f, next.rotation, 0.001f)
        assertEquals(0.75f, next.alpha, 0.001f)
        // Beyond two slides the look stays at the far value.
        assertEquals(coverflowLook(2f).scale, coverflowLook(5f).scale, 0.0001f)
        assertEquals(0.56f, coverflowLook(2f).scale, 0.001f)
        // Halfway from the shown slide to its neighbour.
        assertEquals(0.87f, coverflowLook(0.5f).scale, 0.001f)
    }

    @Test
    fun thePeekAndDeckLooksShrinkTheCardsBehind() {
        assertEquals(0.92f, peekLook(1f).scale, 0.001f)
        assertEquals(0.6f, peekLook(1f).alpha, 0.001f)
        assertEquals(0f, peekLook(0f).rotation)
        assertEquals(14f, deckLook(1f).rotation, 0.001f)
        assertEquals(20f, deckLook(2f).rotation, 0.001f)
        assertEquals(0.16f, deckLook(1f).shift, 0.001f)
        assertEquals(0.94f, deckLook(1f).scale, 0.001f)
        assertEquals(1f, deckLook(0f).scale)
    }

    @Test
    fun aSideHasTheSignOfItsDistance() {
        assertEquals(-1f, sideOf(-0.5f))
        assertEquals(1f, sideOf(2f))
        assertEquals(0f, sideOf(0f))
    }

    @Test
    fun theStripMovesTowardTheStartOfTheLineAndLoopsEveryEighteenSeconds() {
        val second = 1_000_000_000L
        assertEquals(0, stripOffsetPx(0L, 1000))
        // Half a loop moves it half a copy; the layout mirrors the offset in right to left.
        assertEquals(-500, stripOffsetPx(9 * second, 1000))
        // One whole loop brings it back where it began; a loop and a half is halfway again.
        assertEquals(0, stripOffsetPx(STRIP_LOOP_MS * 1_000_000L, 1000))
        assertEquals(-500, stripOffsetPx(STRIP_LOOP_MS * 1_000_000L + 9 * second, 1000))
        // Nothing to move with yet, and no copy to move.
        assertEquals(0, stripOffsetPx(5 * second, 0))
        assertEquals(0, stripOffsetPx(-1L, 1000))
    }

    @Test
    fun aStickyDismissalIsKeyedBySlides() {
        assertEquals("a,b", stickyKey(listOf("a", "b")))
        assertEquals(stickyKey(listOf("a")), stickyKey(listOf("a")))
        assertTrue(stickyKey(listOf("a", "b")) != stickyKey(listOf("b", "a")))
        assertEquals(20, dotPillDp(true))
        assertEquals(8, dotPillDp(false))
    }
}
