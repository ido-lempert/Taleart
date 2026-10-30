package site.lempert.taleart.sdk.targeting

import platform.Foundation.NSMutableArray
import platform.Foundation.NSNumber
import platform.Foundation.NSString
import platform.Foundation.create
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

// The values a Swift app passes in `properties` arrive as Foundation objects; they must read as the
// same values the Android host reads (strings, numbers, booleans, lists of strings).
class AudienceRuleIosTest {
    private fun cond(property: String, operator: String, value: Any? = null) = AudienceCondition(property, operator, value)

    @Test
    fun foundationNumbersReadAsNumbersAndBooleansAsBooleans() {
        val props = mapOf<String, Any?>(
            "age" to NSNumber(int = 30),
            "beta" to NSNumber(bool = true),
            "ratio" to NSNumber(double = 0.5),
        )
        val viewer = viewerPropertiesFrom(props)!!
        assertEquals(30.0, viewer["age"])
        assertEquals(true, viewer["beta"])
        assertEquals(0.5, viewer["ratio"])
        assertTrue(audienceRulePasses(AudienceRule("all", listOf(cond("age", "gte", 30.0))), props))
        assertFalse(audienceRulePasses(AudienceRule("all", listOf(cond("beta", "gt", 0.0))), props), "a boolean is not a number")
        assertTrue(audienceRulePasses(AudienceRule("all", listOf(cond("beta", "eq", true))), props))
    }

    @Test
    fun foundationStringsAndArraysReadAsStringsAndLists() {
        val segments = NSMutableArray()
        segments.addObject(NSString.create(string = "Beta"))
        segments.addObject(NSString.create(string = "vip"))
        val props = mapOf<String, Any?>(
            "plan" to NSString.create(string = "Pro"),
            "segments" to segments,
        )
        assertEquals("Pro", viewerPropertiesFrom(props)!!["plan"])
        assertEquals(listOf("Beta", "vip"), viewerPropertiesFrom(props)!!["segments"])
        assertTrue(audienceRulePasses(AudienceRule("all", listOf(cond("plan", "eq", "pro"))), props))
        assertTrue(audienceRulePasses(AudienceRule("any", listOf(cond("segments", "contains", "BETA"))), props))
    }
}
