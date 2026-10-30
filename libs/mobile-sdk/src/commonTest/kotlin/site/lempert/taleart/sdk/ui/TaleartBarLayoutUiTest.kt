package site.lempert.taleart.sdk.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.text.TextStyle
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.SemanticsNodeInteractionsProvider
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.v2.runComposeUiTest
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.CompletableDeferred
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import site.lempert.taleart.sdk.delivery.DeliveryClient
import site.lempert.taleart.sdk.delivery.DeliveryTaleGroup
import site.lempert.taleart.sdk.delivery.readZone
import site.lempert.taleart.sdk.i18n.defaultTranslate
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

// The four bar layouts drawn by TaleartBar (LTR and RTL), the loading skeleton and its footprint, against
// fixed group lists. Reduced motion is on, so every item is at rest when a test looks at it.
@OptIn(ExperimentalTestApi::class)
class TaleartBarLayoutUiTest : ComposeUiTestBase() {
    private val names = listOf("Summer", "Winter", "Spring", "Autumn", "Ocean")

    // The group list of a zone: [count] groups of [tales] tales each, named by [names].
    private fun groups(count: Int = 3, tales: Int = 2): List<DeliveryTaleGroup> {
        val groupsJson = (0 until count).joinToString(",", "[", "]") { i ->
            val name = names[i]
            val talesJson = (1..tales).joinToString(",") { t -> """{"id":"$name-$t","title":"Tale $t"}""" }
            """{"id":"$name","name":"$name","tales":[$talesJson]}"""
        }
        return readZone(Json.parseToJsonElement("""{"id":"z","name":"Z","slug":"z","theme":null,"frame":null,"taleGroups":$groupsJson}""") as JsonObject).taleGroups
    }

    @Composable
    private fun Bar(
        settings: BarSettings,
        groups: List<DeliveryTaleGroup>,
        seen: Set<String> = emptySet(),
        rtl: Boolean = false,
        onTap: (DeliveryTaleGroup) -> Unit = {},
    ) {
        val direction = if (rtl) LayoutDirection.Rtl else LayoutDirection.Ltr
        CompositionLocalProvider(LocalLayoutDirection provides direction) {
            TaleartBar(
                groups = groups,
                settings = settings,
                theme = TaleartTheme.DEFAULT,
                seen = seen,
                onGroupClick = onTap,
                modifier = Modifier.width(360.dp),
                reducedMotion = true,
            )
        }
    }

    private fun SemanticsNodeInteractionsProvider.labels(): List<String> =
        onAllNodesWithTag(BAR_ITEM_TAG).fetchSemanticsNodes().map { it.config[SemanticsProperties.ContentDescription].joinToString() }

    private fun SemanticsNodeInteractionsProvider.lefts(): List<Float> =
        onAllNodesWithTag(BAR_ITEM_TAG).fetchSemanticsNodes().map { it.boundsInRoot.left }

    private fun SemanticsNodeInteractionsProvider.titles(): List<String> =
        onAllNodes(SemanticsMatcher.keyIsDefined(BarTitle), useUnmergedTree = true).fetchSemanticsNodes().map { it.config[BarTitle] }

    private fun SemanticsNodeInteractionsProvider.dots(): Int = onAllNodesWithTag(BAR_DOT_TAG, useUnmergedTree = true).fetchSemanticsNodes().size

    // Items laid out in one row (same top) run left to right in LTR and right to left in RTL.
    private fun assertInOrder(lefts: List<Float>, rtl: Boolean) {
        val pairs = lefts.zipWithNext()
        assertTrue(pairs.isNotEmpty())
        for ((a, b) in pairs) {
            if (rtl) assertTrue(a > b, "RTL: $a should be right of $b") else assertTrue(a < b, "LTR: $a should be left of $b")
        }
    }

    @Test
    fun ringShowsEachGroupInDeliveredOrderLtrAndRtl() = runComposeUiTest {
        setContent { Bar(BarSettings(layout = BarLayout.Ring), groups(3)) }
        assertEquals(listOf("Summer", "Winter", "Spring"), labels())
        assertEquals(listOf("Summer", "Winter", "Spring"), titles())
        assertInOrder(lefts(), rtl = false)
    }

