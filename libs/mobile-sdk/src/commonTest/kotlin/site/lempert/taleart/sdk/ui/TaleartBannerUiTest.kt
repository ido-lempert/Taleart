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
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.ComposeUiTest
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsNotSelected
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeLeft
import androidx.compose.ui.test.swipeRight
import androidx.compose.ui.test.v2.runComposeUiTest
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
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
import site.lempert.taleart.sdk.delivery.HOME_TOP_ZONE_JSON
import site.lempert.taleart.sdk.delivery.readZone
import site.lempert.taleart.sdk.storage.InMemoryKeyValueStore
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

// The banner display (web zones R3) through TaleartZone, as libs/web-sdk/src/lib/banner.spec.ts
// tests the web one, on the test's own clock. Images load from a fake server that answers 404.
@OptIn(ExperimentalTestApi::class)
class TaleartBannerUiTest : ComposeUiTestBase() {
    private val summer = "905ea258-ccfd-4527-9b84-380c5fbe011a"
    private val winter = "48962270-14fe-4563-aa65-470ea8997fa1"
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

    private fun banner(settings: String = "{}") = """{"id":"f","type":"banner","settings":$settings}"""

    private fun tale(id: String) =
        """{"id":"$id","title":"$id","document":{"canvas":{"background":{"type":"color","color":"#336699"}},"version":1,"durationMs":5000,"elements":[]}}"""

    // Groups named by the arguments, each with one tale; a name ending in `!` has none.
    private fun groupsJson(vararg names: String) = names.joinToString(",", "[", "]") { name ->
        val bare = name.removeSuffix("!")
        val tales = if (name.endsWith("!")) "[]" else "[${tale("${bare.lowercase()}-1")}]"
        """{"id":"${bare.lowercase()}","name":"$bare","tales":$tales}"""
    }

    private fun zoneJson(frame: String, groups: String) =
        """{"id":"z1","name":"Home top","slug":"home-top","theme":null,"frame":$frame,"taleGroups":$groups}"""

    private val homeTopBanner = HOME_TOP_ZONE_JSON.replace("\"type\": \"bar\"", "\"type\": \"banner\"")

