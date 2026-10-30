package site.lempert.taleart.sdk.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshots.Snapshot
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.unit.dp
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.ComposeUiTest
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.click
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.v2.runComposeUiTest
import androidx.compose.ui.unit.LayoutDirection
import coil3.ImageLoader
import coil3.compose.LocalPlatformContext
import coil3.network.ConnectivityChecker
import coil3.network.ktor3.KtorNetworkFetcherFactory
import coil3.serviceLoaderEnabled
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpStatusCode
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import site.lempert.taleart.sdk.delivery.DeliveryZone
import site.lempert.taleart.sdk.delivery.readZone
import site.lempert.taleart.sdk.storage.InMemoryKeyValueStore
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

// The banner's variants (coverflow, peek, deck, sticky, strip) through TaleartZone, in left to right and
// right to left. Each test names its own groups where the process keeps state (a sticky dismissal).
@OptIn(ExperimentalTestApi::class)
class TaleartBannerVariantsUiTest : ComposeUiTestBase() {
    private val seen = SeenGroups(InMemoryKeyValueStore())
    private val clicked = mutableListOf<String>()

    private object NoVideo : TaleVideoPlayer {
        @Composable
        override fun Video(
            url: String,
            fit: MediaFit,
            playing: Boolean,
            muted: Boolean,
            onProgress: (positionMs: Long, durationMs: Long) -> Unit,
            onEnded: () -> Unit,
            onError: () -> Unit,
            modifier: Modifier,
        ) = Box(modifier)
    }

    @Composable
    private fun Fakes(content: @Composable () -> Unit) {
        val context = LocalPlatformContext.current
        val loader = remember {
            ImageLoader.Builder(context)
                .serviceLoaderEnabled(false)
                .components {
                    add(
                        KtorNetworkFetcherFactory(connectivityChecker = { ConnectivityChecker.ONLINE }, httpClient = {
                            HttpClient(MockEngine { respond(ByteArray(0), HttpStatusCode.NotFound) })
                        }),
                    )
                }
                .build()
        }
        CompositionLocalProvider(
            LocalCoverImageLoader provides loader,
            LocalTaleVideoPlayer provides NoVideo,
            LocalViewerInPlace provides true,
            content = content,
        )
    }

    private fun zone(json: String): DeliveryZone = readZone(Json.parseToJsonElement(json) as JsonObject)

    private fun banner(settings: String) = """{"id":"f","type":"banner","settings":$settings}"""

    private fun tale(id: String) =
        """{"id":"$id","title":"$id","document":{"canvas":{"background":{"type":"color","color":"#336699"}},"version":1,"durationMs":5000,"elements":[]}}"""

    private fun groupsJson(vararg names: String) = names.joinToString(",", "[", "]") { name ->
        """{"id":"${name.lowercase()}","name":"$name","tales":[${tale("${name.lowercase()}-1")}]}"""
    }

    private fun zoneJson(frame: String, groups: String) =
        """{"id":"z1","name":"Home top","slug":"home-top","theme":null,"frame":$frame,"taleGroups":$groups}"""

    // The zone through TaleartZone, at 360dp wide, in the direction given.
    private fun ComposeUiTest.screen(zone: DeliveryZone, direction: LayoutDirection = LayoutDirection.Ltr) {
        mainClock.autoAdvance = false
        setContent {
            Fakes {
                CompositionLocalProvider(LocalLayoutDirection provides direction) {
                    Box(Modifier.fillMaxSize()) {
                        TaleartZone(zone, Modifier.width(360.dp), onGroupClick = { clicked += it.id }, seenGroups = seen)
                    }
                }
            }
        }
        frame()
    }

    private fun ComposeUiTest.frame() {
        Snapshot.sendApplyNotifications()
        mainClock.advanceTimeByFrame()
        waitForIdle()
    }

    private fun ComposeUiTest.advance(ms: Long) {
        Snapshot.sendApplyNotifications()
        mainClock.advanceTimeBy(ms)
        waitForIdle()
    }

    private fun ComposeUiTest.shown(): String? =
        onAllNodes(SemanticsMatcher.keyIsDefined(BannerShown)).fetchSemanticsNodes().singleOrNull()?.config?.get(BannerShown)

