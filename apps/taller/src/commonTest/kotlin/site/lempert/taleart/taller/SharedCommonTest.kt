package site.lempert.taleart.taller

import site.lempert.taleart.sdk.TaleartSdk
import kotlin.test.Test
import kotlin.test.assertEquals

class SharedCommonTest {

    @Test
    fun showsTheSdkVersion() {
        assertEquals("SDK ${TaleartSdk.VERSION}", sdkVersionLabel())
    }

    @Test
    fun greetsByName() {
        assertEquals("Hello, TaleArt!", sayHello("TaleArt"))
    }
}
