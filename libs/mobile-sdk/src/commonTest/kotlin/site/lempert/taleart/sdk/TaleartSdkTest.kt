package site.lempert.taleart.sdk

import kotlin.test.Test
import kotlin.test.assertTrue

class TaleartSdkTest {
    @Test
    fun exposesASemanticVersion() {
        assertTrue(Regex("""\d+\.\d+\.\d+""").matches(TaleartSdk.VERSION), "VERSION was ${TaleartSdk.VERSION}")
    }
}