    private fun ComposeUiTest.variantShown(): String? =
        onAllNodes(SemanticsMatcher.keyIsDefined(BannerVariantShown)).fetchSemanticsNodes().singleOrNull()?.config?.get(BannerVariantShown)

    private fun ComposeUiTest.count(tag: String) = onAllNodesWithTag(tag).fetchSemanticsNodes().size

    // A node's bounds in pixels, unclipped: boundsInRoot is cut to the viewport, which hides a slide that
    // moves out of it. (getUnclippedBoundsInRoot gives Dp.)
    private fun unclipped(node: SemanticsNode): Rect {
        val at = node.positionInRoot
        return Rect(at.x, at.y, at.x + node.size.width, at.y + node.size.height)
    }

    private fun ComposeUiTest.px(tag: String): Rect = unclipped(onAllNodesWithTag(tag).fetchSemanticsNodes().single())

    private fun ComposeUiTest.viewport(): Rect = px(BANNER_VIEWPORT_TAG)

    private fun ComposeUiTest.slideName(): String? =
        onAllNodesWithTag(BANNER_SLIDE_TAG).fetchSemanticsNodes().singleOrNull()?.config?.get(androidx.compose.ui.semantics.SemanticsProperties.ContentDescription)?.joinToString()

    private fun ComposeUiTest.centreX(rect: Rect) = (rect.left + rect.right) / 2f

    // The neighbours in the order of the slides, by their unclipped bounds.
    private fun ComposeUiTest.neighbours(): List<Rect> =
        onAllNodesWithTag(BANNER_NEIGHBOUR_TAG).fetchSemanticsNodes().map(::unclipped)

    private fun ComposeUiTest.itemLeft(): Float =
        unclipped(onAllNodesWithTag(BANNER_STRIP_ITEM_TAG).fetchSemanticsNodes().first()).left

    // ---- coverflow ----------------------------------------------------------------------------------

    @Test
    fun coverflowShowsTheShownSlideInFrontCentredWithItsNeighbours() = runComposeUiTest {
        screen(zone(zoneJson(banner("""{"variant":"coverflow"}"""), groupsJson("A", "B", "C"))))

        assertEquals("coverflow", variantShown())
        assertEquals("A", slideName())
        assertEquals(2, count(BANNER_NEIGHBOUR_TAG))
        // The shown slide sits in the middle of the viewport; the neighbours are drawn beside it.
        val view = viewport()
        assertEquals(centreX(view), centreX(px(BANNER_SLIDE_TAG)), 1f)
        assertTrue(neighbours().all { it.left < view.right && it.right > view.left })
        onAllNodesWithText("Watch stories").fetchSemanticsNodes().let { assertTrue(it.isNotEmpty()) }
    }

    // At phone width the coverflow's centre card is small: its caption keeps only a small inset (the wide slide's 64 dp
    // for the arrows left a name no room, so it broke mid-word) and its button stays inside the card.
    @Test
    fun aSmallCardKeepsASmallInsetAndItsButtonInsideTheCard() = runComposeUiTest {
        screen(zone(zoneJson(banner("""{"variant":"coverflow","autoplay":false}"""), groupsJson("Summer", "Winter", "Trips"))))

        val card = px(BANNER_SLIDE_TAG)
        val button = unclipped(onAllNodesWithText("Watch stories", useUnmergedTree = true).fetchSemanticsNodes().first())
        val name = unclipped(onAllNodesWithText("Summer", useUnmergedTree = true).fetchSemanticsNodes().first())
        assertTrue(button.bottom <= card.bottom + 1f, "the button lies inside the card: ${button.bottom} vs ${card.bottom}")
        assertTrue(name.left - card.left <= 20f, "the name starts near the card's edge: ${name.left - card.left}")
    }

    @Test
    fun coverflowNextMovesToTheNeighbourAndATapOnItShowsIt() = runComposeUiTest {
        screen(zone(zoneJson(banner("""{"variant":"coverflow","autoplay":false}"""), groupsJson("A", "B", "C"))))

        onNodeWithContentDescription("Next slide").performClick()
        advance(1_000)
        assertEquals("b", shown())
        assertEquals("B", slideName())
        // The neighbour on the right is C; a tap on its visible edge shows it.
        onNodeWithTag(BANNER_VIEWPORT_TAG).performTouchInput { click(Offset(width - 4.dp.toPx(), height / 2f)) }
        advance(1_000)
        assertEquals("c", shown())
        assertEquals(emptyList(), clicked)
    }