    @Test
    fun ringRtlMirrorsTheOrder() = runComposeUiTest {
        setContent { Bar(BarSettings(layout = BarLayout.Ring), groups(3), rtl = true) }
        assertEquals(listOf("Summer", "Winter", "Spring"), labels())
        assertInOrder(lefts(), rtl = true)
    }

    @Test
    fun aSeenRingSaysSeenInItsName() = runComposeUiTest {
        setContent { Bar(BarSettings(layout = BarLayout.Ring), groups(2), seen = setOf("Winter")) }
        assertEquals(listOf("Summer", "Winter, seen"), labels())
    }

    @Test
    fun chipHasOneItemPerGroupWithItsTitleAndUnseenDot() = runComposeUiTest {
        setContent { Bar(BarSettings(layout = BarLayout.Chip), groups(3), seen = setOf("Winter")) }
        assertEquals(listOf("Summer", "Winter, seen", "Spring"), labels())
        assertEquals(listOf("Summer", "Winter", "Spring"), titles())
        // Only the two unseen groups have the dot.
        assertEquals(2, dots())
    }

    @Test
    fun chipRtlMirrorsTheOrder() = runComposeUiTest {
        setContent { Bar(BarSettings(layout = BarLayout.Chip), groups(3), rtl = true) }
        assertEquals(listOf("Summer", "Winter", "Spring"), labels())
        val lefts = lefts()
        // The chips in one wrapped row run from the right edge in RTL.
        assertTrue(lefts[0] > lefts[1], "RTL: first chip should be right of the second")
    }

    @Test
    fun chipIgnoresTheShapeSettingAndKeepsItsTouchTarget() = runComposeUiTest {
        setContent {
            Bar(BarSettings(layout = BarLayout.Chip, shape = BarShape.RoundedSquare, showTitles = false), groups(2))
        }
        // Without titles the chip keeps its 48 dp touch target and carries its name in its label.
        assertEquals(listOf("Summer", "Winter"), labels())
        assertTrue(titles().isEmpty())
        val heights = onAllNodesWithTag(BAR_ITEM_TAG).fetchSemanticsNodes().map { it.boundsInRoot.height }
        assertTrue(heights.all { it >= 48f }, "chip heights $heights")
    }

    @Test
    fun aChipsPillIs44DpHighInsideItsTouchTargetAndSeenOnesLoseTheirDot() = runComposeUiTest {
        setContent { Bar(BarSettings(layout = BarLayout.Chip), groups(2), seen = setOf("Winter")) }
        // The 48 dp target holds the 44 dp pill; only the unseen chip has a dot.
        assertEquals(listOf(48f, 48f), onAllNodesWithTag(BAR_ITEM_TAG).fetchSemanticsNodes().map { it.boundsInRoot.height })
        assertEquals(1, dots())
        assertEquals(listOf(8f), onAllNodesWithTag(BAR_DOT_TAG, useUnmergedTree = true).fetchSemanticsNodes().map { it.boundsInRoot.height })
    }

    @Test
    fun posterHasOneCardPerGroupAndCaptionsItsTales() = runComposeUiTest {
        setContent { Bar(BarSettings(layout = BarLayout.Poster), groups(3, tales = 2)) }
        assertEquals(listOf("Summer, 2 stories", "Winter, 2 stories", "Spring, 2 stories"), labels())
        assertEquals(listOf("Summer", "Winter", "Spring"), titles())
    }

    @Test
    fun posterUsesTheSingularForOneTale() = runComposeUiTest {
        setContent { Bar(BarSettings(layout = BarLayout.Poster), groups(2, tales = 1)) }
        assertEquals(listOf("Summer, 1 story", "Winter, 1 story"), labels())
    }

    @Test
    fun posterRtlMirrorsTheOrder() = runComposeUiTest {
        setContent { Bar(BarSettings(layout = BarLayout.Poster), groups(3), rtl = true) }
        assertEquals(listOf("Summer", "Winter", "Spring"), titles())
        assertInOrder(lefts(), rtl = true)
    }

