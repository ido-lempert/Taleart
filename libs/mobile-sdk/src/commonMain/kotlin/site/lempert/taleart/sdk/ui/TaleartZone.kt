package site.lempert.taleart.sdk.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import site.lempert.taleart.sdk.FallbackMode
import site.lempert.taleart.sdk.TaleartListener
import site.lempert.taleart.sdk.TaleartSdk
import site.lempert.taleart.sdk.analytics.AnalyticsEventType
import site.lempert.taleart.sdk.deliver
import site.lempert.taleart.sdk.delivery.DeliveryClient
import site.lempert.taleart.sdk.delivery.DeliveryTaleGroup
import site.lempert.taleart.sdk.delivery.DeliveryZone
import site.lempert.taleart.sdk.delivery.ZoneResult
import site.lempert.taleart.sdk.i18n.StringOverrides

/**
 * A zone, read from the Delivery API at [apiUrl] with the zone's [zoneKey] (`tak_…`), as
 * `<taleart-view zone-key>` reads it (see [TaleartZoneController]). An empty [apiUrl] uses the
 * SDK's (`TaleartSdk.init`). Like the web element it shows nothing while the API origin or the key is
 * blank, while the zone first loads, and when the read fails: the failure is logged once and passed
 * to [onError]. Changing [reloadKey] reads the zone again; the display stays as it is until the new
 * zone arrives.
 *
 * [locale] and [strings] are this zone's texts, over the SDK's (see `TaleartSdk.init`); [listener]
 * gets this zone's events before the SDK's listener does.
 *
 * [client] defaults to the process's [TaleartSdk.sharedClient]. A client passed in belongs to the
 * caller, who closes it, and must be remembered (or held outside composition): a new client on a
 * recomposition is used for the next read, but never starts one by itself.
 */
@Composable
fun TaleartZone(
    apiUrl: String,
    zoneKey: String,
    modifier: Modifier = Modifier,
    onGroupClick: (DeliveryTaleGroup) -> Unit = {},
    onError: (ZoneResult.Failure) -> Unit = {},
    client: DeliveryClient? = null,
    seenGroups: SeenGroups = rememberSeenGroups(),
    titleStyle: TextStyle = TextStyle.Default,
    reloadKey: Any? = null,
    opensViewer: Boolean = true,
    locale: String? = null,
    strings: Map<String, StringOverrides>? = null,
    listener: TaleartListener? = null,
    analytics: Boolean? = null,
    fallback: (@Composable () -> Unit)? = null,
) {
    val scope = rememberCoroutineScope()
    val controller = remember { TaleartZoneController(client ?: TaleartSdk.sharedClient, scope) }
    val reportError by rememberUpdatedState(onError)
    SideEffect {
        controller.client = client ?: TaleartSdk.sharedClient
        controller.onError = { reportError(it) }
        controller.locale = locale
        controller.strings = strings
        controller.listener = listener
        controller.analytics = analytics
    }
    DisposableEffect(controller) { onDispose { controller.close() } }
    LaunchedEffect(apiUrl, zoneKey) { controller.configure(apiUrl, zoneKey) }
    // The SDK's API origin, followed live: a change made by `TaleartSdk.init` reads the zone again.
    val sdkApiUrl = TaleartSdk.config.apiUrl
    LaunchedEffect(sdkApiUrl) { controller.refreshApi() }
    // The first key is the one the zone loaded with; each later one reloads it.
    val firstReloadKey = remember { arrayOf(reloadKey) }
    LaunchedEffect(reloadKey) {
        if (firstReloadKey[0] != reloadKey) {
            firstReloadKey[0] = reloadKey
            controller.reload()
        }
    }
    val context = rememberTaleartContext(
        controller.zoneKey,
        controller.zoneSlug,
        locale ?: controller.locale,
        strings ?: controller.strings,
        listener ?: controller.listener,
        controller.tracker,
        ZoneResponses(controller.effectiveApiUrl, controller.zoneKey, controller.client),
    )
    CompositionLocalProvider(LocalTaleartContext provides context) {
        val zone = controller.zone
        if (zone != null) {
            ZoneDisplay(zone, modifier, onGroupClick, seenGroups, titleStyle, opensViewer)
        } else if (controller.failure != null) {
            FailurePlaceholder(fallback, onRetry = { controller.reload() })
        }
    }
}

/**
 * The zone a [TaleartZoneController] holds: nothing until it has one, then as [TaleartZone] with a [DeliveryZone].
 * When the read failed, [fallback] is shown if given (the host's own placeholder); else, with
 * `TaleartConfig.fallback` [FallbackMode.Message], the translated `load.failed` text and a
 * `load.retry` button that reads the zone again. Otherwise nothing.
 */
