package site.lempert.taleart.taller

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import site.lempert.taleart.sdk.FallbackMode
import site.lempert.taleart.sdk.FrequencyRule
import site.lempert.taleart.sdk.delivery.DeliveryFrame
import site.lempert.taleart.sdk.delivery.DeliveryTale
import site.lempert.taleart.sdk.delivery.DeliveryTaleGroup
import site.lempert.taleart.sdk.delivery.DeliveryZone
import site.lempert.taleart.sdk.ui.BannerVariant
import site.lempert.taleart.sdk.ui.BarLayout
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertSame
import kotlin.test.assertTrue

class TallerDebugOptionsTest {
    @Test
    fun readsTheDebugKeysFromTheStore() {
        val store = InMemoryStore(
            mapOf(
                TallerDebugOptions.AUTO_OPEN_GROUP to "2",
                TallerDebugOptions.AUTO_OPEN_TALE to "1",
                TallerDebugOptions.FALLBACK to "message",
                TallerDebugOptions.FREQUENCY to "once",
            ),
        )
        assertEquals(
            TallerDebugOptions(autoOpenGroup = 2, autoOpenTale = 1, fallback = FallbackMode.Message, frequency = FrequencyRule.Once),
            TallerDebugOptions.load(store),
        )
    }

    @Test
    fun keepsTheSdkDefaultsWhenNothingIsSet() {
        assertEquals(TallerDebugOptions(), TallerDebugOptions.load(InMemoryStore()))
    }

    @Test
    fun launchExtrasWinOverTheStore() {
        val store = InMemoryStore(mapOf(TallerDebugOptions.FREQUENCY to "once"))
        val debug = TallerDebugOptions.load(store, mapOf(TallerDebugOptions.FREQUENCY to "3", TallerDebugOptions.AUTO_OPEN_GROUP to "0"))
        assertEquals(FrequencyRule.Count(3), debug.frequency)
        assertEquals(0, debug.autoOpenGroup)
    }

    @Test
    fun readsTheLocaleAndTheLayoutDirection() {
        val store = InMemoryStore(mapOf(TallerDebugOptions.LOCALE to "he-IL", TallerDebugOptions.LAYOUT_DIRECTION to "RTL"))
        val debug = TallerDebugOptions.load(store)
        assertEquals("he-IL", debug.locale)
        assertEquals("rtl", debug.layoutDirection)
        assertEquals(TallerDebugOptions(), TallerDebugOptions.load(InMemoryStore()))
    }

    @Test
    fun frequencyNamesMapToRules() {
        assertEquals(FrequencyRule.Daily, frequencyRule("daily"))
        assertEquals(FrequencyRule.Weekly, frequencyRule(" Weekly "))
        assertEquals(FrequencyRule.Count(50), frequencyRule("50"))
        assertNull(frequencyRule("none"))
        assertNull(frequencyRule("51"))
        assertNull(frequencyRule("sometimes"))
    }

    @Test
    fun readsTheBarLayoutAndIgnoresAnUnknownOne() {
        assertEquals(BarLayout.Chip, TallerDebugOptions.load(InMemoryStore(mapOf(TallerDebugOptions.BAR_LAYOUT to " Chip "))).barLayout)
        assertEquals(BarLayout.Stack, TallerDebugOptions.load(InMemoryStore(), mapOf(TallerDebugOptions.BAR_LAYOUT to "stack")).barLayout)
        assertNull(TallerDebugOptions.load(InMemoryStore(mapOf(TallerDebugOptions.BAR_LAYOUT to "tile"))).barLayout)
        assertNull(TallerDebugOptions.load(InMemoryStore()).barLayout)
    }

    @Test
    fun aZoneCanBeDrawnInAnotherBarLayout() {
        val bar = DeliveryZone(
            id = "z",
            frame = DeliveryFrame(id = "f", type = "bar", settings = JsonObject(mapOf("layout" to JsonPrimitive("ring"), "gap" to JsonPrimitive(8)))),
        )
        val poster = bar.withBarLayout(BarLayout.Poster)
        assertEquals(
            JsonObject(mapOf("layout" to JsonPrimitive("poster"), "gap" to JsonPrimitive(8))),
            poster.frame?.settings,
        )
        assertEquals(bar.taleGroups, poster.taleGroups)
    }

