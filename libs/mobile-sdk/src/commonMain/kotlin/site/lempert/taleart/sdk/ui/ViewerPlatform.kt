package site.lempert.taleart.sdk.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.staticCompositionLocalOf

/**
 * Shows [content] full screen over the host app, whatever layout the zone sits in: a full-screen
 * dialog window on Android, a modal view controller over the app's top view controller on iOS.
 * [onDismissRequest] is called for the platform's own dismissal (Android's Back) and when the
 * viewer cannot be shown or is dismissed from outside; leaving the composition removes it. Each
 * new [requestKey] is a new presentation. Android's Back calls [onBack] (by default
 * [onDismissRequest]): the viewer then closes with its own transition before it is removed.
 *
 * The window is transparent and appears without a platform transition: the viewer draws its own
 * backdrop and opens and closes with its own motion (story 9.9).
 */
@Composable
internal expect fun FullScreenViewer(
    requestKey: Any,
    onDismissRequest: () -> Unit,
    onBack: () -> Unit = onDismissRequest,
    content: @Composable () -> Unit,
)

/**
 * True when the person asks for less motion: Android's "Remove animations" (animator duration scale
 * 0), iOS's Reduce Motion. The viewer then never plays or advances by itself, as the Web SDK under
 * `prefers-reduced-motion: reduce`. The value follows the setting while composed, as the web's
 * media query does, and an open viewer follows it live (story 9.9).
 */
@Composable
internal expect fun rememberPrefersReducedMotion(): Boolean

/**
 * Says [text] through the platform's screen reader where a live region does not: on iOS a
 * VoiceOver announcement; on Android the viewer's live region carries it to TalkBack.
 */
internal expect fun announceForAccessibility(text: String)

/**
 * True once the full-screen viewer is on screen: on iOS the modal's view appears a moment after it
 * is composed, and the viewer waits for it before it opens and its tale starts. Elsewhere at once.
 */
internal val LocalViewerAppeared = staticCompositionLocalOf<State<Boolean>> { AppearedAtOnce }

private val AppearedAtOnce: State<Boolean> = mutableStateOf(true)

/** Shows the viewer in place instead of full screen: for tests, which have no window to present over. */
internal val LocalViewerInPlace = staticCompositionLocalOf { false }
