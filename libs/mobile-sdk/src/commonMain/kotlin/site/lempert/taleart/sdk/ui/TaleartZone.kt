package site.lempert.taleart.sdk.ui

import androidx.compose.runtime.Composable
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
 * reads the zone again; the bar stays as it is until the new zone arrives.
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
    TaleartZone(controller, modifier, onGroupClick, seenGroups, titleStyle)
}

/** The zone a [TaleartZoneController] holds: nothing until it has one, then as [TaleartZone] with a [DeliveryZone]. */
@Composable
fun TaleartZone(
    controller: TaleartZoneController,
    modifier: Modifier = Modifier,
    onGroupClick: (DeliveryTaleGroup) -> Unit = {},
    seenGroups: SeenGroups = rememberSeenGroups(),
    titleStyle: TextStyle = TextStyle.Default,
) {
    controller.zone?.let { TaleartZone(it, modifier, onGroupClick, seenGroups, titleStyle) }
}

/**
 * An already-loaded zone: its display when the SDK knows its type (AD-5), now the bar; a zone
 * without a display, or with a type the SDK does not know, renders nothing. Groups in [seenGroups]
 * show the seen ring. Tapping a group calls [onGroupClick] and marks nothing: as in the Web SDK a
 * group becomes seen when the viewer shows it, which calls [SeenGroups.markSeen] (story 9.4).
 */
@Composable
fun TaleartZone(
    zone: DeliveryZone,
    modifier: Modifier = Modifier,
    onGroupClick: (DeliveryTaleGroup) -> Unit = {},
    seenGroups: SeenGroups = rememberSeenGroups(),
    titleStyle: TextStyle = TextStyle.Default,
) {
    val frame = zone.frame ?: return
    if (frame.type != BAR_FRAME_TYPE) return
    val settings = remember(frame) { BarSettings.read(frame.settings) }
    val theme = remember(zone.theme) { TaleartTheme.read(zone.theme) }
    TaleartBar(
        groups = zone.taleGroups,
        settings = settings,
        theme = theme,
        seen = seenGroups.ids,
        onGroupClick = onGroupClick,
        modifier = modifier,
        titleStyle = titleStyle,
    )
}
