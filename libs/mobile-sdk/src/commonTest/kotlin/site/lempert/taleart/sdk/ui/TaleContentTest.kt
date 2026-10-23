package site.lempert.taleart.sdk.ui

import kotlinx.serialization.json.Json
import site.lempert.taleart.sdk.delivery.DeliveryMedia
import site.lempert.taleart.sdk.delivery.DeliveryTale
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

// How the viewer reads a tale, as renderContent in libs/web-sdk/src/lib/viewer.ts.
class TaleContentTest {
    private fun tale(document: String?, media: DeliveryMedia? = null, title: String = "Beach") =
        DeliveryTale(id = "t", title = title, media = media, document = document?.let { Json.parseToJsonElement(it) })

    private val ownImage = """{"id":"m","type":"image","box":{"x":0,"y":0,"w":1,"h":1,"rotation":0},"a11y":{"decorative":true},
        "props":{"url":"https://cdn.test/a.png","fit":"contain","taleMedia":true}}"""

    @Test
    fun aDocumentTalePlaysItsDurationOrSevenSeconds() {
        assertEquals(4_000, TaleView.read(tale("""{"durationMs":4000,"elements":[]}"""), 0).durationMs)
        assertEquals(DEFAULT_TALE_DURATION_MS, TaleView.read(tale("""{"elements":[]}"""), 0).durationMs)
        assertEquals(DEFAULT_TALE_DURATION_MS, TaleView.read(tale("""{"durationMs":"4000","elements":[]}"""), 0).durationMs)
    }

    @Test
    fun aTaleWithoutADocumentShowsItsMediaForFiveSecondsNamedByItsTitle() {
        val image = TaleView.read(tale(null, DeliveryMedia("image", "image/png", "https://cdn.test/a.png")), 0)
        assertEquals(LEGACY_TALE_DURATION_MS, image.durationMs)
        assertEquals(StageMedia.Image("https://cdn.test/a.png", MediaFit.Contain, "Beach"), image.media)
        val video = TaleView.read(tale(null, DeliveryMedia("video", "video/mp4", "https://cdn.test/a.mp4"), title = ""), 1)
        assertEquals(StageMedia.Video("https://cdn.test/a.mp4", MediaFit.Contain, "Tale 2"), video.media)
        assertEquals(StageMedia.Placeholder("Beach"), TaleView.read(tale(null), 0).media)
    }

    @Test
    fun theTalesOwnMediaFillsTheStageOverTheCanvasColour() {
        val view = TaleView.read(tale("""{"canvas":{"background":{"type":"color","color":"#112233"}},"elements":[$ownImage]}"""), 0)
        assertEquals(StageMedia.Image("https://cdn.test/a.png", MediaFit.Contain, null), view.media)
        assertEquals("#112233", view.stageColor)
        // The canvas paints no colour of its own over the media.
        assertNull(view.canvas?.color)
    }

    @Test
    fun withoutStageMediaTheCanvasPaintsItsBackground() {
        val moved = ownImage.replace("\"x\":0,", "\"x\":0.1,")
        val view = TaleView.read(
            tale("""{"canvas":{"background":{"type":"media","color":"#000000","url":"https://cdn.test/bg.png","fit":"contain"}},"elements":[$moved]}"""),
            0,
        )
        assertNull(view.media)
        assertNull(view.stageColor)
        assertEquals("#000000", view.canvas?.color)
        assertEquals(StageMedia.Image("https://cdn.test/bg.png", MediaFit.Contain, null), view.canvas?.background)
        assertEquals("Beach", view.canvas?.label)
    }

    @Test
    fun aStageVideoRunsTheTaleNamedByItsAltText() {
        val video = """{"id":"v","type":"video","box":{"x":0,"y":0,"w":1,"h":1,"rotation":0},"a11y":{"label":" Waves "},
            "props":{"url":"https://cdn.test/v.mp4","fit":"cover","taleMedia":true}}"""
        val view = TaleView.read(tale("""{"elements":[$video]}"""), 0)
        assertEquals(StageMedia.Video("https://cdn.test/v.mp4", MediaFit.Cover, "Waves"), view.video)
    }
}
