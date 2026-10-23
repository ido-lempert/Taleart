package site.lempert.taleart.sdk.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.TextStyle
import site.lempert.taleart.sdk.delivery.DeliveryClient
import site.lempert.taleart.sdk.delivery.DeliveryTaleGroup
import site.lempert.taleart.sdk.delivery.DeliveryZone
import site.lempert.taleart.sdk.delivery.ZoneRequest
import site.lempert.taleart.sdk.delivery.ZoneResult
import site.lempert.taleart.sdk.storage.KeyValueStore
import site.lempert.taleart.sdk.storage.rememberDeviceKeyValueStore

/**
 * A zone, read from the Delivery API at [apiUrl] with the project's [siteKey] and the zone's slug
 * [zone], as `<taleart-view api-url site-key zone>` reads it. Like the web element it shows nothing
 * while any of the three is blank, while the zone loads, and when the read fails (a refused key, an
 * unknown slug, a network failure): the failure is logged once and passed to [onError]. A loaded
 * zone renders as [TaleartZone] with a [DeliveryZone] does. Changing [reloadKey] reads it again.
 *
 * [client] defaults to one the composable makes and closes; a client passed in belongs to the caller.
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
    seenStore: KeyValueStore = rememberDeviceKeyValueStore(),
    titleStyle: TextStyle = TextStyle.Default,
    reloadKey: Any? = null,
) {
    val deliveryClient = remember(client) { client ?: DeliveryClient() }
    DisposableEffect(deliveryClient) { onDispose { if (client == null) deliveryClient.close() } }
    val reportError by rememberUpdatedState(onError)
    var loaded by remember(apiUrl, siteKey, zone, reloadKey) { mutableStateOf<DeliveryZone?>(null) }
    LaunchedEffect(deliveryClient, apiUrl, siteKey, zone, reloadKey) {
        loaded = null
        if (apiUrl.isBlank() || siteKey.isBlank() || zone.isBlank()) return@LaunchedEffect
        when (val result = deliveryClient.fetchZone(apiUrl, ZoneRequest(key = siteKey, zone = zone))) {
            is ZoneResult.Success -> loaded = result.zone
            is ZoneResult.Failure -> {
                println("TaleArt: ${result.message}")
                reportError(result)
            }
        }
    }
    loaded?.let { TaleartZone(it, modifier, onGroupClick, seenStore, titleStyle) }
}

/**
 * An already-loaded zone: its display when the SDK knows its type (AD-5), now the bar; a zone
 * without a display, or with a type the SDK does not know, renders nothing. Tapping a group marks
 * it seen on the device (in [seenStore], as the Web SDK keeps it in local storage) and calls
 * [onGroupClick]; the full-screen viewer comes with story 9.4.
 */
@Composable
fun TaleartZone(
    zone: DeliveryZone,
    modifier: Modifier = Modifier,
    onGroupClick: (DeliveryTaleGroup) -> Unit = {},
    seenStore: KeyValueStore = rememberDeviceKeyValueStore(),
    titleStyle: TextStyle = TextStyle.Default,
) {
    val frame = zone.frame ?: return
    if (frame.type != BAR_FRAME_TYPE) return
    val seenGroups = remember(seenStore) { SeenGroups(seenStore) }
    var seen by remember(seenGroups, zone) { mutableStateOf(seenGroups.ids()) }
    val settings = remember(frame) { BarSettings.read(frame.settings) }
    val theme = remember(zone.theme) { TaleartTheme.read(zone.theme) }
    TaleartBar(
        groups = zone.taleGroups,
        settings = settings,
        theme = theme,
        seen = seen,
        onGroupClick = { group ->
            seenGroups.markSeen(group.id)
            seen = seen + group.id
            onGroupClick(group)
        },
        modifier = modifier,
        titleStyle = titleStyle,
    )
}