    @Test
    fun coverflowMirrorsInRightToLeft() = runComposeUiTest {
        // After Next the next slide is on the right in left to right, on the left in right to left.
        screen(zone(zoneJson(banner("""{"variant":"coverflow","autoplay":false}"""), groupsJson("A", "B", "C"))), LayoutDirection.Rtl)
        onNodeWithContentDescription("Next slide").performClick()
        advance(1_000)

        val view = viewport()
        val next = neighbours().last()
        assertTrue(centreX(next) < centreX(view), "RTL: the next slide's centre ${centreX(next)} is on the left of ${centreX(view)}")
    }

    @Test
    fun coverflowInLeftToRightNextSlideIsOnTheRight() = runComposeUiTest {
        screen(zone(zoneJson(banner("""{"variant":"coverflow","autoplay":false}"""), groupsJson("A", "B", "C"))))
        onNodeWithContentDescription("Next slide").performClick()
        advance(1_000)

        val view = viewport()
        assertTrue(centreX(neighbours().last()) > centreX(view))
    }

    // ---- peek ---------------------------------------------------------------------------------------

    @Test
    fun peekShowsTheNeighboursAtTheEdgesAndATapOnAnEdgeShowsOne() = runComposeUiTest {
        screen(zone(zoneJson(banner("""{"variant":"peek","autoplay":false}"""), groupsJson("A", "B", "C"))))

        assertEquals("peek", variantShown())
        val view = viewport()
        // Both neighbours are partly visible: their nearest edges are inside the viewport.
        // By position: the slide after A is B on the right, the one before it is C on the left.
        val byX = neighbours().sortedBy { centreX(it) }
        val left = byX.first()
        val right = byX.last()
        assertTrue(right.left > centreX(view) && right.left < view.right, "$right in $view")
        assertTrue(left.right < centreX(view) && left.right > view.left, "$left in $view")

        onNodeWithTag(BANNER_VIEWPORT_TAG).performTouchInput { click(Offset(width - 4.dp.toPx(), height / 2f)) }
        advance(1_000)
        assertEquals("b", shown())
        assertEquals(emptyList(), clicked)
    }

    @Test
    fun peekInRightToLeftTheNextSlideIsOnTheLeft() = runComposeUiTest {
        screen(zone(zoneJson(banner("""{"variant":"peek","autoplay":false}"""), groupsJson("A", "B", "C"))), LayoutDirection.Rtl)
        onNodeWithContentDescription("Next slide").performClick()
        advance(1_000)

        val view = viewport()
        val next = neighbours().last()
        assertTrue(next.right > view.left && next.right < centreX(view), "RTL next $next in $view")
    }

    // ---- deck ---------------------------------------------------------------------------------------

    @Test
    fun deckOnlyTheFrontCardOpensTheGroup() = runComposeUiTest {
        screen(zone(zoneJson(banner("""{"variant":"deck","autoplay":false}"""), groupsJson("A", "B", "C"))))

        assertEquals("deck", variantShown())
        assertEquals(2, count(BANNER_NEIGHBOUR_TAG))
        onNodeWithTag(BANNER_SLIDE_TAG).performClick()
        frame()
        assertEquals(listOf("a"), clicked)
        assertEquals("A", slideName())
    }

    @Test
    fun deckFansTheNextCardToTheRightInLeftToRightAndToTheLeftInRightToLeft() = runComposeUiTest {
        screen(zone(zoneJson(banner("""{"variant":"deck","autoplay":false}"""), groupsJson("A", "B", "C"))))
        onNodeWithContentDescription("Next slide").performClick()
        advance(1_000)
        assertEquals("b", shown())
        assertTrue(centreX(neighbours().last()) > centreX(viewport()))
    }

