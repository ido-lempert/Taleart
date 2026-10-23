package site.lempert.taleart.sdk.ui

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import site.lempert.taleart.sdk.delivery.HOME_TOP_ZONE_JSON
import site.lempert.taleart.sdk.delivery.readZone
import site.lempert.taleart.sdk.storage.InMemoryKeyValueStore
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

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
    fun seenGroupsAreKeptNewestLastAndCapped() = runTest {
        val store = InMemoryKeyValueStore()
        val seen = SeenGroups(store, StandardTestDispatcher(testScheduler))
        seen.awaitLoaded()
        assertEquals(emptySet(), seen.ids)
        seen.markSeen("a")
        seen.markSeen("b")
        seen.markSeen("a")
        // The rings change at once; the store just after.
        assertEquals(setOf("a", "b"), seen.ids)
        advanceUntilIdle()
        assertEquals("[\"b\",\"a\"]", store.get(SEEN_STORAGE_KEY))
        repeat(SEEN_LIMIT + 5) { seen.markSeen("g$it") }
        advanceUntilIdle()
        assertEquals(SEEN_LIMIT, SeenGroups.readIds(store).size)
        assertEquals(false, "a" in SeenGroups.readIds(store))
    }

    @Test
    fun theStoredIdsAreReadOffTheCallersThreadAndKeepWhatWasMarkedMeanwhile() = runTest {
        val store = InMemoryKeyValueStore(mapOf(SEEN_STORAGE_KEY to "[\"old\"]"))
        val seen = SeenGroups(store, StandardTestDispatcher(testScheduler))
        assertFalse(seen.isLoaded)
        assertEquals(emptySet(), seen.ids)
        seen.markSeen("new")
        advanceUntilIdle()
        assertTrue(seen.isLoaded)
        assertEquals(setOf("old", "new"), seen.ids)
        assertEquals("[\"old\",\"new\"]", store.get(SEEN_STORAGE_KEY))
    }

    @Test
    fun brokenSeenStorageReadsAsNothingSeen() {
        assertEquals(emptyList(), SeenGroups.readIds(InMemoryKeyValueStore(mapOf(SEEN_STORAGE_KEY to "{nope"))))
        assertEquals(listOf("x"), SeenGroups.readIds(InMemoryKeyValueStore(mapOf(SEEN_STORAGE_KEY to "[1,\"x\",null]"))))
    }

    @Test
    fun aVideoCoverGivesWayToTheNextImageCandidate() {
        val zone = readZone(
            json(
                """{"frame":null,"taleGroups":[
                {"id":"a","name":"A","cover":{"kind":"video","url":"https://cdn.test/c.mp4"},
                 "tales":[{"id":"t","document":{"elements":[
                   {"type":"video","props":{"url":"https://cdn.test/t.mp4"}},
                   {"type":"sticker","box":{"x":0,"y":0,"w":0.5,"h":0.5,"rotation":0},"props":{"url":"https://cdn.test/s.png"}}]}}]},
                {"id":"b","name":"B","tales":[
                  {"id":"t1","media":{"kind":"video","url":"https://cdn.test/v.mp4"}},
                  {"id":"t2","media":{"kind":"image","url":"https://cdn.test/i.png"}}]},
                {"id":"c","name":"C","cover":{"kind":"video","url":"https://cdn.test/c.mp4"},
                 "tales":[{"id":"t","document":{"canvas":{"background":{"type":"color","color":"#abcdef"}},
                   "elements":[{"type":"video","props":{"url":"https://cdn.test/t.mp4"}}]}}]}]}""",
            ) as JsonObject,
        )
        assertEquals(CoverSource.Image("https://cdn.test/s.png"), coverSource(zone.taleGroups[0]))
        assertEquals(CoverSource.Image("https://cdn.test/i.png"), coverSource(zone.taleGroups[1]))
        assertEquals(CoverSource.Placeholder("#abcdef"), coverSource(zone.taleGroups[2]))
    }

    @Test
    fun aGroupsCoverIsItsOwnElseItsFirstTalesMediaElseItsCanvasColour() {
        val zone = readZone(Json.parseToJsonElement(HOME_TOP_ZONE_JSON) as JsonObject)
        assertEquals(
            CoverSource.Image("http://localhost:3592/media/tales/3b00e2b1-fa35-4657-9849-a78f9f7cf9c3.png"),
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
        assertEquals(CoverSource.Image("https://cdn.test/c.png"), coverSource(withCover.taleGroups[0]))
        assertEquals(CoverSource.Placeholder("#123456"), coverSource(withCover.taleGroups[1]))
        assertEquals(CoverSource.Image("https://cdn.test/bg.png"), coverSource(withCover.taleGroups[2]))
        assertEquals(CoverSource.Placeholder(null), coverSource(withCover.taleGroups[3]))
    }

    @Test
    fun anItemIsNamedByItsTitleAndSaysWhenItIsSeen() {
        assertEquals("Summer trips", barItemLabel("Summer trips", false))
        assertEquals("Summer trips, seen", barItemLabel("Summer trips", true))
    }
}
