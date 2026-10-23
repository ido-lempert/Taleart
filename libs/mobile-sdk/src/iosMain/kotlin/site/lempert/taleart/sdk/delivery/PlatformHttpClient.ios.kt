package site.lempert.taleart.sdk.delivery

import io.ktor.client.HttpClient
import io.ktor.client.engine.darwin.Darwin
import platform.Foundation.NSHTTPCookieAcceptPolicy

// NSURLSession sends and keeps cookies and caches responses by default; the Delivery API is read
// with the key alone (never a cookie), and the client's own ETag copy is the only cache.
actual fun platformHttpClient(): HttpClient = HttpClient(Darwin) {
    engine {
        configureSession {
            setHTTPShouldSetCookies(false)
            setHTTPCookieAcceptPolicy(NSHTTPCookieAcceptPolicy.NSHTTPCookieAcceptPolicyNever)
            setHTTPCookieStorage(null)
            setURLCache(null)
        }
    }
}
