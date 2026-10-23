package site.lempert.taleart.sdk.ui

import android.content.Context
import android.graphics.Matrix
import android.view.TextureView
import androidx.annotation.OptIn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.RememberObserver
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.VideoSize
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import kotlinx.coroutines.delay

internal actual fun platformTaleVideoPlayer(): TaleVideoPlayer = ExoTaleVideoPlayer

// An ExoPlayer for one video, released whenever it leaves composition, also when its composition
// is abandoned before it was ever applied.
private class RememberedPlayer(context: Context, url: String, silent: Boolean = false) : RememberObserver {
    val player: ExoPlayer = ExoPlayer.Builder(context)
        // A movie with sound, as the web plays it: it takes audio focus and pauses other media. A
        // document's video is muted and leaves other audio alone.
        .setAudioAttributes(
            AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(),
            /* handleAudioFocus = */ !silent,
        )
        .build()
        .apply {
            if (silent) volume = 0f
            setMediaItem(MediaItem.fromUri(url))
            repeatMode = Player.REPEAT_MODE_OFF
            prepare()
        }

    override fun onRemembered() = Unit
    override fun onForgotten() = player.release()
    override fun onAbandoned() = player.release()
}

// Media3 ExoPlayer drawn on a TextureView, not PlayerView's SurfaceView: a SurfaceView ignores the
// viewer's graphics layers, while the stage's video must fade, grow, follow a drag and turn with the
// cube (story 9.9). One player per tale shown, released with it.
private object ExoTaleVideoPlayer : TaleVideoPlayer {
    @OptIn(UnstableApi::class)
    @Composable
    override fun Video(
        url: String,
        fit: MediaFit,
        playing: Boolean,
        muted: Boolean,
        onProgress: (positionMs: Long, durationMs: Long) -> Unit,
        onEnded: () -> Unit,
        onError: () -> Unit,
        modifier: Modifier,
    ) {
        val context = LocalContext.current
        val progress by rememberUpdatedState(onProgress)
        val ended by rememberUpdatedState(onEnded)
        val failed by rememberUpdatedState(onError)
        val player = remember(url) { RememberedPlayer(context, url) }.player
        val texture = remember(player) { arrayOfNulls<TextureView>(1) }
        val fitNow by rememberUpdatedState(fit)
        DisposableEffect(player) {
            val listener = object : Player.Listener {
                override fun onPlaybackStateChanged(playbackState: Int) {
                    if (playbackState == Player.STATE_ENDED) {
                        progress(player.duration.coerceAtLeast(0), player.duration.coerceAtLeast(0))
                        ended()
                    }
                }

                override fun onPlayerError(error: PlaybackException) = failed()

                override fun onVideoSizeChanged(videoSize: VideoSize) {
                    texture[0]?.let { fitTexture(it, videoSize, fitNow) }
                }
            }
            player.addListener(listener)
            onDispose {
                player.removeListener(listener)
                player.pause()
            }
        }
        LaunchedEffect(player, muted) { player.volume = if (muted) 0f else 1f }
        // The tale's segment follows the video's real position while it plays.
        LaunchedEffect(player, playing) {
            player.playWhenReady = playing
            while (playing) {
                val duration = player.duration
                if (duration != C.TIME_UNSET && duration > 0) progress(player.currentPosition, duration)
                delay(50)
            }
        }
        AndroidView(
            factory = { ctx ->
                TextureView(ctx).also { view ->
                    texture[0] = view
                    // The bands a contained video leaves show the stage behind it, black.
                    view.isOpaque = false
                    view.addOnLayoutChangeListener { v, _, _, _, _, _, _, _, _ -> fitTexture(v as TextureView, player.videoSize, fitNow) }
                    player.setVideoTextureView(view)
                }
            },
            update = { view -> fitTexture(view, player.videoSize, fit) },
            onRelease = { view ->
                player.clearVideoTextureView(view)
                texture[0] = null
            },
            modifier = modifier,
        )
    }

    // A document's video: muted, drawn on a TextureView (not PlayerView's SurfaceView) so the
    // canvas's clip, opacity and rotation (the modifier's; [look] is not needed) apply to it;
    // `cover` and `contain` scale the texture. A looping video repeats in its player, without a gap.
    @Composable
    override fun DocumentVideo(
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
        val context = LocalContext.current
        val progress by rememberUpdatedState(onProgress)
        val ended by rememberUpdatedState(onEnded)
        val failed by rememberUpdatedState(onError)
        val player = remember(url) { RememberedPlayer(context, url, silent = true) }.player
        val texture = remember(player) { arrayOfNulls<TextureView>(1) }
        val fitNow by rememberUpdatedState(fit)
        LaunchedEffect(player, loop) { player.repeatMode = if (loop) Player.REPEAT_MODE_ONE else Player.REPEAT_MODE_OFF }
        DisposableEffect(player) {
            val listener = object : Player.Listener {
                override fun onPlaybackStateChanged(playbackState: Int) {
                    if (playbackState == Player.STATE_ENDED) {
                        progress(player.duration.coerceAtLeast(0), player.duration.coerceAtLeast(0))
                        ended()
                    }
                }

                override fun onPlayerError(error: PlaybackException) = failed()

                override fun onVideoSizeChanged(videoSize: VideoSize) {
                    texture[0]?.let { fitTexture(it, videoSize, fitNow) }
                }
            }
            player.addListener(listener)
            onDispose {
                player.removeListener(listener)
                player.pause()
            }
        }
        LaunchedEffect(player, playing) {
            player.playWhenReady = playing
            while (playing) {
                val duration = player.duration
                if (duration != C.TIME_UNSET && duration > 0) progress(player.currentPosition, duration)
                delay(50)
            }
        }
        AndroidView(
            factory = { ctx ->
                TextureView(ctx).also { view ->
                    texture[0] = view
                    // Transparent until the first frame, and in the bands a contained video leaves, as a `<video>`.
                    view.isOpaque = false
                    view.addOnLayoutChangeListener { v, _, _, _, _, _, _, _, _ -> fitTexture(v as TextureView, player.videoSize, fitNow) }
                    player.setVideoTextureView(view)
                }
            },
            update = { view -> fitTexture(view, player.videoSize, fit) },
            onRelease = { view ->
                player.clearVideoTextureView(view)
                texture[0] = null
            },
            modifier = modifier,
        )
    }
}

// Scales the texture, which stretches the video to the view, back to the video's aspect: to fill
// the view and crop (`cover`), or to fit inside it (`contain`), centred, as `object-fit`.
private fun fitTexture(view: TextureView, size: VideoSize, fit: MediaFit) {
    val w = view.width.toFloat()
    val h = view.height.toFloat()
    if (w <= 0f || h <= 0f || size.width <= 0 || size.height <= 0) return
    val video = size.width * size.pixelWidthHeightRatio / size.height
    val box = w / h
    val (sx, sy) = when {
        fit == MediaFit.Cover && video > box -> video / box to 1f
        fit == MediaFit.Cover -> 1f to box / video
        video > box -> 1f to box / video
        else -> video / box to 1f
    }
    view.setTransform(Matrix().apply { setScale(sx, sy, w / 2f, h / 2f) })
}