@Composable
fun TaleartZone(
    controller: TaleartZoneController,
    modifier: Modifier = Modifier,
    onGroupClick: (DeliveryTaleGroup) -> Unit = {},
    seenGroups: SeenGroups = rememberSeenGroups(),
    titleStyle: TextStyle = TextStyle.Default,
    opensViewer: Boolean = true,
    fallback: (@Composable () -> Unit)? = null,
) {
    val sdkApiUrl = TaleartSdk.config.apiUrl
    LaunchedEffect(sdkApiUrl) { controller.refreshApi() }
    val context = rememberTaleartContext(
        controller.zoneKey,
        controller.zoneSlug,
        controller.locale,
        controller.strings,
        controller.listener,
        controller.tracker,
        ZoneResponses(controller.effectiveApiUrl, controller.zoneKey, controller.client),
    )
    CompositionLocalProvider(LocalTaleartContext provides context) {
        val zone = controller.zone
        if (zone != null) {
            ZoneDisplay(zone, modifier, onGroupClick, seenGroups, titleStyle, opensViewer)
        } else if (controller.failure != null) {
            FailurePlaceholder(fallback, onRetry = { controller.reload() })
        }
    }
}

/**
 * What a zone that failed to load shows: the host's [fallback] when given; else, with
 * `TaleartConfig.fallback` = [FallbackMode.Message], the translated `load.failed` text and a
 * `load.retry` button calling [onRetry]; else nothing (the Web SDK's `fallback="none"`).
 */
@Composable
private fun FailurePlaceholder(fallback: (@Composable () -> Unit)?, onRetry: () -> Unit) {
    if (fallback != null) {
        fallback()
        return
    }
    if (TaleartSdk.config.fallback != FallbackMode.Message) return
    val translate = LocalTaleartContext.current.translate
    Column(
        modifier = Modifier.fillMaxWidth().padding(16.dp).testTag(FAILED_TAG),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        BasicText(translate("load.failed"), style = TextStyle(textAlign = TextAlign.Center))
        Box(
            Modifier
                .clip(RoundedCornerShape(50))
                .border(1.dp, Color.Gray, RoundedCornerShape(50))
                .clickable(role = Role.Button, onClick = onRetry)
                .padding(horizontal = 14.dp, vertical = 6.dp),
        ) {
            BasicText(translate("load.retry"))
        }
    }
}

internal const val FAILED_TAG = "taleart.failed"

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
 * itself, and can show [TaleartViewer] when and where it likes.
 *
 * [zoneKey] names the zone in events (its first 8 characters only); [locale], [strings] and
 * [listener] are as on the keyed overload.
 */
@Composable
fun TaleartZone(
    zone: DeliveryZone,
    modifier: Modifier = Modifier,
    onGroupClick: (DeliveryTaleGroup) -> Unit = {},
    seenGroups: SeenGroups = rememberSeenGroups(),
    titleStyle: TextStyle = TextStyle.Default,
    opensViewer: Boolean = true,
    zoneKey: String = "",
    locale: String? = null,
    strings: Map<String, StringOverrides>? = null,
    listener: TaleartListener? = null,
) {
    val context = rememberTaleartContext(zoneKey, zone.slug, locale, strings, listener)
    CompositionLocalProvider(LocalTaleartContext provides context) {
        ZoneDisplay(zone, modifier, onGroupClick, seenGroups, titleStyle, opensViewer)
    }
}

// The display of a zone, under the zone's context (LocalTaleartContext).
@Composable
private fun ZoneDisplay(
    zone: DeliveryZone,
    modifier: Modifier,
    onGroupClick: (DeliveryTaleGroup) -> Unit,
    seenGroups: SeenGroups,
    titleStyle: TextStyle,
    opensViewer: Boolean,
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
    val context = LocalTaleartContext.current
    val tap = { group: DeliveryTaleGroup ->
        onGroupClick(group)
        if (opensViewer && group.tales.isNotEmpty()) {
            open = ViewerRequest(++requests, group.id, zone.taleGroups, theme)
            val ref = groupRef(zone.taleGroups, group)
            val event = context.event("presented", group = ref)
            deliver(context.listener, event) { it.onPresented(event) }
            context.track(AnalyticsEventType.Open, ref)
        }
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
    val context = LocalTaleartContext.current
    val last = remember(request) { arrayOfNulls<String>(1) }
    val state = remember(request) { TaleViewerState(request.groups, request.groupId, reduced, onClosed = { last[0] = it }, translate = context.translate) }
    // The zone is told once, with the group shown last, whichever way the viewer goes.
    val reported = remember(request) { BooleanArray(1) }
    val report = { group: String? ->
        if (!reported[0]) {
            reported[0] = true
            val shown = request.groups.firstOrNull { it.id == group }
            if (shown != null) {
                val event = context.event("dismissed", group = groupRef(request.groups, shown))
                deliver(context.listener, event) { it.onDismissed(event) }
            }
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
