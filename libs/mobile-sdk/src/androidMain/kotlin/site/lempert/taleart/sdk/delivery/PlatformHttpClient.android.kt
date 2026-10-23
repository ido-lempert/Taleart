package site.lempert.taleart.sdk.delivery

import io.ktor.client.HttpClient
import io.ktor.client.engine.okhttp.OkHttp

// OkHttp keeps no cookies and no HTTP cache unless asked to: the client's own ETag copy is the only cache.
actual fun platformHttpClient(): HttpClient = HttpClient(OkHttp)
