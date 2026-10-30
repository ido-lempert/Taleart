package site.lempert.taleart.sdk.ui

import androidx.compose.ui.graphics.Color
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

// The bar layouts' rules that draw nothing: the stack's covers and opened group, the poster's segments, the covers'
// sizes, the skeleton's count, the sweep colours, the chip dot's colour and the settings the zone last had.
class BarLayoutLogicTest {
    @Test
    fun aStackShowsUpToFourCoversAndFoldsTheRest() {
        assertEquals(0, stackVisibleCount(0))
        assertEquals(3, stackVisibleCount(3))
        assertEquals(4, stackVisibleCount(4))
        assertEquals(4, stackVisibleCount(9))
        assertEquals(0, stackOverflow(4))
        assertEquals(1, stackOverflow(5))
        assertEquals(6, stackOverflow(10))
        assertEquals(0, stackOverflow(0))
    }

    @Test
    fun aStackOpensTheFirstUnseenGroupAndTheFirstWhenAllAreSeen() {
        val ids = listOf("a", "b", "c")
        assertEquals(0, stackOpenIndex(ids, emptySet()))
        assertEquals(1, stackOpenIndex(ids, setOf("a")))
        assertEquals(2, stackOpenIndex(ids, setOf("a", "b")))
        assertEquals(0, stackOpenIndex(ids, setOf("a", "b", "c")))
        assertEquals(0, stackOpenIndex(ids, setOf("c", "x")))
        assertNull(stackOpenIndex(emptyList(), emptySet()))
        assertNull(firstUnseenIndex(ids, setOf("a", "b", "c")))
        assertEquals(2, firstUnseenIndex(ids, setOf("a", "b")))
    }

    @Test
    fun aPosterHasOneSegmentPerTaleUpToEight() {
        assertEquals(0, posterSegmentCount(0))
        assertEquals(1, posterSegmentCount(1))
        assertEquals(8, posterSegmentCount(8))
        assertEquals(8, posterSegmentCount(20))
    }

    @Test
    fun theCoversFollowTheSizeSettingAndAPosterIsThreeToFive() {
        assertEquals(listOf(28, 32, 40), BarSize.entries.map(::chipCoverDp))
        assertEquals(listOf(40, 48, 56), BarSize.entries.map(::stackCoverDp))
        assertEquals(3 * POSTER_HEIGHT_DP, 5 * POSTER_WIDTH_DP)
    }

    @Test
    fun aSkeletonDrawsItsLayoutsCount() {
        assertEquals(mapOf(BarLayout.Ring to 4, BarLayout.Chip to 3, BarLayout.Poster to 3, BarLayout.Stack to 3), BarLayout.entries.associateWith(::skeletonCount))
    }

    @Test
    fun aRingSweepHasUpToThreeColoursAndClosesOnTheFirst() {
        val (a, b, c) = listOf(Color.Red, Color.Green, Color.Blue)
        assertEquals(listOf(a, b, c, a), ringSweepColors(listOf(a, b, c)))
        assertEquals(listOf(a, b, c, a), ringSweepColors(listOf(a, b, c, Color.Black)))
        assertEquals(listOf(a), ringSweepColors(listOf(a)))
        assertEquals(emptyList(), ringSweepColors(emptyList()))
    }

    @Test
    fun aChipsDotIsTheAccentWhenItStandsOutElseTheLiveColour() {
        val paper = Color.White
        val live = Color(0xFFDB2777)
        // White on white: the accent does not stand out, so the live colour marks the dot.
        assertEquals(live, accentDotColor(Color.White, paper, live))
        // A dark accent on a white card stands out at 3:1 or more.
        assertEquals(Color(0xFF1D4ED8), accentDotColor(Color(0xFF1D4ED8), paper, live))
    }

    @Test
    fun theLastSettingsOfAZoneAreKeptPerZoneKeyOnly() {
        assertNull(LastBarSettings.of("tak_a"))
        LastBarSettings.remember("tak_a", BarSettings(layout = BarLayout.Poster))
        LastBarSettings.remember("", BarSettings(layout = BarLayout.Chip))
        assertEquals(BarLayout.Poster, LastBarSettings.of("tak_a")?.layout)
        assertNull(LastBarSettings.of("tak_b"))
        assertNull(LastBarSettings.of(""))
        LastBarSettings.remember("tak_a", BarSettings(layout = BarLayout.Stack))
        assertEquals(BarLayout.Stack, LastBarSettings.of("tak_a")?.layout)
    }

    @Test
    fun theCountWordsFollowTheCount() {
        assertEquals("bar.story", storiesKey(1))
        assertEquals("bar.stories", storiesKey(0))
        assertEquals("bar.stories", storiesKey(2))
        assertEquals("bar.newStory", newStoriesKey(1))
        assertEquals("bar.newStories", newStoriesKey(3))
    }
}
