package site.lempert.taleart.taller

import kotlin.test.Test
import kotlin.test.assertEquals

class SharedCommonTest {

    @Test
    fun example() {
        assertEquals(3, 1 + 2)
    }

    @Test
    fun showsTheSdkVersion() {
        assertEquals("SDK 0.0.1", sdkVersionLabel())
    }

    @Test
    fun greetsByName() {
        assertEquals("Hello, TaleArt!", sayHello("TaleArt"))
    }
}