    @Test
    fun deckInRightToLeftTheNextCardIsOnTheLeft() = runComposeUiTest {
        screen(zone(zoneJson(banner("""{"variant":"deck","autoplay":false}"""), groupsJson("A", "B", "C"))), LayoutDirection.Rtl)
        onNodeWithContentDescription("Next slide").performClick()
        advance(1_000)
        assertTrue(centreX(neighbours().last()) < centreX(viewport()))
    }

    // ---- sticky -------------------------------------------------------------------------------------

    @Test
    fun stickyIsOneBarWithArrowsButWithoutDotsAndIgnoresTheAspectRatio() = runComposeUiTest {
        screen(zone(zoneJson(banner("""{"variant":"sticky","showDots":true,"aspectRatio":"1:1"}"""), groupsJson("Compact", "Other"))))

        assertEquals("sticky", variantShown())
        assertEquals("Compact", slideName())
        assertEquals(0, count(BANNER_DOT_TAG))
        assertEquals(0, count(BANNER_VIEWPORT_TAG))
        // The previous and next buttons are there for two slides, each 44 dp in a 48 dp target.
        onAllNodesWithContentDescription("Next slide").fetchSemanticsNodes().let { assertEquals(1, it.size) }
        onAllNodesWithContentDescription("Previous slide").fetchSemanticsNodes().let { assertEquals(1, it.size) }
        // A slim bar: 64 dp and its 6 dp padding, well under the 1:1 viewport it would be.
        val card = px(BANNER_TAG)
        assertEquals(76f, card.bottom - card.top, 0.5f, "$card")
        assertEquals(0, onAllNodesWithText("Watch stories").fetchSemanticsNodes().size)
    }

    @Test
    fun stickyOfOneSlideHasNoArrows() = runComposeUiTest {
        screen(zone(zoneJson(banner("""{"variant":"sticky"}"""), groupsJson("Alone"))))
        onAllNodesWithContentDescription("Next slide").fetchSemanticsNodes().let { assertEquals(0, it.size) }
        assertEquals(1, count(BANNER_DISMISS_TAG))
    }

    @Test
    fun stickyNextAndPreviousButtonsMoveBetweenTheSlides() = runComposeUiTest {
        screen(zone(zoneJson(banner("""{"variant":"sticky","autoplay":false}"""), groupsJson("One", "Two"))))
        onNodeWithContentDescription("Next slide").performClick()
        advance(1_000)
        assertEquals("two", shown())
        onNodeWithContentDescription("Previous slide").performClick()
        advance(1_000)
        assertEquals("one", shown())
    }

    @Test
    fun stickyDismissHidesItAndStaysHiddenForTheRestOfTheProcess() = runComposeUiTest {
        var visible by mutableStateOf(true)
        mainClock.autoAdvance = false
        setContent {
            Fakes {
                if (visible) TaleartZone(zone(zoneJson(banner("""{"variant":"sticky"}"""), groupsJson("Dismissal", "Other"))), Modifier.width(360.dp), seenGroups = seen)
            }
        }
        frame()
        assertEquals(1, count(BANNER_TAG))
        onNodeWithTag(BANNER_DISMISS_TAG).performClick()
        frame()
        assertEquals(0, count(BANNER_TAG))

        // The zone leaves and comes back in this process: the dismissal is still remembered.
        visible = false
        frame()
        visible = true
        frame()
        assertEquals(0, count(BANNER_TAG))
    }

    @Test
    fun stickyDismissButtonIsOnTheEndInLeftToRightAndOnTheStartInRightToLeft() = runComposeUiTest {
        screen(zone(zoneJson(banner("""{"variant":"sticky"}"""), groupsJson("Ends", "Other"))))
        val ltrSlide = px(BANNER_SLIDE_TAG)
        val ltrDismiss = px(BANNER_DISMISS_TAG)
        assertTrue(ltrDismiss.left > ltrSlide.left, "LTR dismiss $ltrDismiss, slide $ltrSlide")
    }

    @Test
    fun stickyRightToLeftKeepsTheDismissOnTheStart() = runComposeUiTest {
        screen(zone(zoneJson(banner("""{"variant":"sticky"}"""), groupsJson("Starts", "Other"))), LayoutDirection.Rtl)
        val slide = px(BANNER_SLIDE_TAG)
        val dismiss = px(BANNER_DISMISS_TAG)
        assertTrue(dismiss.left < slide.left, "RTL dismiss $dismiss, slide $slide")
    }

