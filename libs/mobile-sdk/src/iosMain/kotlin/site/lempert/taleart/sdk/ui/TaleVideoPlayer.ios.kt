package site.lempert.taleart.sdk.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.UIKitInteropProperties
import androidx.compose.ui.viewinterop.UIKitView
import kotlinx.cinterop.ExperimentalForeignApi
import kotlinx.cinterop.readValue
import kotlinx.coroutines.delay
import platform.AVFAudio.AVAudioSession
import platform.AVFAudio.AVAudioSessionCategoryPlayback
import platform.AVFAudio.setActive
import platform.AVFoundation.AVLayerVideoGravityResizeAspect
import platform.AVFoundation.AVLayerVideoGravityResizeAspectFill
import platform.AVFoundation.AVPlayer
import platform.AVFoundation.AVPlayerItem
import platform.AVFoundation.AVPlayerItemDidPlayToEndTimeNotification
import platform.AVFoundation.AVPlayerItemFailedToPlayToEndTimeNotification
import platform.AVFoundation.AVPlayerItemStatusFailed
import platform.AVFoundation.AVPlayerLayer
import platform.AVFoundation.currentItem
import platform.AVFoundation.currentTime
import platform.AVFoundation.duration
import platform.AVFoundation.muted
import platform.AVFoundation.pause
import platform.AVFoundation.play
import platform.AVFoundation.replaceCurrentItemWithPlayerItem
import platform.AVFoundation.seekToTime
import platform.CoreGraphics.CGAffineTransformMakeRotation
import platform.CoreGraphics.CGPointMake
import platform.CoreGraphics.CGRectGetMidX
import platform.CoreGraphics.CGRectGetMidY
import platform.CoreGraphics.CGRectZero
import platform.CoreMedia.CMTimeMake
import kotlin.math.PI
import platform.CoreMedia.CMTimeGetSeconds
import platform.Foundation.NSNotificationCenter
import platform.Foundation.NSOperationQueue
import platform.Foundation.NSURL
import platform.UIKit.UIColor
import platform.UIKit.UIView

internal actual fun platformTaleVideoPlayer(): TaleVideoPlayer = AvTaleVideoPlayer

// AVPlayer drawn by an AVPlayerLayer that follows its view's bounds; one player per tale shown.
@OptIn(ExperimentalForeignApi::class)
private class PlayerView(val playerLayer: AVPlayerLayer, background: UIColor = UIColor.blackColor) : UIView(frame = CGRectZero.readValue()) {
    init {
        // The stage's video letterboxes on black; a document's video is transparent, as a `<video>`.
        backgroundColor = background
        layer.addSublayer(playerLayer)
    }

    override fun layoutSubviews() {
        super.layoutSubviews()
        playerLayer.frame = bounds
    }
}

// Holds a document's video view, which turns, fades and rounds inside it: Compose sets the
// holder's frame, and the video keeps the holder's size about its centre whatever its transform.
@OptIn(ExperimentalForeignApi::class)
private class TurnedHolder(val video: PlayerView) : UIView(frame = CGRectZero.readValue()) {
    init {
        backgroundColor = UIColor.clearColor
        clipsToBounds = false
        addSubview(video)
    }

    override fun layoutSubviews() {
        super.layoutSubviews()
        video.setBounds(bounds)
        video.setCenter(CGPointMake(CGRectGetMidX(bounds), CGRectGetMidY(bounds)))
    }
}

