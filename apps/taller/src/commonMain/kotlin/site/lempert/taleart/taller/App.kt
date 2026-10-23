package site.lempert.taleart.taller

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeContentPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import site.lempert.taleart.sdk.TaleartSdk
import site.lempert.taleart.sdk.delivery.DeliveryClient
import site.lempert.taleart.sdk.delivery.DeliveryZone
import site.lempert.taleart.sdk.delivery.ZoneRequest
import site.lempert.taleart.sdk.delivery.ZoneResult

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

private sealed interface ZoneState {
    data object NotSet : ZoneState
    data object Loading : ZoneState
    data class Done(val result: ZoneResult) : ZoneState
}

/**
 * Taller: the home screen lists the zone's tale group titles with their tale titles under each,
 * and the debug settings screen takes the API URL, the site key and the zone's slug.
 */
@Composable
@Preview
fun App(
    store: KeyValueStore = remember { InMemoryStore() },
    client: DeliveryClient? = null,
) {
    val deliveryClient = remember(client) { client ?: DeliveryClient() }
    // Closes only the client it made; a client passed in belongs to the caller.
    DisposableEffect(deliveryClient) { onDispose { if (client == null) deliveryClient.close() } }
    var settings by remember { mutableStateOf(DebugSettings.load(store)) }
    var showSettings by remember { mutableStateOf(!settings.complete) }
    var state by remember { mutableStateOf<ZoneState>(ZoneState.NotSet) }
    val scope = rememberCoroutineScope()
    // The load in progress: a new load replaces it, so an older answer never shows over a newer one.
    var loading by remember { mutableStateOf<Job?>(null) }

    fun load(with: DebugSettings) {
        loading?.cancel()
        if (!with.complete) {
            state = ZoneState.NotSet
            return
        }
        state = ZoneState.Loading
        loading = scope.launch {
            state = ZoneState.Done(deliveryClient.fetchZone(with.apiUrl, ZoneRequest(with.siteKey, with.zone)))
        }
    }

    // A saved zone loads as the app opens.
    LaunchedEffect(Unit) { load(settings) }

    MaterialTheme {
        Column(
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
                HomeScreen(settings, state, onReload = { load(settings) })
            }
        }
    }
}

@Composable
private fun SettingsScreen(initial: DebugSettings, onLoad: (DebugSettings) -> Unit, onCancel: (() -> Unit)?) {
    var apiUrl by remember { mutableStateOf(initial.apiUrl) }
    var siteKey by remember { mutableStateOf(initial.siteKey) }
    var zone by remember { mutableStateOf(initial.zone) }
    val edited = DebugSettings(apiUrl, siteKey, zone)
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
            value = siteKey,
            onValueChange = { siteKey = it },
            label = { Text("Site key") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii, imeAction = ImeAction.Next),
            modifier = Modifier.fillMaxWidth().testTag("site-key"),
        )
        OutlinedTextField(
            value = zone,
            onValueChange = { zone = it },
            label = { Text("Zone slug") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii, imeAction = ImeAction.Done),
            modifier = Modifier.fillMaxWidth().testTag("zone"),
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
private fun HomeScreen(settings: DebugSettings, state: ZoneState, onReload: () -> Unit) {
    Column {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                "Zone ${settings.zone} at ${settings.apiUrl}",
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.weight(1f),
            )
            OutlinedButton(onClick = onReload, modifier = Modifier.testTag("reload")) { Text("Reload") }
        }
        Spacer(Modifier.height(8.dp))
        when (state) {
            ZoneState.NotSet -> Text("Set the API URL, site key and zone in Settings.")
            ZoneState.Loading -> CircularProgressIndicator(Modifier.testTag("loading"))
            is ZoneState.Done -> when (val result = state.result) {
                is ZoneResult.Success -> ZoneList(result.zone)
                is ZoneResult.Failure -> Text(
                    failureLabel(result),
                    color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.testTag("error"),
                )
            }
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
