package site.lempert.taleart.sdk.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.TextStyle
import site.lempert.taleart.sdk.TaleartSdk
import site.lempert.taleart.sdk.delivery.DeliveryClient
import site.lempert.taleart.sdk.delivery.DeliveryTaleGroup
import site.lempert.taleart.sdk.delivery.DeliveryZone
import site.lempert.taleart.sdk.delivery.ZoneResult

/**
 * A zone, read from the Delivery API at [apiUrl] with the project's [siteKey] and the zone's slug
 * [zone], as `<taleart-view api-url site-key zone>` reads it (see [TaleartZoneController]). Like the
 * web element it shows nothing while any of the three is blank, while the zone first loads, and
 * when the read fails: the failure is logged once and passed to [onError]. Changing [reloadKey]
 * reads the zone again; the display stays as it is until the new zone arrives.
 *
 * [client] defaults to the process's [TaleartSdk.sharedClient]. A client passed in belongs to the
 * caller, who closes it, and must be remembered (or held outside composition): a new client on a
 * recomposition is used for the next read, but never starts one by itself.
 */
@Composable
fun TaleartZone(
    apiUrl: String,
    siteKey: String,
    zone: String,
    modifier: Modifier = Modifier,
    onGroupClick: (DeliveryTaleGroup) -> Unit = {},
    onError: (ZoneResult.Failure) -> Unit = {},
    client: DeliveryClient? = null,
    seenGroups: SeenGroups = rememberSeenGroups(),
    titleStyle: TextStyle = TextStyle.Default,
    reloadKey: Any? = null,
    opensViewer: Boolean = true,
) {
    val scope = rememberCoroutineScope()
    val controller = remember { TaleartZoneController(client ?: TaleartSdk.sharedClient, scope) }
    val reportError by rememberUpdatedState(onError)
    SideEffect {
        controller.client = client ?: TaleartSdk.sharedClient
        controller.onError = { reportError(it) }
    }
    DisposableEffect(controller) { onDispose { controller.close() } }
    LaunchedEffect(apiUrl, siteKey, zone) { controller.configure(apiUrl, siteKey, zone) }
    // The first key is the one the zone loaded with; each later one reloads it.
    val firstReloadKey = remember { arrayOf(reloadKey) }
    LaunchedEffect(reloadKey) {
        if (firstReloadKey[0] != reloadKey) {
            firstReloadKey[0] = reloadKey
            controller.reload()
        }
    }
    TaleartZone(controller, modifier, onGroupClick, seenGroups, titleStyle, opensViewer)
}

/** The zone a [TaleartZoneController] holds: nothing until it has one, then as [TaleartZone] with a [DeliveryZone]. */
@Composable
fun TaleartZone(
    controller: TaleartZoneController,
    modifier: Modifier = Modifier,
    onGroupClick: (DeliveryTaleGroup) -> Unit = {},
    seenGroups: SeenGroups = rememberSeenGroups(),
    titleStyle: TextStyle = TextStyle.Default,
    opensViewer: Boolean = true,
) {
    controller.zone?.let { TaleartZone(it, modifier, onGroupClick, seenGroups, titleStyle, opensViewer) }
}

/**
 * An already-loaded zone: its display when the SDK knows its type (AD-5), the bar ([TaleartBar]) or
 * the banner ([TaleartBanner]), chosen by the frame's type each time the zone changes; a zone
 * without a display, or with a type the SDK does not know, renders nothing. Groups in [seenGroups]
 * show the seen ring in the bar (the banner, as on the web, shows no seen state).
 *
 * Tapping a group (a bar item or a banner slide) calls [onGroupClick] and, unless [opensViewer] is
 * false, opens the full-screen [TaleartViewer] at that group (a group without tales opens nothing),
 * over the whole app whatever layout the display sits in: a full-screen dialog on Android, a modal
 * view controller on iOS. As in the Web SDK a group becomes seen when the viewer shows it, never on
 * the tap; its ring turns to the seen colour behind the viewer, and a banner shows the slide of the
 * group the viewer showed last once it closes. With [opensViewer] false the host handles taps
 * itself, and can show
 * [TaleartViewer] when and where it likes.
 */