    @Test
    fun aZoneWithoutABarIsDrawnAsItIs() {
        val none = DeliveryZone(id = "z")
        assertSame(none, none.withBarLayout(BarLayout.Chip))
        val banner = DeliveryZone(id = "z", frame = DeliveryFrame(id = "f", type = "banner", settings = null))
        assertSame(banner, banner.withBarLayout(BarLayout.Chip))
    }

    @Test
    fun readsTheBannerVariantAndIgnoresAnUnknownOne() {
        assertEquals(BannerVariant.Coverflow, TallerDebugOptions.load(InMemoryStore(mapOf(TallerDebugOptions.BANNER_VARIANT to " Coverflow "))).bannerVariant)
        assertEquals(BannerVariant.Strip, TallerDebugOptions.load(InMemoryStore(), mapOf(TallerDebugOptions.BANNER_VARIANT to "strip")).bannerVariant)
        assertNull(TallerDebugOptions.load(InMemoryStore(mapOf(TallerDebugOptions.BANNER_VARIANT to "ticker"))).bannerVariant)
        assertNull(TallerDebugOptions.load(InMemoryStore()).bannerVariant)
    }

    @Test
    fun aBannerIsDrawnInAnotherVariantWithItsOtherSettingsKept() {
        val banner = DeliveryZone(
            id = "z",
            frame = DeliveryFrame(id = "f", type = "banner", settings = JsonObject(mapOf("aspectRatio" to JsonPrimitive("1:1"), "loop" to JsonPrimitive(false)))),
        )
        val peek = banner.withBannerVariant(BannerVariant.Peek)
        assertEquals(
            JsonObject(mapOf("aspectRatio" to JsonPrimitive("1:1"), "loop" to JsonPrimitive(false), "variant" to JsonPrimitive("peek"))),
            peek.frame?.settings,
        )
        assertEquals(banner.taleGroups, peek.taleGroups)
    }

    @Test
    fun aZoneWithoutABannerIsNotChangedByTheVariant() {
        val bar = DeliveryZone(id = "z", frame = DeliveryFrame(id = "f", type = "bar", settings = null))
        assertSame(bar, bar.withBannerVariant(BannerVariant.Deck))
        val none = DeliveryZone(id = "z")
        assertSame(none, none.withBannerVariant(BannerVariant.Deck))
    }

    @Test
    fun theDebugOptionsDrawABarOrABannerOrNeither() {
        val options = TallerDebugOptions(barLayout = BarLayout.Chip, bannerVariant = BannerVariant.Sticky)
        val bar = DeliveryZone(id = "z", frame = DeliveryFrame(id = "f", type = "bar", settings = null))
        val banner = DeliveryZone(id = "z", frame = DeliveryFrame(id = "f", type = "banner", settings = null))
        assertEquals(JsonObject(mapOf("layout" to JsonPrimitive("chip"))), options.drawn(bar).frame?.settings)
        assertEquals(JsonObject(mapOf("variant" to JsonPrimitive("sticky"))), options.drawn(banner).frame?.settings)
        assertSame(banner, TallerDebugOptions().drawn(banner))
    }

    @Test
    fun readsThePollViewAndIgnoresAnUnknownOne() {
        assertEquals("this-or-that", TallerDebugOptions.load(InMemoryStore(mapOf(TallerDebugOptions.POLL_VIEW to " This-Or-That "))).pollView)
        assertEquals("grid", TallerDebugOptions.load(InMemoryStore(), mapOf(TallerDebugOptions.POLL_VIEW to "grid")).pollView)
        assertNull(TallerDebugOptions.load(InMemoryStore(mapOf(TallerDebugOptions.POLL_VIEW to "carousel"))).pollView)
        assertNull(TallerDebugOptions.load(InMemoryStore()).pollView)
        assertEquals(listOf("sticker", "embed", "this-or-that", "grid", "inline"), POLL_VIEWS)
        assertEquals("sticker", pollViewNamed("sticker"))
    }

