package site.lempert.taleart.sdk.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.snapshots.Snapshot
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.platform.UriHandler
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.ComposeUiTest
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.click
import androidx.compose.ui.test.swipe
import androidx.compose.ui.test.v2.runComposeUiTest
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.Dp
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
import site.lempert.taleart.sdk.delivery.readZone
import kotlin.math.abs
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

// The document layer (story 9.5) on a fixed 180 x 320 dp canvas, and in the viewer, against the
// real Delivery API response STUDIO_ZONE_JSON. Images load from a fake server that answers 404, a
// fake player stands in for video, and a fake UriHandler records the links opened.
@OptIn(ExperimentalTestApi::class)
class DocumentLayerUiTest : ComposeUiTestBase() {
    private val zone: DeliveryZone = readZone(Json.parseToJsonElement(STUDIO_ZONE_JSON) as JsonObject)
    private val group = zone.taleGroups.single()
    private val opened = mutableListOf<String>()
    private val uriHandler = object : UriHandler {
        override fun openUri(uri: String) {
            opened += uri
        }
    }

    private class FakeVideoPlayer : TaleVideoPlayer {
        var playing = false
        val urls = mutableListOf<String>()
        var progress: (Long, Long) -> Unit = { _, _ -> }

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
            SideEffect {
                urls += "$url:$playing"
                this.playing = playing
                progress = onProgress
            }
            DisposableEffect(Unit) { onDispose { } }
            Box(modifier)
        }
    }

    private val videos = FakeVideoPlayer()

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
            LocalTaleVideoPlayer provides videos,
            LocalViewerInPlace provides true,
            LocalUriHandler provides uriHandler,
            content = content,
        )
    }

    // The canvas: 180 x 320 dp, inside the test window on every host.
    private val canvasWidth = mutableStateOf(180.dp)

    private fun ComposeUiTest.canvas(layer: DocumentLayer) {
        setContent {
            Fakes {
                Box(Modifier.size(canvasWidth.value, canvasWidth.value * 16f / 9f)) { DocumentElementsLayer(layer) }
            }
        }
        waitForIdle()
    }

    private fun layerOf(vararg elements: String) = DocumentLayer.read(
        Json.parseToJsonElement("""{"version":1,"canvas":{"background":{"type":"color","color":"#000000"}},"elements":[${elements.joinToString(",")}]}""") as JsonObject,
    )

    private fun ComposeUiTest.node(id: String) = onNode(SemanticsMatcher.expectValue(DocumentElementId, id), useUnmergedTree = true)

    private fun close(expected: Dp, actual: Dp, what: String) =
        assertTrue(abs(expected.value - actual.value) <= 1f, "$what: expected $expected, got $actual")

    @Test
    fun placesEachElementFromItsBoxOnTheCanvas() = runComposeUiTest {
        val layer = TaleView.read(group.tales[0], 0).canvas!!.layer
        canvas(layer)
        onAllNodesWithTag(DOCUMENT_ELEMENT_TAG, useUnmergedTree = true).assertCountEquals(10)
        for (element in layer.elements.filter { it.box.rotation == 0.0 }) {
            val bounds = node(element.id).getUnclippedBoundsInRoot()
            val box = element.box
            close(180.dp * box.x.toFloat(), bounds.left, "${element.id} left")
            close(320.dp * box.y.toFloat(), bounds.top, "${element.id} top")
            close(180.dp * box.w.toFloat(), bounds.right - bounds.left, "${element.id} width")
            close(320.dp * box.h.toFloat(), bounds.bottom - bounds.top, "${element.id} height")
        }
        // The swipe-up link sits in the bottom safe area, whatever its box.
        val swipe = node(layer.elements.single { it is DocumentElement.SwipeUp }.id).getUnclippedBoundsInRoot()
        close(320.dp * 0.87f, swipe.top, "swipe-up top")
        // A rotated element turns about its centre: its top-left corner lands where the turn takes it
        // (the test's bounds are its unturned size placed at its turned top-left corner).
        val sticker = layer.elements.single { it is DocumentElement.Image && it.sticker }
        val bounds = node(sticker.id).getUnclippedBoundsInRoot()
        val angle = sticker.box.rotation * kotlin.math.PI / 180
        val halfW = 180 * sticker.box.w / 2
        val halfH = 320 * sticker.box.h / 2
        val cx = 180 * (sticker.box.x + sticker.box.w / 2)
        val cy = 320 * (sticker.box.y + sticker.box.h / 2)
        close((cx - halfW * kotlin.math.cos(angle) + halfH * kotlin.math.sin(angle)).toFloat().dp, bounds.left, "sticker corner x")
        close((cy - halfW * kotlin.math.sin(angle) - halfH * kotlin.math.cos(angle)).toFloat().dp, bounds.top, "sticker corner y")
    }

    @Test
    fun textSizesFollowTheCanvasHeight() = runComposeUiTest {
        val layer = TaleView.read(group.tales[0], 0).canvas!!.layer
        canvasWidth.value = 90.dp
        canvas(layer)
        val sale = layer.elements.filterIsInstance<DocumentElement.Text>().single { it.text.startsWith("Summer") }
        val small = textLayout(sale.text)
        canvasWidth.value = 180.dp
        waitForIdle()
        val large = textLayout(sale.text)
        val ratio = large.layoutInput.style.fontSize.value / small.layoutInput.style.fontSize.value
        assertEquals(2f, ratio, 0.01f)
    }

    private fun ComposeUiTest.textLayout(text: String): TextLayoutResult {
        val results = mutableListOf<TextLayoutResult>()
        onNodeWithText(text, useUnmergedTree = true).fetchSemanticsNode().config[SemanticsActions.GetTextLayoutResult].action!!.invoke(results)
        return results.single()
    }

    @Test
    fun aCallToActionOpensItsLinkThroughTheUriHandler() = runComposeUiTest {
        canvas(TaleView.read(group.tales[0], 0).canvas!!.layer)
        onNodeWithText("Shop the sale", useUnmergedTree = true).performClick()
        onNodeWithText("More deals", useUnmergedTree = true).performClick()
        waitForIdle()
        assertEquals(listOf("https://example.com/sale", "https://example.com/deals"), opened)
    }

    @Test
    fun inertLinksGoNowhere() = runComposeUiTest {
        setContent {
            Fakes { Box(Modifier.size(180.dp, 320.dp)) { DocumentElementsLayer(TaleView.read(group.tales[0], 0).canvas!!.layer, inertLinks = true) } }
        }
        onNodeWithText("Shop the sale", useUnmergedTree = true).performClick()
        waitForIdle()
        assertEquals(emptyList(), opened)
    }

    @Test
    fun anUnknownElementTypeIsSkipped() = runComposeUiTest {
        val layer = layerOf(
            """{"id":"poll","type":"poll","box":{"x":0,"y":0,"w":1,"h":0.5,"rotation":0},"a11y":{},"props":{"question":"?"}}""",
            """{"id":"text","type":"text","box":{"x":0.1,"y":0.6,"w":0.8,"h":0.1,"rotation":0},"a11y":{},"props":{"text":"Still here"}}""",
        )
        canvas(layer)
        onAllNodesWithTag(DOCUMENT_ELEMENT_TAG, useUnmergedTree = true).assertCountEquals(1)
        onNodeWithText("Still here", useUnmergedTree = true).assertExists()
        assertEquals(listOf("poll"), layer.skipped)
    }

    @Test
    fun rightToLeftTextAlignsToItsStartAndTheRowReadsFromTheRight() = runComposeUiTest {
        val layer = layerOf(
            """{"id":"left","type":"text","box":{"x":0.05,"y":0.2,"w":0.4,"h":0.1,"rotation":0},"a11y":{},"props":{"text":"שלום","align":"start"}}""",
            """{"id":"right","type":"text","box":{"x":0.55,"y":0.2,"w":0.4,"h":0.1,"rotation":0},"a11y":{},"props":{"text":"עולם","align":"start"}}""",
            """{"id":"english","type":"text","box":{"x":0.05,"y":0.5,"w":0.9,"h":0.1,"rotation":0},"a11y":{},"props":{"text":"Hi","align":"start"}}""",
        )
        canvas(layer)
        // The tale reads right to left: the right text comes first.
        assertEquals(listOf("right", "left", "english"), layer.elements.map { it.id })
        val order = listOf("right", "left", "english").map { node(it).fetchSemanticsNode().config[SemanticsProperties.TraversalIndex] }
        assertEquals(listOf(0f, 1f, 2f), order)
        // `start` follows each text's own direction: the Hebrew line sits at the right of its box, the English at the left.
        val hebrew = textLayout("שלום")
        assertTrue(hebrew.getLineLeft(0) > hebrew.size.width / 2f, "Hebrew starts on the right: ${hebrew.getLineLeft(0)} of ${hebrew.size.width}")
        val english = textLayout("Hi")
        assertTrue(english.getLineRight(0) < english.size.width / 2f, "English starts on the left")
    }

    @Test
    fun inTheViewerALinkTapOpensItWithoutSteppingAndAFlickUpOpensTheSwipeUpLink() = runComposeUiTest {
        mainClock.autoAdvance = false
        setContent {
            Fakes { TaleartViewer(zone.taleGroups, group.id, onClose = {}, reducedMotion = false) }
        }
        Snapshot.sendApplyNotifications()
        mainClock.advanceTimeByFrame()
        waitForIdle()
        onNodeWithText("Shop the sale", useUnmergedTree = true).performClick()
        mainClock.advanceTimeByFrame()
        waitForIdle()
        assertEquals(listOf("https://example.com/sale"), opened)
        val tale = onAllNodes(SemanticsMatcher.keyIsDefined(ViewerTale)).fetchSemanticsNodes().single().config[ViewerTale]
        assertEquals("${group.id}/0", tale)
        onNodeWithTag(VIEWER_STAGE_TAG).performTouchInput {
            swipe(Offset(width * 0.9f, height * 0.6f), Offset(width * 0.9f, height * 0.3f), durationMillis = 150)
        }
        mainClock.advanceTimeByFrame()
        waitForIdle()
        assertEquals(listOf("https://example.com/sale", "https://example.com/deals"), opened)
        // A plain tap on the stage still steps.
        onNodeWithTag(VIEWER_STAGE_TAG).performTouchInput { click(Offset(width * 0.97f, height * 0.55f)) }
        mainClock.advanceTimeByFrame()
        waitForIdle()
        assertEquals("${group.id}/1", onAllNodes(SemanticsMatcher.keyIsDefined(ViewerTale)).fetchSemanticsNodes().single().config[ViewerTale])
        // The second tale runs on its document's video, which plays muted with the tale.
        mainClock.advanceTimeByFrame()
        waitForIdle()
        assertTrue(videos.playing, "plays: ${videos.urls}")
    }

    @Test
    fun aRightToLeftHostDoesNotMirrorTheCanvas() = runComposeUiTest {
        val layer = layerOf(
            """{"id":"left","type":"shape","box":{"x":0.1,"y":0.2,"w":0.3,"h":0.1,"rotation":0},"a11y":{"label":"left"},"props":{"shape":"rectangle","fill":"#ff0000"}}""",
            """{"id":"hebrew","type":"text","box":{"x":0.1,"y":0.5,"w":0.5,"h":0.1,"rotation":0},"a11y":{},"props":{"text":"שלום","align":"start"}}""",
        )
        setContent {
            Fakes {
                CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl) {
                    Box(Modifier.size(180.dp, 320.dp)) { DocumentElementsLayer(layer) }
                }
            }
        }
        waitForIdle()
        // A box at x = 0.1 stays on the left, as the web's `left:`.
        close(18.dp, node("left").getUnclippedBoundsInRoot().left, "left box")
        close(18.dp, node("hebrew").getUnclippedBoundsInRoot().left, "text box")
        // The Hebrew text keeps its own direction: `start` is the right of its box.
        val hebrew = textLayout("שלום")
        assertTrue(hebrew.getLineLeft(0) > hebrew.size.width / 2f)
    }

    @Test
    fun textSizeIgnoresTheFontScale() = runComposeUiTest {
        val layer = layerOf("""{"id":"t","type":"text","box":{"x":0.1,"y":0.5,"w":0.8,"h":0.1,"rotation":0},"a11y":{},"props":{"text":"Same size","size":0.05}}""")
        val scale = mutableStateOf(1f)
        setContent {
            Fakes {
                val density = LocalDensity.current
                CompositionLocalProvider(LocalDensity provides Density(density.density, scale.value)) {
                    Box(Modifier.size(180.dp, 320.dp)) { DocumentElementsLayer(layer) }
                }
            }
        }
        waitForIdle()
        val normal = textLayout("Same size").size
        scale.value = 2f
        waitForIdle()
        assertEquals(normal, textLayout("Same size").size)
    }

    @Test
    fun linksAreButtonsThatSayTheyLeaveTheApp() = runComposeUiTest {
        canvas(TaleView.read(group.tales[0], 0).canvas!!.layer)
        val button = SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.Button)
        for (label in listOf("Shop the sale", "More deals")) {
            val config = onNode(button.and(hasText(label))).fetchSemanticsNode().config
            assertEquals(LINK_ACTION_LABEL, config[SemanticsActions.OnClick].label)
        }
        onNode(button.and(hasContentDescription("Open the lookbook"))).assertExists()
    }
}
