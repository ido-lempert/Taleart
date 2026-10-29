package site.lempert.taleart.sdk

import kotlin.time.Clock
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.longOrNull
import site.lempert.taleart.sdk.storage.KeyValueStore

/**
 * How often a viewer may see a tale group (`frequency` in the Web SDK), counted on this device only:
 * a view is one opening of the viewer on the group. Groups over the cap leave the display; the
 * counts never leave the device.
 */
sealed interface FrequencyRule {
    /** Hide a group after its first view. */
    data object Once : FrequencyRule

    /** At most one view per 24 hours. */
    data object Daily : FrequencyRule

    /** At most one view per 7 days. */
    data object Weekly : FrequencyRule

    /** Hide a group after [views] views over its lifetime; [views] is from 1 to [VIEWS_PER_GROUP]. */
    data class Count(val views: Int) : FrequencyRule {
        init {
            require(views in 1..VIEWS_PER_GROUP) { "TaleartConfig.frequency Count must be from 1 to $VIEWS_PER_GROUP, not $views" }
        }
    }
}

/** The store key of the views per tale group, as `VIEWS_STORAGE_KEY` in the Web SDK. */
internal const val FREQUENCY_STORAGE_KEY = "taleart.views"

/** The most views remembered per group, newest kept. */
internal const val VIEWS_PER_GROUP = 50

/** The most groups remembered; the oldest go first. */
internal const val VIEWED_GROUPS_LIMIT = 500

private const val DAY_MS = 24L * 60 * 60 * 1000
private const val WEEK_MS = 7 * DAY_MS

/** The current time in epoch milliseconds, the clock the frequency cap reads. */
internal fun nowMillis(): Long = Clock.System.now().toEpochMilliseconds()

/**
 * The views of each group, in the device's store: a JSON object of group id to epoch-millisecond
 * lists, newest last, as the Web SDK keeps them. A missing or broken value reads as nothing viewed,
 * and broken entries are dropped.
 */
internal fun readViews(store: KeyValueStore?): LinkedHashMap<String, List<Long>> {
    val views = LinkedHashMap<String, List<Long>>()
    if (store == null) return views
    try {
        val value = store.get(FREQUENCY_STORAGE_KEY) ?: return views
        val root = Json.parseToJsonElement(value) as? JsonObject ?: return views
        for ((id, list) in root) {
            val times = (list as? JsonArray)?.mapNotNull { element ->
                (element as? JsonPrimitive)?.takeIf { !it.isString }?.longOrNull
            } ?: continue
            views[id] = times
        }
    } catch (_: Exception) {
        return LinkedHashMap()
    }
    return views
}

/**
 * Counts a view of the group [groupId] at [nowMs] (the viewer opened on it). Each group keeps its
 * newest [VIEWS_PER_GROUP] views and the store its newest [VIEWED_GROUPS_LIMIT] groups. A store that
 * refuses the write counts nothing.
 */
internal fun recordFrequencyView(store: KeyValueStore?, groupId: String, nowMs: Long = nowMillis()) {
    if (store == null) return
    val views = readViews(store)
    // Removed and put back, so the group is the newest key and the oldest keys go first.
    val list = ((views.remove(groupId) ?: emptyList()) + nowMs).takeLast(VIEWS_PER_GROUP)
    views[groupId] = list
    while (views.size > VIEWED_GROUPS_LIMIT) views.remove(views.keys.first())
    val json = JsonObject(views.mapValues { (_, times) -> JsonArray(times.map { JsonPrimitive(it) }) })
    try {
        store.set(FREQUENCY_STORAGE_KEY, json.toString())
    } catch (_: Exception) {
        // A store that refuses the write: the view is not counted.
    }
}

/**
 * The ids, of those given, whose views have reached [rule] at [nowMs]: `Once` after one view,
 * `Daily` within 24 hours of the last view, `Weekly` within 7 days of it, and `Count` after N views.
 */
internal fun cappedGroupIds(store: KeyValueStore?, groupIds: Collection<String>, rule: FrequencyRule, nowMs: Long = nowMillis()): Set<String> {
    val views = readViews(store)
    return groupIds.filterTo(LinkedHashSet()) { id ->
        val list = views[id].orEmpty()
        list.isNotEmpty() && reached(list, rule, nowMs)
    }
}

private fun reached(list: List<Long>, rule: FrequencyRule, now: Long): Boolean {
    val last = list.max()
    return when (rule) {
        FrequencyRule.Once -> true
        FrequencyRule.Daily -> now - last < DAY_MS
        FrequencyRule.Weekly -> now - last < WEEK_MS
        is FrequencyRule.Count -> list.size >= rule.views
    }
}