    @Test
    fun aZoneWithAPollIsDrawnInTheDebugViewWithItsOtherPropsKept() {
        val poll = JsonObject(
            mapOf(
                "id" to JsonPrimitive("poll-1"),
                "type" to JsonPrimitive("poll"),
                "props" to JsonObject(mapOf("question" to JsonPrimitive("Q?"), "theme" to JsonPrimitive("dark"))),
            ),
        )
        val text = JsonObject(mapOf("id" to JsonPrimitive("t"), "type" to JsonPrimitive("text"), "props" to JsonObject(mapOf("text" to JsonPrimitive("Hi")))))
        val document = JsonObject(mapOf("version" to JsonPrimitive(1), "elements" to JsonArray(listOf(text, poll))))
        val zone = DeliveryZone(
            id = "z",
            taleGroups = listOf(DeliveryTaleGroup(id = "g", tales = listOf(DeliveryTale(id = "t", document = document)))),
        )
        val drawn = zone.withPollView("embed")
        val elements = (drawn.taleGroups.single().tales.single().document as JsonObject)["elements"] as JsonArray
        assertEquals(text, elements[0])
        val props = (elements[1] as JsonObject)["props"] as JsonObject
        assertEquals(
            JsonObject(mapOf("question" to JsonPrimitive("Q?"), "theme" to JsonPrimitive("dark"), "view" to JsonPrimitive("embed"))),
            props,
        )
        assertEquals(zone.taleGroups.single().tales.single().id, drawn.taleGroups.single().tales.single().id)
        assertEquals(DeliveryZone(id = "z"), DeliveryZone(id = "z").withPollView("grid"))
        assertEquals(drawn, TallerDebugOptions(pollView = "embed").drawn(zone))
        assertSame(zone, TallerDebugOptions().drawn(zone))
        assertTrue(TallerDebugOptions(pollView = "grid").redrawsZone)
        assertFalse(TallerDebugOptions().redrawsZone)
    }

    @Test
    fun theHebrewBarTextsHaveEveryBarKey() {
        assertEquals(
            setOf("bar.loading", "bar.story", "bar.stories", "bar.newStory", "bar.newStories"),
            TallerStrings.bar.getValue("he").keys,
        )
    }

    @Test
    fun readsTheZoneOnlyPageAndTheTimedActions() {
        val store = InMemoryStore(
            mapOf(
                TallerDebugOptions.ZONE_ONLY to "True",
                TallerDebugOptions.AUTO_OPEN_ITEM to "2",
                TallerDebugOptions.AUTO_VOTE to "1",
                TallerDebugOptions.AUTO_PRESS to "0",
                TallerDebugOptions.AUTO_COPY to "true",
                TallerDebugOptions.AUTO_SWIPE_NEXT to "true",
                TallerDebugOptions.AUTO_DELAY_MS to "1200",
            ),
        )
        val debug = TallerDebugOptions.load(store)
        assertTrue(debug.zoneOnly)
        assertEquals(1200L, debug.autoDelayMs)
        assertEquals(
            listOf(
                DebugAction(DebugActionKind.OpenItem, 2),
                DebugAction(DebugActionKind.Vote, 1),
                DebugAction(DebugActionKind.Press, 0),
                DebugAction(DebugActionKind.Copy),
                DebugAction(DebugActionKind.SwipeNext),
            ),
            debug.actions,
        )
    }

    @Test
    fun theTimedActionsAreOffByDefaultAndWaitSevenHundredMilliseconds() {
        val debug = TallerDebugOptions.load(InMemoryStore())
        assertFalse(debug.zoneOnly)
        assertEquals(emptyList(), debug.actions)
        assertEquals(700L, debug.autoDelayMs)
    }

    @Test
    fun launchExtrasWinForTheTimedActionsAndBadValuesAreIgnored() {
        val store = InMemoryStore(mapOf(TallerDebugOptions.AUTO_VOTE to "0", TallerDebugOptions.AUTO_COPY to "yes"))
        val debug = TallerDebugOptions.load(
            store,
            mapOf(TallerDebugOptions.AUTO_VOTE to "1", TallerDebugOptions.AUTO_PRESS to "-1", TallerDebugOptions.AUTO_DELAY_MS to "fast", TallerDebugOptions.ZONE_ONLY to "false"),
        )
        assertEquals(1, debug.autoVote)
        assertNull(debug.autoPress)
        assertFalse(debug.autoCopy)
        assertFalse(debug.zoneOnly)
        assertEquals(700L, debug.autoDelayMs)
        assertEquals(60_000L, TallerDebugOptions.load(InMemoryStore(mapOf(TallerDebugOptions.AUTO_DELAY_MS to "999999"))).autoDelayMs)
    }
}
