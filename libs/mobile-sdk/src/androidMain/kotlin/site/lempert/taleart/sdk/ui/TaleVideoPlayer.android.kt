package site.lempert.taleart.sdk.ui

import androidx.annotation.OptIn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import kotlinx.coroutines.delay

internal actual fun platformTaleVideoPlayer(): TaleVideoPlayer = ExoTaleVideoPlayer

// Media3 ExoPlayer in a PlayerView without controls; one player per tale shown, released with it.
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
        val player = remember(url) {
            ExoPlayer.Builder(context).build().apply {
                setMediaItem(MediaItem.fromUri(url))
                repeatMode = Player.REPEAT_MODE_OFF
                prepare()
            }
        }
        DisposableEffect(player) {
            val listener = object : Player.Listener {
                override fun onPlaybackStateChanged(playbackState: Int) {
                    if (playbackState == Player.STATE_ENDED) {
                        progress(player.duration.coerceAtLeast(0), player.duration.coerceAtLeast(0))
                        ended()
                    }
                }

                override fun onPlayerError(error: PlaybackException) = failed()
            }
            player.addListener(listener)
            onDispose {
                player.removeListener(listener)
                player.release()
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
                PlayerView(ctx).apply {
                    useController = false
                    setShutterBackgroundColor(android.graphics.Color.TRANSPARENT)
                    setKeepContentOnPlayerReset(true)
                    this.player = player
                }
            },
            update = { view ->
                view.resizeMode = if (fit == MediaFit.Cover) AspectRatioFrameLayout.RESIZE_MODE_ZOOM else AspectRatioFrameLayout.RESIZE_MODE_FIT
            },
            modifier = modifier,
        )
    }
}
