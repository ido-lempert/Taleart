package site.lempert.taleart.taller

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.safeContentPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import kotlinx.coroutines.delay
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import site.lempert.taleart.sdk.FallbackMode
import site.lempert.taleart.sdk.TaleartConfig
import site.lempert.taleart.sdk.TaleartSdk
import site.lempert.taleart.sdk.delivery.DeliveryClient
import site.lempert.taleart.sdk.delivery.DeliveryZone
import site.lempert.taleart.sdk.delivery.ZoneResult
import site.lempert.taleart.sdk.ui.SeenGroups
import site.lempert.taleart.sdk.ui.TaleViewerState
import site.lempert.taleart.sdk.ui.TaleartViewer
import site.lempert.taleart.sdk.ui.TaleartZone
import site.lempert.taleart.sdk.ui.TaleartZoneController
import site.lempert.taleart.sdk.ui.rememberSeenGroups

/** The SDK line shown on Taller's shared screen. */
fun sdkVersionLabel(version: String = TaleartSdk.VERSION): String = "SDK $version"

/** What the home screen says for a failed read, by its type. */
fun failureLabel(failure: ZoneResult.Failure): String = when (failure) {
    is ZoneResult.InvalidSiteKey -> "Invalid site key or zone: ${failure.message}"
    is ZoneResult.UnknownZone -> "Unknown zone: ${failure.message}"
    is ZoneResult.RateLimited -> "Rate limited: ${failure.message}" +
        (failure.retryAfterSeconds?.let { " (try again in $it s)" } ?: "")
    is ZoneResult.Offline -> "Offline: ${failure.message}"
    is ZoneResult.ServerError -> "Server error ${failure.status}: ${failure.message}"
    is ZoneResult.InvalidResponse -> "Invalid response: ${failure.message}"
}

/**
 * Taller: the home screen lists the zone's tale group titles with their tale titles under each,
 * and the debug settings screen takes the API URL, the site key and the zone's slug.
 *
 * The zone is read by one [TaleartZoneController], which the SDK's own display (the zone bar, with
 * the frequency cap and the fallback placeholder of [TaleartSdk.config]) and the debug list share.
 * [debug] are the debug options (see [TallerDebugOptions]); by default they are read from [store].
 */
@Composable
@Preview
fun App(
    store: KeyValueStore = remember { InMemoryStore() },
    client: DeliveryClient? = null,
    seenGroups: SeenGroups? = null,
    debug: TallerDebugOptions? = null,
) {
    // The device's seen groups unless given (tests give an isolated store).
    val seen = seenGroups ?: rememberSeenGroups()
    val deliveryClient = remember(client) { client ?: DeliveryClient() }
    // Closes only the client it made; a client passed in belongs to the caller.
    DisposableEffect(deliveryClient) { onDispose { if (client == null) deliveryClient.close() } }
    val options = remember(debug, store) { debug ?: TallerDebugOptions.load(store) }
    var settings by remember { mutableStateOf(DebugSettings.load(store)) }
    var showSettings by remember { mutableStateOf(!settings.complete && !options.noBackend) }
    val scope = rememberCoroutineScope()
    val controller = remember(deliveryClient) { TaleartZoneController(deliveryClient, scope) }
    DisposableEffect(controller) { onDispose { controller.close() } }

    // The SDK's configuration first (its fallback and frequency apply to the zone the controller reads).
    fun load(with: DebugSettings) {
        TaleartSdk.init(
            TaleartConfig(
                apiUrl = with.apiUrl,
                locale = options.locale,
                fallback = options.fallback,
                frequency = options.frequency,
                layoutDirection = options.layoutDirection,
                strings = TallerStrings.bar,
            ),
        )
        // No backend: the zone JSON the app holds is shown, with no request.
        if (options.noBackend) controller.configureLocalJson(NO_BACKEND_ZONE_JSON) else controller.configure(with.apiUrl, with.zoneKey)
    }

    // A saved zone loads as the app opens.
    LaunchedEffect(Unit) { load(settings) }

    // The timed actions of the debug options (clips without a finger) start once the zone is shown.
    val shownZone = controller.zone
    LaunchedEffect(shownZone != null, options) {
        if (shownZone != null) runDebugActions(options, shownZone.taleGroups.map { it.name })
    }

    MaterialTheme {
        Box(Modifier.fillMaxSize()) {
            if (options.zoneOnly && !showSettings && (settings.complete || options.noBackend)) {
                ZoneOnlyScreen(settings, controller, seen, options)
            } else Column(
                modifier = Modifier
                    .background(MaterialTheme.colorScheme.surface)
                    .safeContentPadding()
                    .fillMaxSize()
                    .padding(horizontal = 16.dp),
            ) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("TaleArt", style = MaterialTheme.typography.headlineLarge, modifier = Modifier.testTag("title"))
                        Text(sdkVersionLabel(), style = MaterialTheme.typography.bodyMedium, modifier = Modifier.testTag("sdk-version"))
                    }
                    if (!showSettings) {
                        OutlinedButton(onClick = { showSettings = true }, modifier = Modifier.testTag("open-settings")) {
                            Text("Settings")
                        }
                    }
                }
                Spacer(Modifier.height(16.dp))
                if (showSettings) {
                    SettingsScreen(
                        initial = settings,
                        onLoad = { saved ->
                            saved.save(store)
                            settings = DebugSettings.load(store)
                            showSettings = false
                            load(settings)
                        },
                        onCancel = if (settings.complete) ({ showSettings = false }) else null,
                    )
                } else {
                    HomeScreen(settings, controller, seen, options, onReload = { controller.reload() })
                }
            }
            // The debug option that opens the viewer at start: the group's tale, stepped to from its first.
            if (!showSettings) AutoOpenViewer(controller.zone?.let { if (options.redrawsZone) options.drawn(it) else it }, options)
        }
    }
}

