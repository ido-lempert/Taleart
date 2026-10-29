package site.lempert.taleart.sdk

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue
import site.lempert.taleart.sdk.storage.InMemoryKeyValueStore
import site.lempert.taleart.sdk.storage.KeyValueStore

// The frequency cap's rules and its store (the same semantics as the Web SDK's frequency.ts): a view
// is recorded per group, and each rule caps a group by its views and their times.
class FrequencyTest {
    private val hour = 60 * 60 * 1000L
    private val day = 24 * hour
    private val now = 1_800_000_000_000L

    @Test
    fun aCountIsFromOneToFifty() {
        assertFailsWith<IllegalArgumentException> { FrequencyRule.Count(0) }
        assertFailsWith<IllegalArgumentException> { FrequencyRule.Count(51) }
        assertEquals(1, FrequencyRule.Count(1).views)
        assertEquals(50, FrequencyRule.Count(50).views)
    }

    @Test
    fun aGroupNeverViewedIsNeverCapped() {
        val store = InMemoryKeyValueStore()
        for (rule in listOf(FrequencyRule.Once, FrequencyRule.Daily, FrequencyRule.Weekly, FrequencyRule.Count(1))) {
            assertEquals(emptySet(), cappedGroupIds(store, listOf("a"), rule, now))
        }
    }

    @Test
    fun onceCapsAGroupAfterItsFirstView() {
        val store = InMemoryKeyValueStore()
        recordFrequencyView(store, "a", now)
        assertEquals(setOf("a"), cappedGroupIds(store, listOf("a", "b"), FrequencyRule.Once, now + hour))
    }

    @Test
    fun dailyCapsForTwentyFourHoursAfterAView() {
        val store = InMemoryKeyValueStore()
        recordFrequencyView(store, "a", now)
        assertEquals(setOf("a"), cappedGroupIds(store, listOf("a"), FrequencyRule.Daily, now + 23 * hour))
        assertEquals(emptySet(), cappedGroupIds(store, listOf("a"), FrequencyRule.Daily, now + 25 * hour))
    }

    @Test
    fun weeklyCapsForSevenDaysAfterAView() {
        val store = InMemoryKeyValueStore()
        recordFrequencyView(store, "a", now)
        assertEquals(setOf("a"), cappedGroupIds(store, listOf("a"), FrequencyRule.Weekly, now + 6 * day))
        assertEquals(emptySet(), cappedGroupIds(store, listOf("a"), FrequencyRule.Weekly, now + 8 * day))
    }

    @Test
    fun countCapsOnceTheViewsReachN() {
        val store = InMemoryKeyValueStore()
        recordFrequencyView(store, "a", now)
        recordFrequencyView(store, "a", now + 1)
        assertEquals(emptySet(), cappedGroupIds(store, listOf("a"), FrequencyRule.Count(3), now + 2))
        recordFrequencyView(store, "a", now + 2)
        assertEquals(setOf("a"), cappedGroupIds(store, listOf("a"), FrequencyRule.Count(3), now + 3))
    }

    @Test
    fun aGroupKeepsItsNewest50Views() {
        val store = InMemoryKeyValueStore()
        for (i in 0 until 60) recordFrequencyView(store, "a", now + i)
        val kept = readViews(store)["a"].orEmpty()
        assertEquals(50, kept.size)
        assertEquals(now + 10, kept.first())
        assertEquals(now + 59, kept.last())
    }

    @Test
    fun theStoreKeepsTheNewest500Groups() {
        val store = InMemoryKeyValueStore()
        for (i in 0 until 510) recordFrequencyView(store, "g$i", now)
        val views = readViews(store)
        assertEquals(500, views.size)
        assertTrue("g9" !in views)
        assertTrue("g10" in views)
        assertTrue("g509" in views)
    }

    @Test
    fun theViewsAreStoredUnderTheWebKeyAsJsonLists() {
        val store = InMemoryKeyValueStore()
        recordFrequencyView(store, "a", now)
        assertEquals("""{"a":[$now]}""", store.get(FREQUENCY_STORAGE_KEY))
        assertEquals("taleart.views", FREQUENCY_STORAGE_KEY)
    }

    @Test
    fun aBrokenStoredValueReadsAsNothingViewedAndBrokenEntriesAreDropped() {
        val broken = InMemoryKeyValueStore(mapOf(FREQUENCY_STORAGE_KEY to "not json"))
        assertEquals(emptySet(), cappedGroupIds(broken, listOf("a"), FrequencyRule.Once, now))
        val notAnObject = InMemoryKeyValueStore(mapOf(FREQUENCY_STORAGE_KEY to "[1,2]"))
        assertEquals(emptySet(), cappedGroupIds(notAnObject, listOf("a"), FrequencyRule.Once, now))
        val mixed = InMemoryKeyValueStore(mapOf(FREQUENCY_STORAGE_KEY to """{"a":"x","b":[$now,"y"]}"""))
        assertEquals(setOf("b"), cappedGroupIds(mixed, listOf("a", "b"), FrequencyRule.Once, now))
    }

    @Test
    fun noStoreCountsNothingAndCapsNothing() {
        recordFrequencyView(null, "a", now)
        assertEquals(emptySet(), cappedGroupIds(null, listOf("a"), FrequencyRule.Once, now))
    }

    @Test
    fun aStoreThatRefusesTheWriteCountsNothingAndDoesNotThrow() {
        val refusing = object : KeyValueStore {
            override fun get(key: String): String? = null
            override fun set(key: String, value: String) = throw IllegalStateException("full")
        }
        recordFrequencyView(refusing, "a", now)
        assertEquals(emptySet(), cappedGroupIds(refusing, listOf("a"), FrequencyRule.Once, now))
    }
}