    @Test
    fun posterIgnoresTheSizeSetting() = runComposeUiTest {
        setContent { Bar(BarSettings(layout = BarLayout.Poster, size = BarSize.Large), groups(2)) }
        val large = onAllNodesWithTag(BAR_ITEM_TAG).fetchSemanticsNodes().map { it.boundsInRoot.width }
        assertEquals(listOf(112f, 112f), large)
        val heights = onAllNodesWithTag(BAR_ITEM_TAG).fetchSemanticsNodes().map { it.boundsInRoot.height }
        assertEquals(listOf(188f, 188f), heights)
    }

    @Test
    fun posterHidesTitlesWhenTheyAreOff() = runComposeUiTest {
        setContent { Bar(BarSettings(layout = BarLayout.Poster, showTitles = false), groups(2)) }
        assertTrue(titles().isEmpty())
        assertEquals(listOf("Summer, 2 stories", "Winter, 2 stories"), labels())
    }

    @Test
    fun stackIsOneButtonWithTheNewStoriesCaption() = runComposeUiTest {
        setContent { Bar(BarSettings(layout = BarLayout.Stack), groups(3)) }
        assertEquals(listOf("Summer, 3 new stories"), labels())
        // The stack draws its covers, not titles.
        assertTrue(titles().isEmpty())
    }

    @Test
    fun stackIsOnePillOfAtLeast60DpWithTheCaptionBesideTheCovers() = runComposeUiTest {
        setContent { Bar(BarSettings(layout = BarLayout.Stack, size = BarSize.Small), groups(3)) }
        val pill = onNodeWithTag(BAR_ITEM_TAG).fetchSemanticsNode().boundsInRoot
        assertEquals(60f, pill.height)
        // The caption is beside the covers: the pill is wider than 24 + three covers (40 + 2 x 26) + 12 + 14 plus the caption.
        assertTrue(pill.width > 142f, "pill $pill")
    }

    @Test
    fun stackFoldsTheGroupsPastFourIntoABubble() = runComposeUiTest {
        setContent { Bar(BarSettings(layout = BarLayout.Stack), groups(5)) }
        assertEquals(1, onAllNodesWithText("+1", useUnmergedTree = true).fetchSemanticsNodes().size)
        assertEquals(listOf("Summer, 5 new stories"), labels())
    }

    @Test
    fun stackOpensTheFirstUnseenGroup() = runComposeUiTest {
        val opened = mutableListOf<String>()
        setContent { Bar(BarSettings(layout = BarLayout.Stack), groups(3), seen = setOf("Summer"), onTap = { opened += it.name }) }
        onNodeWithTag(BAR_ITEM_TAG).performClick()
        assertEquals(listOf("Winter"), opened)
    }

    @Test
    fun stackOpensTheFirstGroupWhenAllAreSeen() = runComposeUiTest {
        val opened = mutableListOf<String>()
        setContent {
            Bar(BarSettings(layout = BarLayout.Stack), groups(2), seen = setOf("Summer", "Winter"), onTap = { opened += it.name })
        }
        assertEquals(listOf("Summer, 2 stories"), labels())
        onNodeWithTag(BAR_ITEM_TAG).performClick()
        assertEquals(listOf("Summer"), opened)
    }

    @Test
    fun stackIgnoresTheGapAndTheAlignment() {
        val plain = boundsOf(BAR_ITEM_TAG) { Bar(BarSettings(layout = BarLayout.Stack), groups(3)) }
        val spaced = boundsOf(BAR_ITEM_TAG) { Bar(BarSettings(layout = BarLayout.Stack, gap = 24, alignment = BarAlignment.Center), groups(3)) }
        assertEquals(plain.width, spaced.width, 0.5f)
        assertEquals(plain.height, spaced.height, 0.5f)
    }

    @Test
    fun aStackIgnoresTheTitleSettingAndTheGap() = runComposeUiTest {
        setContent { Bar(BarSettings(layout = BarLayout.Stack, showTitles = true, gap = 24), groups(3)) }
        assertTrue(titles().isEmpty())
    }

