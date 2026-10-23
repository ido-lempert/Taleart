package site.lempert.taleart.sdk.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.snapshots.Snapshot
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.ComposeUiTest
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.click
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeDown
import androidx.compose.ui.test.swipeLeft
import androidx.compose.ui.test.swipeRight
import androidx.compose.ui.test.v2.runComposeUiTest
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import androidx.lifecycle.compose.LocalLifecycleOwner
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
import site.lempert.taleart.sdk.delivery.DeliveryTaleGroup
import site.lempert.taleart.sdk.delivery.DeliveryZone
import site.lempert.taleart.sdk.delivery.HOME_TOP_ZONE_JSON
import site.lempert.taleart.sdk.delivery.readZone
import site.lempert.taleart.sdk.storage.InMemoryKeyValueStore
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

// The tale viewer against the Delivery API fixture (Summer trips: three tales of 5 s; Winter
// tales: two), on the test's own clock (mainClock, advanced by hand) and a fake video player.
// Images load from a fake server that answers 404: no test touches the network.
@OptIn(ExperimentalTestApi::class)
class TaleartViewerUiTest : ComposeUiTestBase() {
    private val summer = "905ea258-ccfd-4527-9b84-380c5fbe011a"
    private val winter = "48962270-14fe-4563-aa65-470ea8997fa1"
    private val zone: DeliveryZone = readZone(Json.parseToJsonElement(HOME_TOP_ZONE_JSON) as JsonObject)
    private val closed = mutableListOf<String>()
    private val shown = mutableListOf<String>()
    private val store = InMemoryKeyValueStore()
    private val seen = SeenGroups(store)
    private val videos = FakeVideoPlayer()

    // The person's reduced-motion setting as it changes while the viewer is open (open(live = true)).
    private val liveReduced = mutableStateOf(false)

    /** A fake player: each tale's video is an instance the test drives. */
    private class FakeVideoPlayer : TaleVideoPlayer {
        class Instance(val url: String) {
            var playing = false
            var disposed = false
            var progress: (Long, Long) -> Unit = { _, _ -> }
            var ended: () -> Unit = {}
            var error: () -> Unit = {}
        }

