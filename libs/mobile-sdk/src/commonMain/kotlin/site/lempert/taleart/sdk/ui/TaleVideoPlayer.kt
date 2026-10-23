package site.lempert.taleart.sdk.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier

/**
 * Plays a tale's video in the viewer: Media3 ExoPlayer on Android, AVPlayer on iOS
 * ([platformTaleVideoPlayer]). The viewer draws one [Video] per tale shown (a tale shown again gets
 * a new one) and drives it through [Video]'s parameters; the player reports back.
 */
interface TaleVideoPlayer {
    /**
     * Shows the video at [url] filling [modifier]'s box with [fit]. It plays while [playing] and
     * waits on its current frame otherwise, without sound while [muted]. It reports its position and
     * length in milliseconds through [onProgress] while it plays (the tale's progress follows them),
     * [onEnded] once at its end, and [onError] once when it cannot play (the tale then runs on the timer).
     */
    @Composable
    fun Video(
        url: String,
        fit: MediaFit,
        playing: Boolean,
        muted: Boolean,
        onProgress: (positionMs: Long, durationMs: Long) -> Unit,
        onEnded: () -> Unit,
        onError: () -> Unit,
        modifier: Modifier,
    )
}

/** The platform's video player: Media3 ExoPlayer on Android, AVPlayer on iOS. */
internal expect fun platformTaleVideoPlayer(): TaleVideoPlayer

/** The viewer's video player, when not the platform's: tests provide a fake one. */
internal val LocalTaleVideoPlayer = staticCompositionLocalOf<TaleVideoPlayer?> { null }
