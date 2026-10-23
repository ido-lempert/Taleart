package site.lempert.taleart.sdk.ui

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import site.lempert.taleart.sdk.delivery.HOME_TOP_ZONE_JSON
import site.lempert.taleart.sdk.delivery.readZone
import site.lempert.taleart.sdk.storage.InMemoryKeyValueStore
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

// The bar's settings, the theme, the seen groups and the covers, read as the Web SDK reads them
// (libs/web-sdk/src/lib/bar.spec.ts, theme.spec.ts, seen.spec.ts).
class BarReadersTest {
    private fun json(text: String) = Json.parseToJsonElement(text)

    @Test
    fun barSettingsTakeTheSchemaDefaults() {
        assertEquals(BarSettings(BarShape.Circle, BarSize.Medium, true, BarAlignment.Start, 12), BarSettings.read(null))
        assertEquals(BarSettings(), BarSettings.read(json("[]")))
    }

    @Test
    fun barSettingsKeepEachValidFieldAndDropEachInvalidOne() {
        assertEquals(
            BarSettings(BarShape.RoundedSquare, BarSize.Large, false, BarAlignment.Center, 24),
            BarSettings.read(json("""{"shape":"rounded-square","size":"large","showTitles":false,"alignment":"center","gap":24}""")),
        )
        assertEquals(
            BarSettings(),
            BarSettings.read(json("""{"shape":"oval","size":"huge","showTitles":"no","alignment":"end","gap":25}""")),
        )
        assertEquals(12, BarSettings.read(json("""{"gap":3}""")).gap)
        assertEquals(12, BarSettings.read(json("""{"gap":4.5}""")).gap)
        assertEquals(4, BarSettings.read(json("""{"gap":4}""")).gap)
        assertEquals(listOf(48, 64, 80), BarSize.entries.map { it.edgeDp })
    }

    @Test
    fun theThemeTakesTaleArtsDefaults() {
        assertEquals(TaleartTheme.DEFAULT, TaleartTheme.read(null))
        assertEquals(TaleartTheme.DEFAULT, TaleartTheme.read(json("\"red\"")))
        val fixture = readZone(Json.parseToJsonElement(HOME_TOP_ZONE_JSON) as JsonObject)
        assertEquals(TaleartTheme.DEFAULT, TaleartTheme.read(fixture.theme))
    }

    @Test
    fun theThemeKeepsEachFieldThatPassesItsRule() {
        val theme = TaleartTheme.read(
            json(
                """{"ringStyle":"solid","ringColors":["#112233"],"seenRingColor":"#445566","ringWidth":4,
                "cornerRadius":8,"fontFamily":"Georgia, serif","titleColor":"#778899","backgroundColor":"#000000",
                "accentColor":"#abcdef"}""",
            ),
        )
        assertEquals(
            TaleartTheme(RingStyle.Solid, listOf("#112233"), "#445566", 4, 8, "Georgia, serif", "#778899", "#000000", "#abcdef"),
            theme,
        )
    }

    @Test
    fun theThemeDropsEachFieldThatFailsItsRule() {
        val theme = TaleartTheme.read(
            json(
                """{"ringStyle":"dotted","ringColors":["#112233","red"],"seenRingColor":"#fff","ringWidth":5,
                "cornerRadius":33,"fontFamily":"inherit","titleColor":"blue","backgroundColor":"none","accentColor":1}""",
            ),
        )
        assertEquals(TaleartTheme.DEFAULT, theme)
        assertEquals(TaleartTheme.DEFAULT, TaleartTheme.read(json("""{"ringColors":[],"fontFamily":"taleart-font-1"}""")))
        assertEquals(TaleartTheme.DEFAULT, TaleartTheme.read(json("""{"ringColors":["#111111","#222222","#333333","#444444"]}""")))
        assertEquals(TaleartTheme.DEFAULT, TaleartTheme.read(json("""{"fontFamily":"a; color: red"}""")))
    }

    @Test
    fun coloursAndFontsMapToCompose() {
        assertEquals(Color(0xFFEA580C), parseHexColor("#ea580c"))
        assertEquals(Color(0x80112233), parseHexColor("#11223380"))
        assertNull(parseHexColor("transparent"))
        assertEquals(FontFamily.Serif, fontFamilyOf("Georgia, serif"))
        assertEquals(FontFamily.Monospace, fontFamilyOf("\"Fira Code\", monospace"))
        assertNull(fontFamilyOf("Inter"))
        assertNull(fontFamilyOf(null))
    }

    @Test
    fun seenGroupsAreKeptNewestLastAndCapped() {
        val store = InMemoryKeyValueStore()
        val seen = SeenGroups(store)
        assertEquals(emptySet(), seen.ids())
        seen.markSeen("a")
        seen.markSeen("b")
        seen.markSeen("a")
        assertEquals("[\"b\",\"a\"]", store.get(SEEN_STORAGE_KEY))
        repeat(SEEN_LIMIT + 5) { seen.markSeen("g$it") }
        assertEquals(SEEN_LIMIT, seen.ids().size)
        assertEquals(false, "a" in seen.ids())
    }

    @Test
    fun brokenSeenStorageReadsAsNothingSeen() {
        assertEquals(emptySet(), SeenGroups(InMemoryKeyValueStore(mapOf(SEEN_STORAGE_KEY to "{nope"))).ids())
        assertEquals(setOf("x"), SeenGroups(InMemoryKeyValueStore(mapOf(SEEN_STORAGE_KEY to "[1,\"x\",null]"))).ids())
    }

    @Test
    fun aGroupsCoverIsItsOwnElseItsFirstTalesMediaElseItsCanvasColour() {
        val zone = readZone(Json.parseToJsonElement(HOME_TOP_ZONE_JSON) as JsonObject)
        assertEquals(
            CoverSource.Media("image", "http://localhost:3592/media/tales/3b00e2b1-fa35-4657-9849-a78f9f7cf9c3.png"),
            coverSource(zone.taleGroups[0]),
        )
        val withCover = readZone(
            json(
                """{"frame":null,"taleGroups":[{"id":"g","name":"G","cover":{"kind":"image","url":"https://cdn.test/c.png"},"tales":[]},
                {"id":"h","name":"H","tales":[{"id":"t","document":{"canvas":{"background":{"type":"color","color":"#123456"}},"elements":[]}}]},
                {"id":"i","name":"I","tales":[{"id":"t","document":{"canvas":{"background":{"type":"media","url":"https://cdn.test/bg.png"}},"elements":[]}}]},
                {"id":"j","name":"J","cover":{"kind":"image","url":"javascript:alert(1)"},"tales":[]}]}""",
            ) as JsonObject,
        )
        assertEquals(CoverSource.Media("image", "https://cdn.test/c.png"), coverSource(withCover.taleGroups[0]))
        assertEquals(CoverSource.Placeholder("#123456"), coverSource(withCover.taleGroups[1]))
        assertEquals(CoverSource.Media("image", "https://cdn.test/bg.png"), coverSource(withCover.taleGroups[2]))
        assertEquals(CoverSource.Placeholder(null), coverSource(withCover.taleGroups[3]))
    }

    @Test
    fun anItemIsNamedByItsTitleAndSaysWhenItIsSeen() {
        assertEquals("Summer trips", barItemLabel("Summer trips", false))
        assertEquals("Summer trips, seen", barItemLabel("Summer trips", true))
    }
}