    @Test
    fun stickyAutoplayCyclesAndAlwaysLoops() = runComposeUiTest {
        // Loop false and a 3 s interval: the sticky card still goes back to the first slide.
        screen(zone(zoneJson(banner("""{"variant":"sticky","loop":false,"intervalSeconds":3}"""), groupsJson("Cycle", "Again"))))

        advance(3_100)
        assertEquals("again", shown())
        advance(3_100)
        assertEquals("cycle", shown())
    }

    // ---- strip --------------------------------------------------------------------------------------

    @Test
    fun stripHasItsGroupsAsItemsAndNoDotsOrArrows() = runComposeUiTest {
        screen(zone(zoneJson(banner("""{"variant":"strip"}"""), groupsJson("Alpha", "Beta", "Gamma"))))

        assertEquals("strip", variantShown())
        assertEquals(3, count(BANNER_STRIP_ITEM_TAG))
        assertEquals(0, count(BANNER_DOT_TAG))
        assertEquals(0, onAllNodesWithContentDescription("Next slide").fetchSemanticsNodes().size)
        assertEquals(0, count(BANNER_SLIDE_TAG))
    }

    @Test
    fun stripScrollsAtAFixedSpeedAndPausesWhileTouched() = runComposeUiTest {
        screen(zone(zoneJson(banner("""{"variant":"strip"}"""), groupsJson("Alpha", "Beta", "Gamma"))))
        val start = itemLeft()

        advance(4_500)
        val quarter = itemLeft()
        advance(4_500)
        val half = itemLeft()
        assertTrue(quarter < start, "moved left: $quarter < $start")
        // Linear: twice the time, twice the distance.
        assertEquals((start - quarter) * 2, start - half, 2f)

        // A press holds the strip still until it is lifted.
        onNodeWithTag(BANNER_TAG).performTouchInput { down(center) }
        advance(3_000)
        // Held: at most the frame the press landed in still moves it (a pixel or so).
        assertEquals(half, itemLeft(), 2f)
        onNodeWithTag(BANNER_TAG).performTouchInput { up() }
        advance(3_000)
        assertTrue(itemLeft() < half, "moves again after the press")
    }

    @Test
    fun stripMovesTowardTheStartInRightToLeft() = runComposeUiTest {
        screen(zone(zoneJson(banner("""{"variant":"strip"}"""), groupsJson("Alpha", "Beta"))), LayoutDirection.Rtl)
        val start = itemLeft()
        advance(3_000)
        assertTrue(itemLeft() > start, "RTL: moves right")
    }

    @Test
    fun stripStopsUnderReducedMotionAndScrollsSideways() = runComposeUiTest {
        val z = zone(zoneJson(banner("""{"variant":"strip"}"""), groupsJson("Still", "Quiet")))
        mainClock.autoAdvance = false
        setContent {
            Fakes {
                TaleartBanner(
                    z.taleGroups,
                    BannerSettings.read(z.frame?.settings),
                    TaleartTheme.DEFAULT,
                    onGroupClick = {},
                    modifier = Modifier.width(360.dp),
                    reducedMotion = true,
                )
            }
        }
        frame()
        val start = itemLeft()
        advance(5_000)
        assertEquals(start, itemLeft(), 0.5f)
        // Sideways scrolling instead, and not moving by itself.
        assertTrue(onAllNodes(SemanticsMatcher.keyIsDefined(SemanticsProperties.HorizontalScrollAxisRange)).fetchSemanticsNodes().isNotEmpty())
        assertEquals(false, onAllNodesWithTag(BANNER_TAG).fetchSemanticsNodes().single().config[BannerRotating])
    }

    @Test
    fun aStripOfOneGroupStillFillsTheViewport() = runComposeUiTest {
        screen(zone(zoneJson(banner("""{"variant":"strip"}"""), groupsJson("Solo"))))
        assertEquals(1, count(BANNER_STRIP_ITEM_TAG))
        assertTrue(px(BANNER_TAG).let { it.right - it.left } >= 300f)  // the test root is 320 px wide
    }

}
