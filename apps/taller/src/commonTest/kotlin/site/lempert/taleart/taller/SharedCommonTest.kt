package site.lempert.taleart.taller

import site.lempert.taleart.sdk.TaleartSdk
import site.lempert.taleart.sdk.delivery.ZoneResult
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class SharedCommonTest {

    @Test
    fun showsTheSdkVersion() {
        assertEquals("SDK ${TaleartSdk.VERSION}", sdkVersionLabel())
    }

    @Test
    fun greetsByName() {
        assertEquals("Hello, TaleArt!", sayHello("TaleArt"))
    }

    @Test
    fun startsWithTheLocalApiAndKeepsWhatIsSaved() {
        val store = InMemoryStore()
        val fresh = DebugSettings.load(store)
        assertEquals(defaultApiUrl(), fresh.apiUrl)
        assertTrue(fresh.apiUrl.endsWith(":$DEFAULT_API_PORT"))
        assertFalse(fresh.complete)
        DebugSettings(" http://localhost:3592 ", "tak_key").save(store)
        assertEquals(DebugSettings("http://localhost:3592", "tak_key"), DebugSettings.load(store))
        assertTrue(DebugSettings.load(store).complete)
    }

    @Test
    fun namesEachFailureByItsType() {
        assertEquals("Invalid site key or zone: m", failureLabel(ZoneResult.InvalidSiteKey("m")))
        assertEquals("Unknown zone: m", failureLabel(ZoneResult.UnknownZone("m", "zone_not_found")))
        assertEquals("Rate limited: m (try again in 2 s)", failureLabel(ZoneResult.RateLimited("m", 2)))
        assertEquals("Rate limited: m", failureLabel(ZoneResult.RateLimited("m", null)))
        assertEquals("Offline: m", failureLabel(ZoneResult.Offline("m", null)))
        assertEquals("Server error 500: m", failureLabel(ZoneResult.ServerError("m", 500, null)))
        assertEquals("Invalid response: m", failureLabel(ZoneResult.InvalidResponse("m", 200)))
    }
}