        val instances = mutableListOf<Instance>()

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
        ) {
            val instance = remember { Instance(url).also { instances += it } }
            SideEffect {
                instance.playing = playing
                instance.progress = onProgress
                instance.ended = onEnded
                instance.error = onError
            }
            DisposableEffect(instance) { onDispose { instance.disposed = true } }
            Box(modifier)
        }
    }

    @Composable
    private fun Fakes(lifecycle: LifecycleOwner? = null, content: @Composable () -> Unit) {
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
            LocalTaleVideoPlayer provides videos,
            LocalViewerInPlace provides true,
        ) {
            if (lifecycle != null) CompositionLocalProvider(LocalLifecycleOwner provides lifecycle, content = content) else content()
        }
    }

    // Opens the viewer at [group] on a clock the test advances.
    private fun ComposeUiTest.open(
        group: String = summer,
        groups: List<DeliveryTaleGroup> = zone.taleGroups,
        reduced: Boolean = false,
        lifecycle: LifecycleOwner? = null,
        live: Boolean = false,
        direction: LayoutDirection = LayoutDirection.Ltr,
    ) {
        mainClock.autoAdvance = false
        setContent {
            Fakes(lifecycle) {
                CompositionLocalProvider(LocalLayoutDirection provides direction) {
                TaleartViewer(
                    groups,
                    group,
                    onClose = { closed += it },
                    seenGroups = seen,
                    onGroupShown = { shown += it },
                    reducedMotion = if (live) liveReduced.value else reduced,
                )
                }
            }
        }
        frame()
    }

    // Changes the test makes from outside composition (a fake video's callbacks) reach it on the next frame.
    private fun ComposeUiTest.frame() {
        Snapshot.sendApplyNotifications()
        mainClock.advanceTimeByFrame()
        waitForIdle()
    }

    // Lets the viewer's motion finish (story 9.9): a cube turn, a spring, the close fade.
    private fun ComposeUiTest.settle() = advance(800)

    private fun ComposeUiTest.advance(ms: Long) {
        Snapshot.sendApplyNotifications()
        mainClock.advanceTimeBy(ms)
        waitForIdle()
    }

    // The tale on screen as `groupId/index`, or null when the viewer is closed.
    private fun ComposeUiTest.tale(): String? =
        onAllNodes(SemanticsMatcher.keyIsDefined(ViewerTale)).fetchSemanticsNodes().singleOrNull()?.config?.get(ViewerTale)

    private fun ComposeUiTest.fills(): List<Float> =
        onAllNodesWithTag(VIEWER_SEGMENT_TAG).fetchSemanticsNodes().map { it.config[SegmentFill] }

    private fun ComposeUiTest.announcement(): String =
        onAllNodes(SemanticsMatcher.keyIsDefined(SemanticsProperties.LiveRegion)).fetchSemanticsNodes().single()
            .config[SemanticsProperties.ContentDescription].joinToString()

    private fun ComposeUiTest.tap(fraction: Float) {
        onNodeWithTag(VIEWER_STAGE_TAG).performTouchInput { click(Offset(width * fraction, height / 2f)) }
        frame()
    }

    @Test
    fun opensTheTappedGroupAtItsFirstTaleWithOneSegmentPerTale() = runComposeUiTest {
        open(winter)

        assertEquals("$winter/0", tale())
        assertEquals(2, fills().size, "segments ${fills()}")
        assertEquals("Winter tales, tale 1 of 2", announcement())
        onNodeWithContentDescription("Close").assertExists()
        onNodeWithContentDescription("Pause").assertExists()
        onNodeWithContentDescription("Next tale").assertExists()
        onNodeWithContentDescription("Previous tale").assertExists()
    }

    @Test
    fun showsTheGroupsTalesInOrderEachForItsDurationWithTheProgressAdvancing() = runComposeUiTest {
        open(summer)

        advance(2_500)
        val half = fills()
        assertTrue(half[0] in 0.4f..0.6f, "fill $half")
        assertEquals(listOf(0f, 0f), half.drop(1))
        assertEquals("$summer/0", tale())

        advance(2_600)
        assertEquals("$summer/1", tale())
        assertEquals(1f, fills()[0])
        assertTrue(fills()[1] < 0.1f)
        assertEquals("Summer trips, tale 2 of 3", announcement())

        advance(5_100)
        assertEquals("$summer/2", tale())
    }

    @Test
    fun aTapOnTheRightStepsForwardAndOnTheLeftThirdBack() = runComposeUiTest {
        open(summer)

        tap(0.8f)
        assertEquals("$summer/1", tale())
        tap(0.4f) // still the right two thirds
        assertEquals("$summer/2", tale())
        tap(0.2f)
        assertEquals("$summer/1", tale())
        tap(0.1f)
        assertEquals("$summer/0", tale())
        // Previous on the very first tale restarts it.
        advance(1_000)
        tap(0.1f)
        assertEquals("$summer/0", tale())
        assertTrue(fills()[0] < 0.1f, "restarted at ${fills()}")
    }

    @Test
    fun theZonesNamedForScreenReadersStepToo() = runComposeUiTest {
        open(summer)

        onNodeWithContentDescription("Next tale").performClick()
        frame()
        assertEquals("$summer/1", tale())
        onNodeWithContentDescription("Previous tale").performClick()
        frame()
        assertEquals("$summer/0", tale())
    }

    @Test
    fun afterAGroupsLastTaleComesTheNextGroupAndAfterTheLastGroupTheViewerCloses() = runComposeUiTest {
        open(summer)

        repeat(3) { tap(0.9f) }
        assertEquals("$winter/0", tale())
        assertEquals(2, fills().size, "segments ${fills()}")
        // Back from the next group's first tale is the previous group's last.
        tap(0.1f)
        assertEquals("$summer/2", tale())
        tap(0.9f)
        // The last group runs out by itself: closed, reporting the group shown last.
        advance(5_100)
        assertEquals("$winter/1", tale())
        advance(5_100)
        settle()
        assertEquals(null, tale())
        assertEquals(listOf(winter), closed)
    }

    @Test
    fun marksEachGroupSeenAsItShows() = runComposeUiTest {
        open(summer)

        assertEquals(setOf(summer), seen.ids)
        assertEquals(listOf(summer), shown)
        onNodeWithTag(VIEWER_STAGE_TAG).performTouchInput { swipeLeft() }
        settle()
        assertEquals("$winter/0", tale())
        assertEquals(setOf(summer, winter), seen.ids)
        waitUntil("the stored ids", 5_000) { store.get(SEEN_STORAGE_KEY) == "[\"$summer\",\"$winter\"]" }
    }

    @Test
    fun aHoldPausesTheTaleAndItsReleaseResumesWithoutStepping() = runComposeUiTest {
        open(summer)

        advance(1_000)
        val before = fills()[0]
        onNodeWithTag(VIEWER_STAGE_TAG).performTouchInput { down(center) }
        frame()
        advance(8_000)
        assertEquals("$summer/0", tale())
        assertTrue(fills()[0] - before < 0.05f, "held at $before, now ${fills()[0]}")
        onNodeWithTag(VIEWER_STAGE_TAG).performTouchInput {
            advanceEventTime(400)
            up()
        }
        frame()
        assertEquals("$summer/0", tale())
        advance(4_200)
        assertEquals("$summer/1", tale())
    }

    @Test
    fun thePauseButtonPausesUntilPressedAgainAndStaysPausedOnTheNextTale() = runComposeUiTest {
        open(summer)

        onNodeWithContentDescription("Pause").performClick()
        frame()
        advance(6_000)
        assertEquals("$summer/0", tale())
        tap(0.9f)
        assertEquals("$summer/1", tale())
        advance(6_000)
        assertEquals("$summer/1", tale())
        onNodeWithContentDescription("Play").performClick()
        frame()
        advance(5_100)
        assertEquals("$summer/2", tale())
    }

    @Test
    fun swipesSidewaysChangeGroupAndASwipeDownCloses() = runComposeUiTest {
        open(summer)

        tap(0.9f)
        onNodeWithTag(VIEWER_STAGE_TAG).performTouchInput { swipeLeft() }
        settle()
        assertEquals("$winter/0", tale())
        onNodeWithTag(VIEWER_STAGE_TAG).performTouchInput { swipeRight() }
        settle()
        // The previous group opens at its first tale.
        assertEquals("$summer/0", tale())
        onNodeWithTag(VIEWER_STAGE_TAG).performTouchInput { swipeDown() }
        settle()
        assertEquals(null, tale())
        assertEquals(listOf(summer), closed)
    }

    @Test
    fun theCloseButtonCloses() = runComposeUiTest {
        open(winter)

        onNodeWithContentDescription("Close").performClick()
        settle()
        assertEquals(null, tale())
        assertEquals(listOf(winter), closed)
    }

    @Test
    fun theTaleWaitsWhileTheAppIsInTheBackground() = runComposeUiTest {
        val owner = object : LifecycleOwner {
            val registry = LifecycleRegistry.createUnsafe(this)
            override val lifecycle: Lifecycle get() = registry
        }
        owner.registry.currentState = Lifecycle.State.RESUMED
        open(summer, lifecycle = owner)

        advance(1_000)
        owner.registry.currentState = Lifecycle.State.STARTED
        frame()
        advance(10_000)
        assertEquals("$summer/0", tale())
        owner.registry.currentState = Lifecycle.State.RESUMED
        frame()
        advance(4_200)
        assertEquals("$summer/1", tale())
    }

    @Test
    fun underReducedMotionNothingAdvancesByItselfAndOnlyAVideoHasPlay() = runComposeUiTest {
        open(summer, reduced = true)

        advance(20_000)
        assertEquals("$summer/0", tale())
        // As on the web the timed tale's segment shows full, and no Pause or Play button shows.
        assertEquals(1f, fills()[0])
        onAllNodesWithContentDescription("Pause").assertCountEquals(0)
        onAllNodesWithContentDescription("Play").assertCountEquals(0)
        tap(0.9f)
        assertEquals("$summer/1", tale())
    }

    private val clips = readZone(
        Json.parseToJsonElement(
            """{"id":"z","name":"Z","slug":"clips","frame":{"id":"f","type":"bar","settings":{}},"taleGroups":[
              {"id":"clips","name":"Clips","tales":[
                {"id":"v","title":"Clip","media":{"kind":"video","contentType":"video/mp4","url":"http://api.test/media/clip.mp4"}},
                {"id":"i","title":"Still","media":{"kind":"image","contentType":"image/png","url":"http://api.test/media/still.png"}}
              ]}]}""",
        ) as JsonObject,
    ).taleGroups

    @Test
    fun aVideoTaleRunsOnItsVideoWithTheProgressFollowingItsPosition() = runComposeUiTest {
        open("clips", groups = clips)

        val video = videos.instances.single()
        assertEquals("http://api.test/media/clip.mp4", video.url)
        assertTrue(video.playing)
        // Longer than an image's 5 s: the video's own length runs the tale.
        video.progress(1_000, 8_000)
        advance(6_000)
        assertEquals("clips/0", tale())
        assertEquals(0.125f, fills()[0])
        video.progress(6_000, 8_000)
        frame()
        assertEquals(0.75f, fills()[0])
        // A hold pauses the video.
        onNodeWithTag(VIEWER_STAGE_TAG).performTouchInput { down(center) }
        frame()
        assertFalse(video.playing)
        onNodeWithTag(VIEWER_STAGE_TAG).performTouchInput {
            advanceEventTime(400)
            up()
        }
        frame()
        assertTrue(video.playing)
        video.ended()
        frame()
        assertEquals("clips/1", tale())
        assertTrue(video.disposed)
    }

    @Test
    fun aVideoThatCannotPlayRunsOnTheTimer() = runComposeUiTest {
        open("clips", groups = clips)

        videos.instances.single().error()
        frame()
        advance(5_100)
        assertEquals("clips/1", tale())
    }

    @Test
    fun underReducedMotionAVideoWaitsForPlayAndPausesAtItsEnd() = runComposeUiTest {
        open("clips", groups = clips, reduced = true)

        val video = videos.instances.single()
        assertFalse(video.playing)
        onNodeWithContentDescription("Play").performClick()
        frame()
        assertTrue(video.playing)
        video.ended()
        frame()
        assertEquals("clips/0", tale())
        assertFalse(video.playing)
        onNodeWithContentDescription("Play").assertExists()
    }

    @Test
    fun theZoneOpensTheViewerOnATapAndTheRingIsSeenOnceItCloses() = runComposeUiTest {
        mainClock.autoAdvance = false
        val zoneSeen = SeenGroups(InMemoryKeyValueStore())
        val clicked = mutableListOf<String>()
        setContent {
            Fakes {
                Box(Modifier.fillMaxSize()) {
                    TaleartZone(zone, onGroupClick = { clicked += it.id }, seenGroups = zoneSeen)
                }
            }
        }
        frame()
        // Unseen until the viewer shows the group.
        onNodeWithContentDescription("Winter tales").assertExists()
        assertEquals(emptySet(), zoneSeen.ids)
        onNodeWithContentDescription("Winter tales").performClick()
        frame()
        assertEquals(listOf(winter), clicked)
        assertEquals("$winter/0", tale())
        onNodeWithContentDescription("Close").performClick()
        settle()
        assertEquals(null, tale())
        onNodeWithContentDescription("Winter tales, seen").assertExists()
        onNodeWithContentDescription("Summer trips").assertExists()
    }

    @Test
    fun aHostThatHandlesTapsItselfGetsNoViewer() = runComposeUiTest {
        mainClock.autoAdvance = false
        val zoneSeen = SeenGroups(InMemoryKeyValueStore())
        val clicked = mutableListOf<String>()
        setContent {
            Fakes {
                TaleartZone(zone, onGroupClick = { clicked += it.id }, seenGroups = zoneSeen, opensViewer = false)
            }
        }
        frame()
        onNodeWithContentDescription("Summer trips").performClick()
        frame()
        assertEquals(listOf(summer), clicked)
        assertEquals(null, tale())
        assertEquals(emptySet(), zoneSeen.ids)
    }

    @Test
    fun rightToLeftTheRightThirdStepsBackAndTheRestForward() = runComposeUiTest {
        open(summer, direction = LayoutDirection.Rtl)

        tap(0.2f)
        assertEquals("$summer/1", tale())
        tap(0.5f)
        assertEquals("$summer/2", tale())
        tap(0.9f)
        assertEquals("$summer/1", tale())
    }

    @Test
    fun rightToLeftASwipeTowardTheRightShowsTheNextGroup() = runComposeUiTest {
        open(summer, direction = LayoutDirection.Rtl)

        onNodeWithTag(VIEWER_STAGE_TAG).performTouchInput { swipeRight() }
        settle()
        assertEquals("$winter/0", tale())
        onNodeWithTag(VIEWER_STAGE_TAG).performTouchInput { swipeLeft() }
        settle()
        assertEquals("$summer/0", tale())
    }

    @Test
    fun rightToLeftTheZonesLieMirroredAndEachDoesWhatItSays() = runComposeUiTest {
        open(summer, direction = LayoutDirection.Rtl)

        val stage = onNodeWithTag(VIEWER_STAGE_TAG).fetchSemanticsNode().boundsInRoot
        val previous = onNodeWithContentDescription("Previous tale").fetchSemanticsNode().boundsInRoot
        val next = onNodeWithContentDescription("Next tale").fetchSemanticsNode().boundsInRoot
        // Previous is the right third, Next the left two thirds.
        assertEquals(stage.right, previous.right, 1f)
        assertEquals(stage.left, next.left, 1f)
        assertTrue(previous.width < next.width)
        onNodeWithContentDescription("Next tale").performClick()
        frame()
        assertEquals("$summer/1", tale())
        onNodeWithContentDescription("Previous tale").performClick()
        frame()
        assertEquals("$summer/0", tale())
    }

    @Test
    fun aLateCallFromAnEarlierTalesPlayerChangesNothing() = runComposeUiTest {
        open("clips", groups = clips)

        val old = videos.instances.single()
        tap(0.9f)
        assertEquals("clips/1", tale())
        // The first tale's player reports after its tale has gone: ignored.
        old.progress(4_000, 8_000)
        old.ended()
        old.error()
        frame()
        assertEquals("clips/1", tale())
        assertTrue(fills()[1] < 0.1f, "fills ${fills()}")
        advance(2_500)
        assertTrue(fills()[1] in 0.4f..0.6f, "fills ${fills()}")
    }

    @Test
    fun underReducedMotionPlayAfterAVideoEndsPlaysItAgainFromTheStart() = runComposeUiTest {
        open("clips", groups = clips, reduced = true)

        onNodeWithContentDescription("Play").performClick()
        frame()
        val first = videos.instances.single()
        first.progress(8_000, 8_000)
        first.ended()
        frame()
        assertEquals(1f, fills()[0])
        onNodeWithContentDescription("Play").performClick()
        frame()
        // A new player from the start: the old one is gone, and its late calls change nothing.
        assertEquals(2, videos.instances.size)
        val again = videos.instances.last()
        assertTrue(first.disposed)
        assertTrue(again.playing)
        assertEquals(0f, fills()[0])
        first.ended()
        frame()
        assertTrue(again.playing)
        again.progress(2_000, 8_000)
        frame()
        assertEquals(0.25f, fills()[0])
    }

    @Test
    fun anAppNotInTheForegroundAsTheViewerOpensWaitsUntilItIs() = runComposeUiTest {
        val owner = object : LifecycleOwner {
            val registry = LifecycleRegistry.createUnsafe(this)
            override val lifecycle: Lifecycle get() = registry
        }
        owner.registry.currentState = Lifecycle.State.STARTED
        open(summer, lifecycle = owner)

        advance(8_000)
        assertEquals("$summer/0", tale())
        assertEquals(0f, fills()[0])
        owner.registry.currentState = Lifecycle.State.RESUMED
        frame()
        advance(5_100)
        assertEquals("$summer/1", tale())
    }

    @Test
    fun theOpenViewerKeepsItsGroupsWhenTheZoneIsReadAgain() = runComposeUiTest {
        mainClock.autoAdvance = false
        var current by mutableStateOf(zone)
        val zoneSeen = SeenGroups(InMemoryKeyValueStore())
        setContent {
            Fakes {
                Box(Modifier.fillMaxSize()) { TaleartZone(current, seenGroups = zoneSeen) }
            }
        }
        frame()
        onNodeWithContentDescription("Summer trips").performClick()
        frame()
        tap(0.9f)
        assertEquals("$summer/1", tale())
        // A reload brings a new zone: Summer trips lost a tale and the groups swapped places.
        current = zone.copy(
            taleGroups = listOf(zone.taleGroups[1], zone.taleGroups[0].copy(tales = zone.taleGroups[0].tales.take(1))),
        )
        frame()
        assertEquals("$summer/1", tale())
        assertEquals(3, fills().size)
        tap(0.9f)
        tap(0.9f)
        // The groups as they were when the viewer opened: Winter tales still follows.
        assertEquals("$winter/0", tale())
    }

    // Story 9.9: reduced motion turned on and off while a tale shows, and the viewer's motion.

    @Test
    fun turningReducedMotionOnWhileATaleShowsPausesItAndOffResumesIt() = runComposeUiTest {
        open(summer, live = true)
        advance(1_000)
        val playing = fills().first()
        assertTrue(playing in 0.15f..0.3f, "fill $playing")
        onNodeWithContentDescription("Pause").assertExists()

        liveReduced.value = true
        // The setting reaches the viewer as it composes, and its look on the next frame.
        frame()
        frame()
        // Paused where it was: the progress snaps full, the timer waits, the viewer stays open.
        assertEquals(1f, fills().first())
        onNodeWithContentDescription("Pause").assertDoesNotExist()
        onNodeWithContentDescription("Play").assertDoesNotExist()
        advance(8_000)
        assertEquals("$summer/0", tale())

        liveReduced.value = false
        frame()
        frame()
        onNodeWithContentDescription("Pause").assertExists()
        assertEquals(playing, fills().first(), 0.05f)
        // It goes on from where it was: the rest of the tale's 5 s, then the next tale.
        advance(4_200)
        assertEquals("$summer/1", tale())
        assertEquals(emptyList(), closed)
    }

    @Test
    fun aDragSidewaysTurnsTheNextGroupInBesideTheTaleUntilReleased() = runComposeUiTest {
        open(summer)
        val stage = onNodeWithTag(VIEWER_STAGE_TAG)
        stage.performTouchInput {
            down(center)
            moveBy(Offset(-width * 0.2f, 0f))
            moveBy(Offset(-width * 0.2f, 0f))
        }
        frame()
        // The next group's still page turns in while the finger holds; the live tale stays the same.
        onNodeWithTag(VIEWER_NEIGHBOR_TAG).assertExists()
        assertEquals("$summer/0", tale())
        stage.performTouchInput { up() }
        settle()
        onNodeWithTag(VIEWER_NEIGHBOR_TAG).assertDoesNotExist()
        assertEquals("$winter/0", tale())

        // A drag released short of a swipe springs back to the same group.
        stage.performTouchInput {
            down(Offset(width * 0.8f, height / 2f))
            moveBy(Offset(-width * 0.2f, 0f))
            moveBy(Offset(width * 0.2f - 30.dp.toPx(), 0f))
            up()
        }
        settle()
        // Released 30 dp from where it started: a tap on the right, the next tale of Winter.
        assertEquals("$winter/1", tale())
        onNodeWithTag(VIEWER_NEIGHBOR_TAG).assertDoesNotExist()
    }

    @Test
    fun aTapPastAGroupsLastTaleTurnsTheCubeByItself() = runComposeUiTest {
        open(summer)
        repeat(2) { tap(0.9f) }
        tap(0.9f)
        // The new group is live at once; the old one turns out beside it until the turn ends.
        assertEquals("$winter/0", tale())
        onNodeWithTag(VIEWER_NEIGHBOR_TAG).assertExists()
        settle()
        onNodeWithTag(VIEWER_NEIGHBOR_TAG).assertDoesNotExist()
    }

    @Test
    fun underReducedMotionNothingFollowsTheFingerAndTheViewerClosesAtOnce() = runComposeUiTest {
        open(summer, reduced = true)
        val stage = onNodeWithTag(VIEWER_STAGE_TAG)
        stage.performTouchInput {
            down(center)
            moveBy(Offset(-width * 0.2f, 0f))
            moveBy(Offset(-width * 0.2f, 0f))
        }
        frame()
        onNodeWithTag(VIEWER_NEIGHBOR_TAG).assertDoesNotExist()
        stage.performTouchInput { up() }
        frame()
        assertEquals("$winter/0", tale())
        onNodeWithTag(VIEWER_NEIGHBOR_TAG).assertDoesNotExist()
        onNodeWithContentDescription("Close").performClick()
        frame()
        frame()
        assertEquals(null, tale())
        assertEquals(listOf(winter), closed)
    }

    @Test
    fun closingFadesOutBeforeTheHostIsToldOnce() = runComposeUiTest {
        open(winter)
        settle()
        assertEquals(1f, presence())
        onNodeWithContentDescription("Close").performClick()
        advance(VIEWER_CLOSE_MS / 2L)
        // Still drawn, half faded, and the host not told yet.
        assertEquals("$winter/0", tale())
        val fading = presence()!!
        assertTrue(fading > 0f && fading < 1f, "presence $fading")
        assertEquals(emptyList(), closed)
        settle()
        assertEquals(null, tale())
        assertEquals(listOf(winter), closed)
        // Told once, whatever comes after.
        settle()
        assertEquals(listOf(winter), closed)
    }

    @Test
    fun theViewerOpensGrowingAndFadingIn() = runComposeUiTest {
        open(summer)
        val opening = presence()!!
        assertTrue(opening < 1f, "presence $opening")
        advance(VIEWER_OPEN_MS / 2L)
        val half = presence()!!
        assertTrue(half > opening && half < 1f, "presence $half")
        settle()
        assertEquals(1f, presence())
    }

    @Test
    fun aViewerThatLeavesMidFadeStillTellsTheHostOnce() = runComposeUiTest {
        mainClock.autoAdvance = false
        var showing by mutableStateOf(true)
        setContent {
            Fakes {
                if (showing) TaleartViewer(zone.taleGroups, winter, onClose = { closed += it }, seenGroups = seen, reducedMotion = false)
            }
        }
        frame()
        onNodeWithContentDescription("Close").performClick()
        frame()
        assertEquals(emptyList(), closed)
        showing = false
        frame()
        assertEquals(listOf(winter), closed)
        settle()
        assertEquals(listOf(winter), closed)
    }

    @Test
    fun aTouchWhileTheCubeSettlesLandsItAtOnce() = runComposeUiTest {
        open(summer)
        val stage = onNodeWithTag(VIEWER_STAGE_TAG)
        stage.performTouchInput { swipeLeft() }
        frame()
        // Mid-settle: the turn is still going.
        onNodeWithTag(VIEWER_NEIGHBOR_TAG).assertExists()
        stage.performTouchInput { down(center) }
        frame()
        // Landed on Winter at once, under the new finger.
        assertEquals("$winter/0", tale())
        onNodeWithTag(VIEWER_NEIGHBOR_TAG).assertDoesNotExist()
        stage.performTouchInput { up() }
        frame()
        // The release was a tap on the right: the next tale.
        assertEquals("$winter/1", tale())
    }

    @Test
    fun aWiggleOf20DpIsStillATap() = runComposeUiTest {
        open(summer)
        onNodeWithTag(VIEWER_STAGE_TAG).performTouchInput {
            down(Offset(width * 0.8f, height / 2f))
            moveBy(Offset(20.dp.toPx(), 0f))
            moveBy(Offset(-12.dp.toPx(), 4.dp.toPx()))
            up()
        }
        settle()
        assertEquals("$summer/1", tale())
        onNodeWithTag(VIEWER_NEIGHBOR_TAG).assertDoesNotExist()
    }

    @Test
    fun rightToLeftADragTowardTheRightTurnsTheNextGroupIn() = runComposeUiTest {
        open(summer, direction = LayoutDirection.Rtl)
        val stage = onNodeWithTag(VIEWER_STAGE_TAG)
        // Toward the left there is no group before Summer: nothing turns in.
        stage.performTouchInput {
            down(center)
            moveBy(Offset(-width * 0.2f, 0f))
            moveBy(Offset(-width * 0.1f, 0f))
        }
        frame()
        onNodeWithTag(VIEWER_NEIGHBOR_TAG).assertDoesNotExist()
        stage.performTouchInput { moveBy(Offset(width * 0.6f, 0f)) }
        frame()
        onNodeWithTag(VIEWER_NEIGHBOR_TAG).assertExists()
        stage.performTouchInput { up() }
        settle()
        assertEquals("$winter/0", tale())
    }

    @Test
    fun aSwipeDownReleasedShortSpringsBack() = runComposeUiTest {
        open(summer)
        settle()
        val page = onNodeWithTag(VIEWER_PAGE_TAG)
        val top = page.fetchSemanticsNode().boundsInRoot.top
        val stage = onNodeWithTag(VIEWER_STAGE_TAG)
        stage.performTouchInput {
            down(Offset(width * 0.5f, height * 0.3f))
            moveBy(Offset(0f, height * 0.15f))
            moveBy(Offset(0f, height * 0.15f))
        }
        frame()
        // The tale follows the finger down.
        assertTrue(page.fetchSemanticsNode().boundsInRoot.top > top + 10f)
        stage.performTouchInput {
            moveBy(Offset(0f, -height * 0.3f + 20.dp.toPx()))
            up()
        }
        frame()
        assertTrue(page.fetchSemanticsNode().boundsInRoot.top > top, "springing back, not snapped")
        settle()
        assertEquals(top, page.fetchSemanticsNode().boundsInRoot.top, 0.5f)
        assertEquals(emptyList(), closed)
    }

    private fun ComposeUiTest.presence(): Float? =
        onAllNodes(SemanticsMatcher.keyIsDefined(ViewerPresence)).fetchSemanticsNodes().singleOrNull()?.config?.get(ViewerPresence)
}
