package site.lempert.taleart.sdk.ui

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import site.lempert.taleart.sdk.delivery.DeliveryCover
import site.lempert.taleart.sdk.delivery.DeliveryMedia
import site.lempert.taleart.sdk.delivery.DeliveryTale
import site.lempert.taleart.sdk.delivery.DeliveryTaleGroup
import kotlin.test.Test
import kotlin.test.assertEquals

// The banner's settings and slide pictures, read as the Web SDK reads them (libs/web-sdk/src/lib/banner.spec.ts).
class BannerReadersTest {
    private fun json(text: String) = Json.parseToJsonElement(text)

    @Test
    fun bannerSettingsTakeTheSchemaDefaults() {
        val defaults = BannerSettings(BannerAspectRatio.Wide, autoplay = true, intervalSeconds = 5, showDots = true, loop = true)
        assertEquals(defaults, BannerSettings.read(null))
        assertEquals(defaults, BannerSettings.read(json("{}")))
        assertEquals(defaults, BannerSettings.read(json("[]")))
        assertEquals(defaults, BannerSettings.read(json("\"16:9\"")))
    }

    @Test
    fun bannerSettingsKeepEachValidField() {
        assertEquals(
            BannerSettings(BannerAspectRatio.Strip, autoplay = false, intervalSeconds = 15, showDots = false, loop = false),
            BannerSettings.read(json("""{"aspectRatio":"3:1","autoplay":false,"intervalSeconds":15,"showDots":false,"loop":false}""")),
        )
        assertEquals(BannerAspectRatio.Square, BannerSettings.read(json("""{"aspectRatio":"1:1"}""")).aspectRatio)
        assertEquals(3, BannerSettings.read(json("""{"intervalSeconds":3}""")).intervalSeconds)
        // An integral number is an integer, as JavaScript's Number.isInteger says.
        assertEquals(7, BannerSettings.read(json("""{"intervalSeconds":7.0}""")).intervalSeconds)
    }

    @Test
    fun bannerSettingsDropEachInvalidField() {
        assertEquals(
            BannerSettings(),
            BannerSettings.read(json("""{"aspectRatio":"4:3","autoplay":"yes","intervalSeconds":2,"showDots":1,"loop":null}""")),
        )
        assertEquals(5, BannerSettings.read(json("""{"intervalSeconds":16}""")).intervalSeconds)
        assertEquals(5, BannerSettings.read(json("""{"intervalSeconds":4.5}""")).intervalSeconds)
        assertEquals(5, BannerSettings.read(json("""{"intervalSeconds":"6"}""")).intervalSeconds)
        assertEquals(true, BannerSettings.read(json("""{"autoplay":"false"}""")).autoplay)
        assertEquals(BannerAspectRatio.Wide, BannerSettings.read(json("""{"aspectRatio":16}""")).aspectRatio)
        // Unknown keys are ignored.
        assertEquals(BannerSettings(), BannerSettings.read(json("""{"shape":"circle","speed":9}""")))
    }

    @Test
    fun theAspectRatiosAreTheSchemas() {
        assertEquals(listOf("16:9", "3:1", "1:1"), BannerAspectRatio.entries.map { it.key })
        assertEquals(listOf(16f / 9f, 3f, 1f), BannerAspectRatio.entries.map { it.widthOverHeight })
    }

    @Test
    fun aSlideShowsTheGroupsDefaultCoverNotItsOwnCover() {
        val tale = DeliveryTale(
            id = "t",
            document = json(
                """{"canvas":{"background":{"type":"media","url":"https://cdn.test/bg.png"}},"elements":[]}""",
            ) as JsonObject,
        )
        val group = DeliveryTaleGroup(
            id = "g",
            name = "G",
            cover = DeliveryCover(kind = "image", contentType = "image/png", url = "https://cdn.test/cover.png"),
            tales = listOf(tale),
        )
        // The bar shows the group's cover; the banner, like the Web SDK's `coverMedia`, its default cover.
        assertEquals(CoverSource.Image("https://cdn.test/cover.png"), coverSource(group))
        assertEquals(CoverSource.Image("https://cdn.test/bg.png"), defaultCoverSource(group))
        val bare = DeliveryTaleGroup(id = "b", name = "B", tales = listOf(DeliveryTale(id = "t", media = DeliveryMedia("image", "image/png", "https://cdn.test/m.png"))))
        assertEquals(CoverSource.Image("https://cdn.test/m.png"), defaultCoverSource(bare))
        assertEquals(CoverSource.Placeholder(null), defaultCoverSource(DeliveryTaleGroup(id = "e", name = "E")))
    }

    @Test
    fun theLabelsAreTheWebSdks() {
        assertEquals("1 of 3", bannerSlideLabel(0, 3))
        assertEquals("Show Summer trips", bannerDotLabel("Summer trips"))
        assertEquals("Stop automatic slide show", bannerRotationLabel(true))
        assertEquals("Start automatic slide show", bannerRotationLabel(false))
    }
}