/**
 * The page of `taller.zoneOnly`: the zone alone on a plain light page with the host's margin, as the Web SDK's bare sample
 * page has it (a screenshot or a clip then frames the SDK's own output). Tapping an item opens the SDK's viewer as always.
 */
@Composable
private fun ZoneOnlyScreen(settings: DebugSettings, controller: TaleartZoneController, seen: SeenGroups, options: TallerDebugOptions) {
    val page = Color(0xFFF5F5F7)
    val ink = Color(0xFF1D1D1F)
    val titleStyle = TextStyle(color = ink, fontFamily = LocalTextStyle.current.fontFamily)
    val shown = if (options.redrawsZone) controller.zone?.let { options.drawn(it) } else null
    Box(Modifier.fillMaxSize().background(page).safeDrawingPadding().padding(24.dp).testTag("zone-only")) {
        if (shown != null) {
            TaleartZone(shown, modifier = Modifier.testTag("zone-display"), seenGroups = seen, titleStyle = titleStyle, zoneKey = settings.zoneKey)
        } else {
            TaleartZone(controller, modifier = Modifier.testTag("zone-display"), seenGroups = seen, titleStyle = titleStyle)
        }
    }
}

/**
 * Runs the options' timed actions in order, each [TallerDebugOptions.autoDelayMs] after the one before; one whose control
 * is not on screen yet is tried again every 250 ms for up to 10 s, then skipped.
 */
private suspend fun runDebugActions(options: TallerDebugOptions, groupNames: List<String>) {
    for (action in options.actions) {
        delay(options.autoDelayMs)
        var tries = 0
        while (!performDebugAction(action, groupNames) && tries++ < 40) delay(250)
    }
}

// Opens the viewer on the debug option's group (and tale) once its zone is read; it closes by the viewer's own controls.
@Composable
private fun AutoOpenViewer(zone: DeliveryZone?, options: TallerDebugOptions) {
    val index = options.autoOpenGroup ?: return
    if (zone == null) return
    val group = zone.taleGroups.getOrNull(index)?.takeIf { it.tales.isNotEmpty() } ?: return
    val state = remember(zone, index, options.autoOpenTale) {
        TaleViewerState(zone.taleGroups, group.id).also { viewer -> repeat(options.autoOpenTale) { viewer.next() } }
    }
    TaleartViewer(state, Modifier.fillMaxSize())
}

