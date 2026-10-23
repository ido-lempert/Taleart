package site.lempert.taleart.sdk.delivery

import android.content.Context
import io.ktor.client.HttpClient
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import site.lempert.taleart.sdk.TaleartSdk
import site.lempert.taleart.sdk.storage.deviceKeyValueStore

/**
 * A [DeliveryClient] that keeps the device's visitor id in the SDK's own store from its first
 * request, before any composable has run: the `taleart-sdk` SharedPreferences of [context]'s app.
 * Use it, or call [init] once (for example in `Application.onCreate`), when the app reads zones
 * before showing a TaleArt composable; otherwise the first requests of a process may carry an id
 * that lasts only until the store is opened.
 */
fun DeliveryClient(
    context: Context,
    httpClient: HttpClient = platformHttpClient(),
    dispatcher: CoroutineDispatcher = Dispatchers.Default,
): DeliveryClient {
    val store = deviceKeyValueStore(context)
    return DeliveryClient(httpClient, dispatcher) { store }
}

/**
 * Opens the SDK's own device store for [context]'s app, so [TaleartSdk.sharedClient] and every
 * [DeliveryClient] made without a store send the persisted visitor id from their first request.
 * Safe to call more than once; Compose code needs no call, as the composables open the store.
 */
fun TaleartSdk.init(context: Context) {
    deviceKeyValueStore(context)
}