    @Test
    fun theSkeletonIsBusyAndNamedWhileTheZoneLoads() = runComposeUiTest {
        val gate = CompletableDeferred<Unit>()
        setContent { TaleartZone("http://api.test", "tak_key", client = heldClient(gate)) }
        waitUntil("skeleton", 5_000) { onAllNodesWithTag(BAR_SKELETON_TAG).fetchSemanticsNodes().isNotEmpty() }
        val node = onNodeWithTag(BAR_SKELETON_TAG).fetchSemanticsNode()
        assertEquals("Loading stories", node.config[SemanticsProperties.ContentDescription].joinToString())
        assertEquals(ProgressBarRangeInfo.Indeterminate, node.config[SemanticsProperties.ProgressBarRangeInfo])
        assertEquals(0, onAllNodesWithTag(BAR_TAG).fetchSemanticsNodes().size)
        // The zone arrives: the skeleton gives way to the bar.
        gate.complete(Unit)
        waitUntil("bar", 5_000) { onAllNodesWithTag(BAR_TAG).fetchSemanticsNodes().isNotEmpty() }
        assertEquals(0, onAllNodesWithTag(BAR_SKELETON_TAG).fetchSemanticsNodes().size)
    }

    @Test
    fun theSkeletonHasTheHeightOfEachLayoutsBar() {
        // Chips wrap by their titles' width, which differs by platform: the chip skeleton has its own test.
        val cases = listOf(
            BarSettings(layout = BarLayout.Ring) to 3,
            BarSettings(layout = BarLayout.Ring, size = BarSize.Small, showTitles = false) to 3,
            BarSettings(layout = BarLayout.Poster) to 3,
            BarSettings(layout = BarLayout.Stack, size = BarSize.Small) to 3,
            BarSettings(layout = BarLayout.Stack, size = BarSize.Large) to 3,
        )
        for ((settings, count) in cases) {
            val bar = heightOf(BAR_TAG) { Bar(settings, groups(count)) }
            val skeleton = heightOf(BAR_SKELETON_TAG) {
                BarSkeleton(settings, TextStyle.Default, defaultTranslate, reducedMotion = true, modifier = Modifier.width(360.dp))
            }
            assertEquals(bar, skeleton, 0.5f, "${settings.layout} ${settings.size} titles ${settings.showTitles}")
        }
    }

    @Test
    fun theSkeletonDrawsTheWebCountOfItemsPerLayout() = runComposeUiTest {
        // Ring 5 and poster 4 in a scrolling row, chip 4 in a wrapping one, stack one pill of four covers.
        setContent {
            Column {
                for (layout in BarLayout.entries) {
                    BarSkeleton(BarSettings(layout = layout), TextStyle.Default, defaultTranslate, reducedMotion = true, modifier = Modifier.width(360.dp))
                }
            }
        }
        val nodes = onAllNodesWithTag(BAR_SKELETON_TAG).fetchSemanticsNodes()
        assertEquals(4, nodes.size)
        // The chip skeleton is rows of 48 dp pills with the default 12 dp gap, plus the 4 dp padding of both sides.
        val chip = nodes[1].boundsInRoot.height
        val rows = (chip - 8f + 12f) / (48f + 12f)
        assertEquals(rows.toInt().toFloat(), rows, 0.01f, "chip skeleton height $chip")
        // The poster skeleton keeps the 32 dp above and below the cards for their shadows.
        assertEquals(188f + 2 * 32f, nodes[2].boundsInRoot.height)
    }

    private fun heightOf(tag: String, content: @Composable () -> Unit): Float = boundsOf(tag, content).height

    // The bounds in the root of the node tagged [tag] when [content] is composed alone.
    private fun boundsOf(tag: String, content: @Composable () -> Unit): Rect {
        var bounds = Rect.Zero
        runComposeUiTest {
            setContent { content() }
            bounds = onNodeWithTag(tag).fetchSemanticsNode().boundsInRoot
        }
        return bounds
    }

    private fun heldClient(gate: CompletableDeferred<Unit>): DeliveryClient = DeliveryClient(
        HttpClient(
            MockEngine {
                gate.await()
                respond(zoneJson(), HttpStatusCode.OK, headersOf(HttpHeaders.ContentType, "application/json"))
            },
        ),
    )

    private fun zoneJson() = """{"id":"z1","name":"Home top","slug":"home-top","theme":null,
        "frame":{"id":"f","type":"bar","settings":{"layout":"chip"}},
        "taleGroups":[{"id":"a","name":"Summer","tales":[{"id":"t","title":"T"}]}]}"""
}