@Composable
private fun SettingsScreen(initial: DebugSettings, onLoad: (DebugSettings) -> Unit, onCancel: (() -> Unit)?) {
    var apiUrl by remember { mutableStateOf(initial.apiUrl) }
    var zoneKey by remember { mutableStateOf(initial.zoneKey) }
    val edited = DebugSettings(apiUrl, zoneKey)
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Debug settings", style = MaterialTheme.typography.titleLarge)
        OutlinedTextField(
            value = apiUrl,
            onValueChange = { apiUrl = it },
            label = { Text("API URL") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Next),
            modifier = Modifier.fillMaxWidth().testTag("api-url"),
        )
        OutlinedTextField(
            value = zoneKey,
            onValueChange = { zoneKey = it },
            label = { Text("Zone key") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii, imeAction = ImeAction.Done),
            modifier = Modifier.fillMaxWidth().testTag("zone-key"),
        )
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Button(onClick = { onLoad(edited) }, enabled = edited.complete, modifier = Modifier.testTag("load")) {
                Text("Load")
            }
            if (onCancel != null) OutlinedButton(onClick = onCancel) { Text("Cancel") }
        }
    }
}

@Composable
private fun HomeScreen(
    settings: DebugSettings,
    controller: TaleartZoneController,
    seen: SeenGroups,
    options: TallerDebugOptions,
    onReload: () -> Unit,
) {
    var tapped by remember { mutableStateOf<String?>(null) }
    val zone = controller.zone
    val failure = controller.failure
    Column {
        // The zone's display as a host app shows it: the SDK's own, which also shows the fallback placeholder.
        if (settings.complete || options.noBackend) {
            // The host's title colour and font, as the web bar inherits the page's.
            val titleStyle = TextStyle(color = LocalContentColor.current, fontFamily = LocalTextStyle.current.fontFamily)
            // The debug option draws the zone's bar in its layout; without it (or before the zone reads) the controller shows it.
            val shown = if (options.redrawsZone) zone?.let { options.drawn(it) } else null
            if (shown != null) {
                TaleartZone(
                    shown,
                    modifier = Modifier.testTag("zone-display"),
                    onGroupClick = { tapped = it.name },
                    seenGroups = seen,
                    titleStyle = titleStyle,
                    zoneKey = settings.zoneKey,
                )
            } else {
                TaleartZone(
                    controller,
                    modifier = Modifier.testTag("zone-display"),
                    onGroupClick = { tapped = it.name },
                    seenGroups = seen,
                    titleStyle = titleStyle,
                )
            }
        }
        if (zone != null) {
            tapped?.let { Text("Tapped: $it", style = MaterialTheme.typography.bodySmall, modifier = Modifier.testTag("tapped")) }
            HorizontalDivider(Modifier.padding(vertical = 8.dp))
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                "Zone ${zone?.slug ?: settings.zoneKey.take(8)} at ${settings.apiUrl}",
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.weight(1f),
            )
            OutlinedButton(onClick = onReload, modifier = Modifier.testTag("reload")) { Text("Reload") }
        }
        Spacer(Modifier.height(8.dp))
        when {
            !settings.complete && !options.noBackend -> Text("Set the API URL, site key and zone in Settings.")
            zone != null -> ZoneList(zone)
            // With the fallback message shown by the display, the text of the failure is left out.
            failure != null -> if (options.fallback != FallbackMode.Message) {
                Text(failureLabel(failure), color = MaterialTheme.colorScheme.error, modifier = Modifier.testTag("error"))
            }
            // Read and nothing left to show (every group capped or left out for this viewer): an empty state, not a spinner.
            controller.loaded -> Text("Nothing to show: every group here is capped or left out for this viewer.", modifier = Modifier.testTag("empty"))
            else -> CircularProgressIndicator(Modifier.testTag("loading"))
        }
    }
}

@Composable
private fun ZoneList(zone: DeliveryZone) {
    Text(
        "${zone.name} (${zone.frame?.type ?: "no display"})",
        style = MaterialTheme.typography.titleMedium,
        modifier = Modifier.testTag("zone-name"),
    )
    if (zone.taleGroups.isEmpty()) {
        Text("This zone has no tale groups.", modifier = Modifier.testTag("no-groups"))
        return
    }
    LazyColumn(Modifier.fillMaxSize().testTag("groups")) {
        items(zone.taleGroups, key = { it.id }) { group ->
            Column(Modifier.padding(vertical = 8.dp)) {
                Text(
                    group.name,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.testTag("group"),
                )
                for (tale in group.tales) {
                    Text(
                        tale.title,
                        style = MaterialTheme.typography.bodyLarge,
                        modifier = Modifier.padding(start = 16.dp, top = 4.dp).testTag("tale"),
                    )
                }
                Spacer(Modifier.height(8.dp))
                HorizontalDivider()
            }
        }
    }
}