@Composable
fun TaleartZone(
    zone: DeliveryZone,
    modifier: Modifier = Modifier,
    onGroupClick: (DeliveryTaleGroup) -> Unit = {},
    seenGroups: SeenGroups = rememberSeenGroups(),
    titleStyle: TextStyle = TextStyle.Default,
    opensViewer: Boolean = true,
) {
    // The viewer open now, if any. It holds the groups and theme it opened with for its whole life,
    // so a zone read again (a reload, a refresh) never closes or reshuffles it under the person.
    var open by remember { mutableStateOf<ViewerRequest?>(null) }
    var requests by remember { mutableIntStateOf(0) }
    // A host that takes taps back (or a view that left its window) closes the viewer.
    if (!opensViewer && open != null) SideEffect { open = null }
    // The banner shows the slide of the group the viewer showed last once it closes (Web SDK `focus`).
    var returnTo by remember { mutableStateOf<BannerShowRequest?>(null) }
    val frame = zone.frame
    val theme = remember(zone.theme) { TaleartTheme.read(zone.theme) }
    val tap = { group: DeliveryTaleGroup ->
        onGroupClick(group)
        if (opensViewer && group.tales.isNotEmpty()) open = ViewerRequest(++requests, group.id, zone.taleGroups, theme)
    }
    when (frame?.type) {
        BAR_FRAME_TYPE -> {
            val settings = remember(frame) { BarSettings.read(frame.settings) }
            TaleartBar(
                groups = zone.taleGroups,
                settings = settings,
                theme = theme,
                seen = seenGroups.ids,
                onGroupClick = tap,
                modifier = modifier,
                titleStyle = titleStyle,
            )
        }
        BANNER_FRAME_TYPE -> {
            val settings = remember(frame) { BannerSettings.read(frame.settings) }
            TaleartBanner(
                groups = zone.taleGroups,
                settings = settings,
                theme = theme,
                onGroupClick = tap,
                modifier = modifier,
                titleStyle = titleStyle,
                reducedMotion = rememberPrefersReducedMotion(),
                show = returnTo,
                onShowDone = { if (returnTo === it) returnTo = null },
            )
        }
    }
    // After the display, so a viewer shown in place (tests) lies over it.
    open?.takeIf { opensViewer }?.let { request ->
        key(request.id) {
            ViewerOverlay(request, seenGroups) { lastGroup ->
                if (open?.id == request.id) {
                    open = null
                    // Only a banner on screen now takes it up (see BannerShowRequest).
                    if (lastGroup != null && zone.frame?.type == BANNER_FRAME_TYPE) returnTo = BannerShowRequest(lastGroup)
                }
            }
        }
    }
}

// One opening of the viewer: the groups and theme as they were when the group was tapped.
private class ViewerRequest(val id: Int, val groupId: String, val groups: List<DeliveryTaleGroup>, val theme: TaleartTheme)

// The viewer over the app (or in place, in tests), with the SDK's own image loader and video player.
// It is removed once it has finished closing; Back closes it with its transition.
@Composable
private fun ViewerOverlay(request: ViewerRequest, seenGroups: SeenGroups, onClose: (lastGroup: String?) -> Unit) {
    val loader = LocalCoverImageLoader.current
    val player = LocalTaleVideoPlayer.current
    val reduced = rememberPrefersReducedMotion()
    val last = remember(request) { arrayOfNulls<String>(1) }
    val state = remember(request) { TaleViewerState(request.groups, request.groupId, reduced, onClosed = { last[0] = it }) }
    // The zone is told once, with the group shown last, whichever way the viewer goes.
    val reported = remember(request) { BooleanArray(1) }
    val report = { group: String? ->
        if (!reported[0]) {
            reported[0] = true
            onClose(group)
        }
    }
    val viewer = @Composable {
        CompositionLocalProvider(LocalCoverImageLoader provides loader, LocalTaleVideoPlayer provides player) {
            ViewerContent(
                state,
                Modifier,
                seenGroups,
                request.theme,
                onGroupShown = {},
                reducedMotion = rememberPrefersReducedMotion(),
                onExited = { report(last[0]) },
            )
        }
    }
    if (LocalViewerInPlace.current) {
        viewer()
    } else {
        FullScreenViewer(
            request.id,
            onDismissRequest = { report(last[0]) },
            // Back closes with the fade; a second Back while it fades removes it at once, keeping the group shown last.
            onBack = { if (state.isOpen) state.close() else report(last[0]) },
            content = viewer,
        )
    }
}
