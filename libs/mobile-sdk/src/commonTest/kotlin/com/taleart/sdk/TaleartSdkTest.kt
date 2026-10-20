package com.taleart.sdk

import kotlin.test.Test
import kotlin.test.assertEquals

class TaleartSdkTest {
    @Test
    fun exposesVersion() {
        assertEquals("0.0.1", TaleartSdk.VERSION)
    }
}
