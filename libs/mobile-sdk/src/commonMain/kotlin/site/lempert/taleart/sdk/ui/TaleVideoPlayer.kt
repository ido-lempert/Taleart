package site.lempert.taleart.sdk.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.Dp

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

    /**
     * Shows a document's video element (R5, story 9.5) in its box on the canvas: always muted, as the
     * web's `<video muted playsinline>`, looping in place with [loop] (beside the stage's video),
     * and drawn with [look] (corner radius, rotation, opacity) where the canvas's own modifiers do
     * not reach a native view. Reports as [Video] does. By default it is [Video] without sound.
     */
    /**
     * True when [DocumentVideo] draws [DocumentVideoLook] on its native view itself: the canvas
     * then gives the video its upright box only, without Compose's clip, rotation and opacity,
     * which do not reach a native view (iOS).
     */
    val drawsDocumentVideoLook: Boolean get() = false

    @Composable
    fun DocumentVideo(
        url: String,
        fit: MediaFit,
        playing: Boolean,
        loop: Boolean,
        look: DocumentVideoLook,
        onProgress: (positionMs: Long, durationMs: Long) -> Unit,
        onEnded: () -> Unit,
        onError: () -> Unit,
        modifier: Modifier,
    ) {
        Video(url, fit, playing, muted = true, onProgress = onProgress, onEnded = onEnded, onError = onError, modifier = modifier)
    }
}

/**
 * How a document's video is drawn on the canvas: corner radius, rotation in degrees, opacity, and
 * whether nothing above it in the z-order overlaps it ([nothingAbove]), so a native view may be
 * placed over the canvas.
 */
data class DocumentVideoLook(val cornerRadius: Dp, val rotation: Float, val alpha: Float, val nothingAbove: Boolean)

/** The platform's video player: Media3 ExoPlayer on Android, AVPlayer on iOS. */
internal expect fun platformTaleVideoPlayer(): TaleVideoPlayer

/** The viewer's video player, when not the platform's: tests provide a fake one. */
internal val LocalTaleVideoPlayer = staticCompositionLocalOf<TaleVideoPlayer?> { null }
