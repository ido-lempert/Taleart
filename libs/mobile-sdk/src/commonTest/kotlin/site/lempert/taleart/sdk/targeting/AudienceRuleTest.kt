package site.lempert.taleart.sdk.targeting

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import site.lempert.taleart.sdk.delivery.readZone
import site.lempert.taleart.sdk.delivery.audienceRuleFrom
import site.lempert.taleart.sdk.delivery.jsonValue
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

// The audience rule's shared table (libs/contract/targeting/audience-rule.cases.json, copied in
// AudienceRuleCases.kt), run here as the Web SDK runs it: a case holds when the rule's answer equals `passes`.
class AudienceRuleTest {
    private val table = Json.parseToJsonElement(AUDIENCE_RULE_CASES_JSON).jsonObject["cases"]!!.jsonArray

    private fun cond(property: String, operator: String, value: Any? = NO_VALUE) =
        AudienceCondition(property, operator, if (value === NO_VALUE) null else value)

    private fun rule(match: String, vararg conditions: AudienceCondition) = AudienceRule(match, conditions.toList())

    private fun props(vararg pairs: Pair<String, Any?>) = mapOf(*pairs)

    @Test
    fun theSharedTableHasEnoughCasesWithUniqueNames() {
        assertTrue(table.size >= 60, "at least 60 cases, got ${table.size}")
        assertEquals(table.size, table.map { it.jsonObject["name"]!!.jsonPrimitive.content }.toSet().size)
    }

    @Test
    fun everySharedCaseHolds() {
        for (element in table) {
            val case = element.jsonObject
            val name = case["name"]!!.jsonPrimitive.content
            val rule = case["rule"].takeUnless { it == null || it is JsonNull }?.let { audienceRuleFrom(it.jsonObject) }
            val properties = case["properties"].takeUnless { it == null || it is JsonNull }?.jsonObject?.mapValues { jsonValue(it.value) }
            val passes = case["passes"]!!.jsonPrimitive.content == "true"
            assertEquals(passes, audienceRulePasses(rule, properties), name)
            // The same answer from the properties normalised once, as the SDK keeps them.
            assertEquals(passes, audienceRulePasses(rule, viewerPropertiesFrom(properties)), "$name (normalised)")
        }
    }

    @Test
    fun aRuleWithNoConditionsOrNoPropertiesPasses() {
        assertTrue(audienceRulePasses(null, null))
        assertTrue(audienceRulePasses(rule("all"), props("plan" to "pro")))
        assertFalse(audienceRulePasses(rule("all", cond("plan", "eq", "pro")), props()))
    }

    @Test
    fun anUnknownOperatorFailsClosed() {
        assertFalse(audienceRulePasses(rule("all", cond("plan", "regex", "p.*")), props("plan" to "pro")))
    }

    @Test
    fun aMissingPropertyIsLeftOutOfTheNegatedTestsOnly() {
        assertTrue(audienceRulePasses(rule("all", cond("plan", "neq", "pro")), props("other" to 1.0)))
        assertTrue(audienceRulePasses(rule("all", cond("plan", "notIn", listOf("pro"))), props("other" to 1.0)))
        assertTrue(audienceRulePasses(rule("all", cond("plan", "notExists")), props("other" to 1.0)))
        assertFalse(audienceRulePasses(rule("all", cond("plan", "gt", 1.0)), props("other" to 1.0)))
    }

    @Test
    fun aNumberFromTheAppCountsAsTheSameNumberAsInTheRule() {
        assertTrue(audienceRulePasses(rule("all", cond("age", "gte", 30.0)), props("age" to 30)))
        assertTrue(audienceRulePasses(rule("all", cond("age", "eq", 30.0)), props("age" to 30L)))
        assertTrue(audienceRulePasses(rule("all", cond("age", "lt", 31.5)), props("age" to 30.25f)))
    }

    @Test
    fun propertyNamesAreCaseSensitive() {
        assertFalse(audienceRulePasses(rule("all", cond("Plan", "eq", "pro")), props("plan" to "pro")))
        assertTrue(audienceRulePasses(rule("all", cond("plan", "eq", "PRO")), props("plan" to "pro")))
    }

    @Test
    fun viewerPropertiesKeepValidEntriesAndDropTheRest() {
        val kept = viewerPropertiesFrom(
            mapOf(
                "plan" to "pro",
                "age" to 30,
                "beta" to false,
                "segments" to listOf("a", "b"),
                "empty" to emptyList<String>(),
                "nothing" to null,
                "object" to mapOf("a" to 1),
                "1bad" to "x",
                "has space" to "x",
                "nan" to Double.NaN,
                "inf" to Double.POSITIVE_INFINITY,
                "mixed" to listOf("a", 2),
                "long" to "a".repeat(257),
            ),
        )
        assertEquals(mapOf("plan" to "pro", "age" to 30.0, "beta" to false, "segments" to listOf("a", "b"), "empty" to emptyList<String>()), kept)
        assertNull(viewerPropertiesFrom(null))
    }

    @Test
    fun theFirstFiftyValidPropertiesCountInOrder() {
        val input = LinkedHashMap<String, Any?>()
        repeat(5) { input["bad ${it}"] = it }
        repeat(60) { input["p$it"] = it.toDouble() }
        val kept = viewerPropertiesFrom(input)!!
        assertEquals(50, kept.size)
        assertEquals("p0", kept.keys.first())
        assertFalse(kept.containsKey("p50"))
    }

    @Test
    fun aGroupWithoutAnAudienceFieldShowsAndAnAudienceRuleIsRead() {
        val zone = """{"id":"z","name":"Z","slug":"s","frame":null,"taleGroups":[
            {"id":"g1","name":"Plain","tales":[]},
            {"id":"g2","name":"Pro","tales":[],"audience":{"match":"all","conditions":[{"property":"plan","operator":"eq","value":"pro"}]}},
            {"id":"g3","name":"Odd","tales":[],"audience":{"match":"any","conditions":["not an object"]}}
        ]}"""
        val groups = readZone(Json.parseToJsonElement(zone).jsonObject).taleGroups
        assertNull(groups[0].audience)
        assertEquals(rule("all", cond("plan", "eq", "pro")), groups[1].audience)
        // A condition that is not an object fails closed, so its group never shows to anyone.
        assertFalse(audienceRulePasses(groups[2].audience, props("plan" to "pro")))
    }

    @Test
    fun jsonArraysKeepTheirItemsAsValues() {
        assertEquals(listOf("a", 2.0, true), (jsonValue(JsonArray(listOf(Json.parseToJsonElement("\"a\""), Json.parseToJsonElement("2"), Json.parseToJsonElement("true")))) as List<*>))
    }

    private companion object {
        val NO_VALUE = Any()
    }
}