@OptIn(ExperimentalForeignApi::class)
private object AvTaleVideoPlayer : TaleVideoPlayer {
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
        val progress by rememberUpdatedState(onProgress)
        val ended by rememberUpdatedState(onEnded)
        val failed by rememberUpdatedState(onError)
        val item = remember(url) { NSURL.URLWithString(url)?.let { AVPlayerItem(uRL = it) } }
        val player = remember(item) { item?.let { AVPlayer(playerItem = it) } }
        if (player == null || item == null) {
            LaunchedEffect(url) { failed() }
            return
        }
        DisposableEffect(player) {
            val center = NSNotificationCenter.defaultCenter
            val end = center.addObserverForName(AVPlayerItemDidPlayToEndTimeNotification, item, NSOperationQueue.mainQueue) { _ ->
                ended()
            }
            val fail = center.addObserverForName(AVPlayerItemFailedToPlayToEndTimeNotification, item, NSOperationQueue.mainQueue) { _ ->
                failed()
            }
            // Sound as the web plays it: the playback category, not mixed with other audio, even with
            // the silent switch on; the app's own category comes back when the video goes.
            val session = AVAudioSession.sharedInstance()
            val previousCategory = session.category
            val previousOptions = session.categoryOptions
            session.setCategory(AVAudioSessionCategoryPlayback, 0uL, null)
            session.setActive(true, null)
            onDispose {
                center.removeObserver(end)
                center.removeObserver(fail)
                player.pause()
                player.replaceCurrentItemWithPlayerItem(null)
                if (previousCategory != null) session.setCategory(previousCategory, previousOptions, null)
            }
        }
        LaunchedEffect(player, muted) { player.muted = muted }
        // The tale's segment follows the video's real position while it plays; a video that cannot load fails.
        LaunchedEffect(player, playing) {
            if (playing) player.play() else player.pause()
            var reportedFailure = false
            while (true) {
                if (item.status == AVPlayerItemStatusFailed && !reportedFailure) {
                    reportedFailure = true
                    failed()
                }
                if (!playing) break
                val duration = CMTimeGetSeconds(item.duration)
                val position = CMTimeGetSeconds(player.currentTime())
                if (duration.isFinite() && duration > 0 && position.isFinite()) {
                    progress((position * 1000).toLong(), (duration * 1000).toLong())
                }
                delay(50)
            }
        }
        UIKitView(
            factory = {
                PlayerView(AVPlayerLayer.playerLayerWithPlayer(player))
            },
            update = { view ->
                view.playerLayer.videoGravity = if (fit == MediaFit.Cover) AVLayerVideoGravityResizeAspectFill else AVLayerVideoGravityResizeAspect
            },
            modifier = modifier,
            // Touches go to the viewer's gestures, not the video.
            properties = UIKitInteropProperties(isInteractive = false, isNativeAccessibilityEnabled = false),
        )
    }

    // Compose's clip, rotation and opacity do not reach a native view: the video draws its look itself.
    override val drawsDocumentVideoLook: Boolean get() = true

    // A document's video: muted, looping in place with [loop]. A native view sits behind the
    // Compose canvas, which leaves a transparent hole the size of its upright box. With nothing
    // above it in the z-order, it is placed over the canvas instead and draws its look on itself:
    // its layer's corner radius (clipping), a rotation about its centre and its alpha, composited
    // over the elements below. With an element above it (a caption on the video), it stays in its
    // hole so the element shows over it, drawn upright, square-cornered and opaque, since a turned,
    // rounded or faded video would show the hole's black around it.
    @OptIn(ExperimentalComposeUiApi::class)
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
        val progress by rememberUpdatedState(onProgress)
        val ended by rememberUpdatedState(onEnded)
        val failed by rememberUpdatedState(onError)
        val looping by rememberUpdatedState(loop)
        val item = remember(url) { NSURL.URLWithString(url)?.let { AVPlayerItem(uRL = it) } }
        val player = remember(item) { item?.let { AVPlayer(playerItem = it).apply { muted = true } } }
        if (player == null || item == null) {
            LaunchedEffect(url) { failed() }
            return
        }
        DisposableEffect(player) {
            val center = NSNotificationCenter.defaultCenter
            val end = center.addObserverForName(AVPlayerItemDidPlayToEndTimeNotification, item, NSOperationQueue.mainQueue) { _ ->
                if (looping) {
                    player.seekToTime(CMTimeMake(0, 1))
                    player.play()
                } else {
                    ended()
                }
            }
            val fail = center.addObserverForName(AVPlayerItemFailedToPlayToEndTimeNotification, item, NSOperationQueue.mainQueue) { _ ->
                failed()
            }
            onDispose {
                center.removeObserver(end)
                center.removeObserver(fail)
                player.pause()
                player.replaceCurrentItemWithPlayerItem(null)
            }
        }
        LaunchedEffect(player, playing) {
            if (playing) player.play() else player.pause()
            var reportedFailure = false
            while (true) {
                if (item.status == AVPlayerItemStatusFailed && !reportedFailure) {
                    reportedFailure = true
                    failed()
                }
                if (!playing) break
                val duration = CMTimeGetSeconds(item.duration)
                val position = CMTimeGetSeconds(player.currentTime())
                if (duration.isFinite() && duration > 0 && position.isFinite()) {
                    progress((position * 1000).toLong(), (duration * 1000).toLong())
                }
                delay(50)
            }
        }
        UIKitView(
            factory = {
                TurnedHolder(
                    PlayerView(AVPlayerLayer.playerLayerWithPlayer(player), UIColor.clearColor).apply {
                        layer.masksToBounds = true
                    },
                )
            },
            update = { holder ->
                val view = holder.video
                val drawn = look.nothingAbove
                view.playerLayer.videoGravity = if (fit == MediaFit.Cover) AVLayerVideoGravityResizeAspectFill else AVLayerVideoGravityResizeAspect
                view.layer.cornerRadius = if (drawn) look.cornerRadius.value.toDouble() else 0.0
                view.alpha = if (drawn) look.alpha.toDouble() else 1.0
                view.transform = CGAffineTransformMakeRotation(if (drawn) look.rotation * PI / 180 else 0.0)
            },
            modifier = modifier,
            properties = UIKitInteropProperties(interactionMode = null, isNativeAccessibilityEnabled = false, placedAsOverlay = look.nothingAbove),
        )
    }
}
