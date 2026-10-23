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
 * [onClosed] is called once, with the group shown last, when the viewer closes. The viewer
 * composable marks each group seen as its tales show (`onGroupShown` in the Web SDK).
 */
class TaleViewerState(
    groups: List<DeliveryTaleGroup>,
    startGroupId: String,
    reducedMotion: Boolean = false,
    private val onClosed: (groupId: String) -> Unit = {},
) {
    private var reduced by mutableStateOf(reducedMotion)

    // The person paused (the Pause button, Space), as opposed to the pause reduced motion makes.
    private var personPaused = false

    /**
     * The person prefers reduced motion: each tale starts paused, and nothing advances by itself.
     * The viewer follows the setting live (story 9.9): turned on, the tale pauses where it is and a
     * timed tale's progress shows full; turned off, it goes on from where it was (or, a video that
     * ended meanwhile, to the next tale), unless the person had paused it.
     */
    var reducedMotion: Boolean
        get() = reduced
        set(value) {
            if (value == reduced) return
            reduced = value
            if (!isOpen) return
            if (value) {
                paused = true
            } else if (!personPaused) {
                if (videoAtEnd && !timed) next() else paused = false
            }
        }

    /** Called as the group on screen changes, with the group and tale shown before: the viewer's group transition. */
    internal var onGroupChange: ((fromGroup: Int, fromView: TaleView, toGroup: Int) -> Unit)? = null

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

    /** The current tale's video reached its end (it waits there under reduced motion). */
    var videoAtEnd by mutableStateOf(false)
        private set

    /** Counts the plays of the current tale's video: Play after its end starts it again from the start. */
    var videoRuns by mutableIntStateOf(0)
        private set

    /**
     * The current tale runs on its document's own video (R5), not the stage's: it ends at
     * [MAX_TALE_VIDEO_MS] at most, and after [VIDEO_STALL_MS] without progress while it should play.
     */
    val capped: Boolean get() = !timed && view.video == null && view.documentVideo != null

    // How long the document's video has made no progress while it should play, and where it was.
    private var stallMs = 0L
    private var lastPositionMs = -1L

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
        personPaused = paused
        // Play on a video at its end (reduced motion) plays it again from the start.
        if (!paused && videoAtEnd && !timed) {
            videoAtEnd = false
            videoFraction = 0f
            videoRuns++
            stallMs = 0
            lastPositionMs = -1
        }
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

    // Each video callback names the show ([shows]) and run ([videoRuns]) its player was made for:
    // a late call from the player of an earlier tale (or an earlier run) changes nothing.
    private fun current(show: Int, run: Int) = isOpen && !timed && show == shows && run == videoRuns

    /**
     * The video of show [show], run [run], played to [positionMs] of [durationMs]. A document's
     * video ([capped]) ends the tale at [MAX_TALE_VIDEO_MS], and its progress fills over at most that.
     */
    internal fun videoProgress(show: Int, run: Int, positionMs: Long, durationMs: Long) {
        if (!current(show, run)) return
        if (capped) {
            if (positionMs >= MAX_TALE_VIDEO_MS) {
                videoEnded(show, run)
                return
            }
            // Progress re-arms the stall check, as each `timeupdate` does on the web.
            if (positionMs != lastPositionMs) {
                lastPositionMs = positionMs
                stallMs = 0
            }
        }
        if (durationMs <= 0) return
        val length = if (capped) minOf(durationMs, MAX_TALE_VIDEO_MS) else durationMs
        videoFraction = (positionMs.toFloat() / length).coerceIn(0f, 1f)
    }

    /**
     * Runs the stall check of a document's video on by [ms] while it should play (not paused, held
     * or in the background, and never under reduced motion): after [VIDEO_STALL_MS] without
     * progress the tale ends, as the Web SDK's watchdog.
     */
    internal fun stallTick(ms: Long) {
        if (!isOpen || !capped || stopped || reducedMotion) return
        stallMs += ms
        if (stallMs >= VIDEO_STALL_MS) next()
    }

    /** Starts the stall check afresh: the video was just told to play (`armWatchdog`). */
    internal fun restartStallCheck() {
        stallMs = 0
    }

    /** The video of show [show] ended: the next tale, or under reduced motion it pauses there. */
    internal fun videoEnded(show: Int, run: Int) {
        if (!current(show, run)) return
        videoFraction = 1f
        if (!reducedMotion) next()
        else {
            videoAtEnd = true
            paused = true
        }
    }

    /** The video of show [show] cannot play: the tale runs on the timer instead. */
    internal fun videoFailed(show: Int, run: Int) {
        if (!current(show, run)) return
        timed = true
        elapsedMs = 0
    }

    private fun show(group: Int, tale: Int) {
        val fromGroup = groupIndex
        val fromView = view
        val changesGroup = shows > 0 && group != fromGroup
        groupIndex = group
        taleIndex = tale
        view = currentView()
        elapsedMs = 0
        videoFraction = 0f
        videoAtEnd = false
        timed = !view.runsOnVideo
        stallMs = 0
        lastPositionMs = -1
        // Reduced motion: every tale starts paused; only a video can be played, from the button.
        if (reducedMotion) paused = true
        shows++
        if (changesGroup) onGroupChange?.invoke(fromGroup, fromView, group)
    }

    private fun currentView(): TaleView = TaleView.read(groups.getOrNull(groupIndex)?.tales?.getOrNull(taleIndex) ?: EMPTY_TALE, taleIndex)

    private companion object {
        val EMPTY_TALE = site.lempert.taleart.sdk.delivery.DeliveryTale()
    }
}