    // Shows the zone on a clock the test advances by hand (autoplay never lets it idle otherwise).
    private fun ComposeUiTest.show(
        zone: DeliveryZone,
        reduced: Boolean? = null,
        direction: LayoutDirection = LayoutDirection.Ltr,
    ) {
        mainClock.autoAdvance = false
        setContent {
            Fakes {
                CompositionLocalProvider(LocalLayoutDirection provides direction) {
                    Box(Modifier.fillMaxSize()) {
                        if (reduced == null) {
                            TaleartZone(zone, Modifier.width(360.dp), onGroupClick = { clicked += it.id }, seenGroups = seen)
                        } else {
                            val theme = TaleartTheme.read(zone.theme)
                            TaleartBanner(
                                zone.taleGroups,
                                BannerSettings.read(zone.frame?.settings),
                                theme,
                                onGroupClick = { clicked += it.id },
                                modifier = Modifier.width(360.dp),
                                reducedMotion = reduced,
                            )
                        }
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

    private fun ComposeUiTest.rotating(): Boolean =
        onAllNodes(SemanticsMatcher.keyIsDefined(BannerRotating)).fetchSemanticsNodes().single().config[BannerRotating]

    private fun ComposeUiTest.dots(): List<String> =
        onAllNodesWithTag(BANNER_DOT_TAG).fetchSemanticsNodes().map { it.config[SemanticsProperties.ContentDescription].joinToString() }

    private fun ComposeUiTest.slide(): Pair<String, String> =
        onAllNodesWithTag(BANNER_SLIDE_TAG).fetchSemanticsNodes().single().config.let {
            it[SemanticsProperties.ContentDescription].joinToString() to it[SemanticsProperties.StateDescription]
        }

    private fun ComposeUiTest.tale(): String? =
        onAllNodes(SemanticsMatcher.keyIsDefined(ViewerTale)).fetchSemanticsNodes().singleOrNull()?.config?.get(ViewerTale)

    @Test
    fun showsOneSlidePerGroupWithATaleInTheDeliveredOrder() = runComposeUiTest {
        show(zone(zoneJson(banner(), groupsJson("Third", "Empty!", "First", "Second"))))

        onNodeWithContentDescription("Banner").assertExists()
        // The group without tales has no slide, as in the Web SDK.
        assertEquals(listOf("Show Third", "Show First", "Show Second"), dots())
        assertEquals("Third" to "1 of 3", slide())
        assertEquals("third", shown())
        onNodeWithTag(BANNER_SLIDE_TAG).assertHasClickAction()
        onNodeWithContentDescription("Previous slide").assertHasClickAction()
        onNodeWithContentDescription("Next slide").assertHasClickAction()
        onNodeWithContentDescription("Stop automatic slide show").assertExists()
        onNodeWithContentDescription("Show Third").assertIsSelected()
        onNodeWithContentDescription("Show First").assertIsNotSelected()
        // Only the shown slide is there for screen readers and taps.
        assertEquals(1, onAllNodesWithTag(BANNER_SLIDE_TAG).fetchSemanticsNodes().size)
    }

    @Test
    fun theButtonsDotsAndSwipesChangeTheSlideAndStopAutoplay() = runComposeUiTest {
        show(zone(zoneJson(banner(), groupsJson("A", "B", "C"))))
        assertTrue(rotating())

        onNodeWithContentDescription("Next slide").performClick()
        frame()
        assertEquals("b", shown())
        assertEquals("B" to "2 of 3", slide())
        assertEquals(false, rotating())
        onNodeWithContentDescription("Start automatic slide show").assertExists()
        // Stopped for good: no timer moves it on.
        advance(20_000)
        assertEquals("b", shown())

        onNodeWithContentDescription("Show C").performClick()
        frame()
        assertEquals("c", shown())
        onNodeWithContentDescription("Show C").assertIsSelected()
        // Loop: after the last, the first; before the first, the last.
        onNodeWithContentDescription("Next slide").performClick()
        frame()
        assertEquals("a", shown())
        onNodeWithContentDescription("Previous slide").performClick()
        frame()
        assertEquals("c", shown())

        onNodeWithTag(BANNER_VIEWPORT_TAG).performTouchInput { swipeLeft() }
        advance(1_000)
        assertEquals("a", shown())
        onNodeWithTag(BANNER_VIEWPORT_TAG).performTouchInput { swipeRight() }
        advance(1_000)
        assertEquals("c", shown())
        // A swipe never opens a slide.
        assertEquals(emptyList(), clicked)
    }

    @Test
    fun autoplayShowsEachSlideForTheIntervalAndTheRotationButtonStopsAndRestartsIt() = runComposeUiTest {
        show(zone(zoneJson(banner("""{"intervalSeconds":3}"""), groupsJson("A", "B", "C"))))

        advance(2_900)
        assertEquals("a", shown())
        advance(200)
        assertEquals("b", shown())
        advance(3_000)
        assertEquals("c", shown())
        advance(3_000)
        assertEquals("a", shown())

        onNodeWithContentDescription("Stop automatic slide show").performClick()
        frame()
        assertEquals(false, rotating())
        advance(10_000)
        assertEquals("a", shown())
        onNodeWithContentDescription("Start automatic slide show").performClick()
        frame()
        assertTrue(rotating())
        advance(3_100)
        assertEquals("b", shown())
    }

    @Test
    fun withoutLoopTheEndsDisableTheirButtonAndAutoplayStopsOnTheLastSlide() = runComposeUiTest {
        show(zone(zoneJson(banner("""{"loop":false,"intervalSeconds":3}"""), groupsJson("A", "B"))))

        onNodeWithContentDescription("Previous slide").assertIsNotEnabled()
        onNodeWithContentDescription("Next slide").assertIsEnabled()
        advance(3_100)
        assertEquals("b", shown())
        assertEquals(false, rotating())
        onNodeWithContentDescription("Next slide").assertIsNotEnabled()
        // Nothing to start on the last slide.
        onNodeWithContentDescription("Start automatic slide show").assertIsNotEnabled()
        onNodeWithContentDescription("Next slide").performClick()
        frame()
        assertEquals("b", shown())
        onNodeWithContentDescription("Previous slide").performClick()
        frame()
        assertEquals("a", shown())
    }

    @Test
    fun underReducedMotionNothingMovesByItselfAndTheRotationButtonIsGone() = runComposeUiTest {
        show(zone(zoneJson(banner(), groupsJson("A", "B"))), reduced = true)

        assertEquals(false, rotating())
        assertEquals(0, onAllNodesWithContentDescription("Stop automatic slide show").fetchSemanticsNodes().size)
        assertEquals(0, onAllNodesWithContentDescription("Start automatic slide show").fetchSemanticsNodes().size)
        advance(20_000)
        assertEquals("a", shown())
        // The person still moves it, at once.
        onNodeWithContentDescription("Next slide").performClick()
        frame()
        assertEquals("b", shown())
    }

    @Test
    fun settingsHideTheDotsAndTheRotationButtonAndSetTheAspectRatio() = runComposeUiTest {
        var settings by mutableStateOf("""{"showDots":false,"autoplay":false,"aspectRatio":"3:1"}""")
        mainClock.autoAdvance = false
        setContent {
            Fakes { TaleartZone(zone(zoneJson(banner(settings), groupsJson("A", "B"))), Modifier.width(300.dp), seenGroups = seen) }
        }
        frame()
        assertEquals(emptyList(), dots())
        assertEquals(0, onAllNodesWithContentDescription("Start automatic slide show").fetchSemanticsNodes().size)
        assertEquals(false, rotating())
        // 300 wide at 3:1, and no row below: 16dp of margin around a 100dp slide area.
        val strip = onNodeWithTag(BANNER_VIEWPORT_TAG).getBoundsInRoot()
        assertEquals(100f, (strip.bottom - strip.top).value, 0.5f)
        assertEquals(116f, onNodeWithTag(BANNER_TAG).getBoundsInRoot().let { (it.bottom - it.top).value }, 0.5f)

        settings = """{"aspectRatio":"1:1"}"""
        frame()
        val square = onNodeWithTag(BANNER_VIEWPORT_TAG).getBoundsInRoot()
        assertEquals(300f, (square.bottom - square.top).value, 0.5f)
        assertEquals(listOf("Show A", "Show B"), dots())
        // The rotation button's 44dp row below, after a 4dp gap.
        assertEquals(300f + 16f + 48f, onNodeWithTag(BANNER_TAG).getBoundsInRoot().let { (it.bottom - it.top).value }, 0.5f)
    }

    @Test
    fun aSingleSlideHasNoButtonsDotsOrAutoplay() = runComposeUiTest {
        show(zone(zoneJson(banner(), groupsJson("Only", "Empty!"))))

        assertEquals("Only" to "1 of 1", slide())
        assertEquals(emptyList(), dots())
        assertEquals(0, onAllNodesWithContentDescription("Next slide").fetchSemanticsNodes().size)
        assertEquals(0, onAllNodesWithContentDescription("Previous slide").fetchSemanticsNodes().size)
        assertEquals(false, rotating())
    }

    @Test
    fun aZoneWhoseGroupsHaveNoTalesShowsNothing() = runComposeUiTest {
        show(zone(zoneJson(banner(), groupsJson("A!", "B!"))))

        assertEquals(0, onAllNodesWithTag(BANNER_TAG).fetchSemanticsNodes().size)
    }

    @Test
    fun aTapOnASlideOpensTheViewerAtItsGroupAndTheBannerShowsTheLastGroupOnClose() = runComposeUiTest {
        show(zone(homeTopBanner))
        assertEquals(summer, shown())

        onNodeWithTag(BANNER_SLIDE_TAG).performClick()
        frame()
        assertEquals(listOf(summer), clicked)
        assertEquals("$summer/0", tale())
        // The viewer moves on to the next group, then closes there.
        onNodeWithContentDescription("Next tale").performClick()
        onNodeWithContentDescription("Next tale").performClick()
        onNodeWithContentDescription("Next tale").performClick()
        frame()
        assertEquals("$winter/0", tale())
        onNodeWithContentDescription("Close").performClick()
        frame()
        assertEquals(null, tale())
        assertEquals(winter, shown())
        assertEquals(setOf(summer, winter), seen.ids)
    }

    @Test
    fun rightToLeftASwipeTowardTheRightShowsTheNextSlide() = runComposeUiTest {
        show(zone(zoneJson(banner(), groupsJson("A", "B", "C"))), direction = LayoutDirection.Rtl)

        onNodeWithTag(BANNER_VIEWPORT_TAG).performTouchInput { swipeRight() }
        advance(1_000)
        assertEquals("b", shown())
        onNodeWithTag(BANNER_VIEWPORT_TAG).performTouchInput { swipeLeft() }
        advance(1_000)
        assertEquals("a", shown())
    }

    @Test
    fun theDisplaySwitchesFromBarToBannerWhenTheZoneChanges() = runComposeUiTest {
        var json by mutableStateOf(HOME_TOP_ZONE_JSON)
        mainClock.autoAdvance = false
        setContent { Fakes { TaleartZone(zone(json), seenGroups = seen) } }
        frame()
        assertEquals(2, onAllNodesWithTag(BAR_ITEM_TAG).fetchSemanticsNodes().size)
        assertEquals(0, onAllNodesWithTag(BANNER_TAG).fetchSemanticsNodes().size)

        json = homeTopBanner
        frame()
        assertEquals(0, onAllNodesWithTag(BAR_TAG).fetchSemanticsNodes().size)
        assertEquals(summer, shown())
        assertEquals(listOf("Show Summer trips", "Show Winter tales"), dots())

        json = HOME_TOP_ZONE_JSON
        frame()
        assertEquals(0, onAllNodesWithTag(BANNER_TAG).fetchSemanticsNodes().size)
        assertEquals(2, onAllNodesWithTag(BAR_ITEM_TAG).fetchSemanticsNodes().size)
    }
}
