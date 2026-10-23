package site.lempert.taleart.sdk.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import site.lempert.taleart.sdk.storage.KeyValueStore
import site.lempert.taleart.sdk.storage.rememberDeviceKeyValueStore

/** The store key of the viewed tale group ids, as `SEEN_STORAGE_KEY` in the Web SDK. */
const val SEEN_STORAGE_KEY = "taleart.seen"

/** The most group ids remembered; the oldest go first (`SEEN_LIMIT` in the Web SDK). */
const val SEEN_LIMIT = 500

/**
 * The tale groups this device has viewed, as libs/web-sdk/src/lib/seen.ts keeps them: a JSON list of
 * ids in [store], newest last, capped at [SEEN_LIMIT], kept only on the device and never sent to
 * TaleArt (AD-13). A missing or broken value reads as nothing seen.
 *
 * As in the Web SDK a group becomes seen when the viewer shows it (`onGroupShown` in
 * taleart-element.ts), never on a tap: the viewer (story 9.4) calls [markSeen]. [ids] is Compose
 * state, so every bar sharing this holder redraws its rings. The store is read once, off the main
 * thread ([dispatcher]), and written there too; until the read finishes [ids] holds only the groups
 * marked since.
 */
class SeenGroups(
    private val store: KeyValueStore,
    dispatcher: kotlinx.coroutines.CoroutineDispatcher = Dispatchers.Default,
) {
    private val scope = CoroutineScope(SupervisorJob() + dispatcher)
    // Orders the read and the writes, so a write never loses an id another write or the read added.
    private val lock = Mutex()
    private val loading: Job

    /** The ids of the groups viewed on this device. */
    var ids: Set<String> by mutableStateOf(emptySet())
        private set

    init {
        loading = scope.launch {
            lock.withLock {
                val stored = readIds(store)
                ids = stored.toSet() + ids
            }
        }
    }

    /** True once the stored ids have been read. */
    val isLoaded: Boolean get() = loading.isCompleted

    /** Waits until the stored ids have been read. */
    suspend fun awaitLoaded() = loading.join()

    /** Remembers that the tale group [id] was viewed: [ids] changes at once, the store just after. */
    fun markSeen(id: String) {
        ids = ids + id
        scope.launch {
            lock.withLock {
                val list = readIds(store).filter { it != id } + id
                try {
                    store.set(SEEN_STORAGE_KEY, JsonArray(list.takeLast(SEEN_LIMIT).map(::JsonPrimitive)).toString())
                } catch (_: Exception) {
                    // Storage that refuses the write: the group just shows unseen next time.
                }
            }
        }
    }

    companion object {
        /** The ids stored in [store], oldest first; nothing when the value is missing or broken. */
        fun readIds(store: KeyValueStore): List<String> = try {
            val value = store.get(SEEN_STORAGE_KEY)
            if (value == null) emptyList()
            else (Json.parseToJsonElement(value) as? JsonArray)
                ?.mapNotNull { (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content }
                .orEmpty()
        } catch (_: Exception) {
            emptyList()
        }
    }
}

// One holder per store for the whole process, so every bar on the device store shares its rings.
private val sharedSeenGroups = mutableMapOf<KeyValueStore, SeenGroups>()

/** The [SeenGroups] of [store], shared by every caller with the same store in this process. */
fun seenGroupsFor(store: KeyValueStore): SeenGroups = sharedSeenGroups.getOrPut(store) { SeenGroups(store) }

/** The device's seen groups (in the SDK's own store, see [rememberDeviceKeyValueStore]), shared by every bar. */
@Composable
fun rememberSeenGroups(): SeenGroups {
    val store = rememberDeviceKeyValueStore()
    return remember(store) { seenGroupsFor(store) }
}
