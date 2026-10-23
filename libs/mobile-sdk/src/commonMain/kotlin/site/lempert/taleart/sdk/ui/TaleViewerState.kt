package site.lempert.taleart.sdk.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import site.lempert.taleart.sdk.delivery.DeliveryTaleGroup

/**
 * Where the tale viewer is and what it does, as the `TaleViewer` class of
 * libs/web-sdk/src/lib/viewer.ts keeps it: the group and tale on screen, whether the person paused
 * it (the Pause button), holds it (a press on the stage) or left the app, and how far the current
 * tale has run. Groups without tales are skipped. All of it is Compose state.
 *
 * [onShown] is called with the group's id whenever one of its tales shows (`onGroupShown`), and
 * [onClosed] once, with the group shown last, when the viewer closes.
 */
class TaleViewerState(
    groups: List<DeliveryTaleGroup>,
    startGroupId: String,
    /** The person prefers reduced motion: each tale starts paused, and nothing advances by itself. */
    val reducedMotion: Boolean = false,
    private val onShown: (groupId: String) -> Unit = {},
    private val onClosed: (groupId: String) -> Unit = {},
) {
    /** The groups the viewer steps through: the zone's, in order, without those that have no tales. */
    val groups: List<DeliveryTaleGroup> = groups.filter { it.tales.isNotEmpty() }

    /** The index in [groups] of the group on screen. */
    var groupIndex by mutableIntStateOf(this.groups.indexOfFirst { it.id == startGroupId }.coerceAtLeast(0))
        private set

    /** The index of the tale on screen in its group. */
    var taleIndex by mutableIntStateOf(0)
        private set

    /** False for an unknown group or one without tales (`open` returns false), and once closed. */
    var isOpen by mutableStateOf(this.groups.any { it.id == startGroupId })
        private set

    /** Counts the tales shown: a tale shown again (Previous on the very first tale) restarts. */
    var shows by mutableIntStateOf(0)
        private set

    /** Paused by the person (the Pause button, Space); it stays paused on the next tale. */
    var paused by mutableStateOf(false)
        private set

    /** A press is down on the stage: the tale waits until it is released. */
    var held by mutableStateOf(false)
        internal set

    /** The app is in the background: the tale waits until it comes back. */
    var inBackground by mutableStateOf(false)
        internal set

    /** True while the tale waits for any reason. */
    val stopped: Boolean get() = paused || held || inBackground

    /** The current tale runs on the timer (it has no video, or its video failed), not on its video. */
    var timed by mutableStateOf(true)
        private set

    /** How long the current tale has run on the timer, in milliseconds. */
    var elapsedMs by mutableLongStateOf(0L)
        private set

    private var videoFraction by mutableFloatStateOf(0f)

    /** The group on screen. */
    val group: DeliveryTaleGroup get() = groups[groupIndex]

    /** The tale on screen, as the viewer draws it. */
    var view: TaleView = currentView()
        private set

    /** How far the current tale has run, 0 to 1. Under reduced motion a tale on the timer shows full, as on the web. */
    val progress: Float
        get() = when {
            timed && reducedMotion -> 1f
            timed -> (elapsedMs.toFloat() / view.durationMs).coerceIn(0f, 1f)
            else -> videoFraction
        }

    /** What a screen reader says as a tale shows, as the Web SDK's live region: `Summer trips, tale 2 of 3`. */
    val announcement: String get() = "${group.name}, tale ${taleIndex + 1} of ${group.tales.size}"

    init {
        if (isOpen) show(groupIndex, 0)
    }

    /** The next tale; after a group's last tale, the next group; after the last group's, the viewer closes. */
    fun next() {
        if (!isOpen) return
        if (taleIndex + 1 < group.tales.size) show(groupIndex, taleIndex + 1) else nextGroup()
    }

    /** The previous tale; before a group's first tale, the previous group's last; the very first tale restarts. */
    fun previous() {
        if (!isOpen) return
        when {
            taleIndex > 0 -> show(groupIndex, taleIndex - 1)
            groupIndex > 0 -> show(groupIndex - 1, groups[groupIndex - 1].tales.size - 1)
            else -> show(groupIndex, 0)
        }
    }

    /** The next group's first tale, or closes after the last group. */
    fun nextGroup() {
        if (!isOpen) return
        if (groupIndex + 1 < groups.size) show(groupIndex + 1, 0) else close()
    }

    /** The previous group's first tale; nothing on the first group. */
    fun previousGroup() {
        if (!isOpen) return
        if (groupIndex > 0) show(groupIndex - 1, 0)
    }

    /** Pauses or resumes, as the Pause button does. */
    fun togglePause() {
        paused = !paused
    }

    /** Closes the viewer and tells [onClosed] the group shown last. */
    fun close() {
        if (!isOpen) return
        isOpen = false
        held = false
        onClosed(group.id)
    }

    /** Runs the timer on by [ms] milliseconds while the tale plays; the tale ends at its duration. */
    internal fun tick(ms: Long) {
        if (!isOpen || !timed || stopped || reducedMotion) return
        elapsedMs += ms
        if (elapsedMs >= view.durationMs) next()
    }

    /** The video of the current tale played to [positionMs] of [durationMs]. */
    internal fun videoProgress(positionMs: Long, durationMs: Long) {
        if (timed || durationMs <= 0) return
        videoFraction = (positionMs.toFloat() / durationMs).coerceIn(0f, 1f)
    }

    /** The video of the current tale ended: the next tale, or under reduced motion it pauses there. */
    internal fun videoEnded() {
        if (timed) return
        videoFraction = 1f
        if (!reducedMotion) next() else if (!paused) paused = true
    }

    /** The video of the current tale cannot play: the tale runs on the timer instead. */
    internal fun videoFailed() {
        if (timed) return
        timed = true
        elapsedMs = 0
    }

    private fun show(group: Int, tale: Int) {
        groupIndex = group
        taleIndex = tale
        view = currentView()
        elapsedMs = 0
        videoFraction = 0f
        timed = view.video == null
        // Reduced motion: every tale starts paused; only a video can be played, from the button.
        if (reducedMotion) paused = true
        shows++
        onShown(this.group.id)
    }

    private fun currentView(): TaleView = TaleView.read(groups.getOrNull(groupIndex)?.tales?.getOrNull(taleIndex) ?: EMPTY_TALE, taleIndex)

    private companion object {
        val EMPTY_TALE = site.lempert.taleart.sdk.delivery.DeliveryTale()
    }
}
