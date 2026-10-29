package site.lempert.taleart.sdk.delivery

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.intOrNull

// The interactive components' responses (libs/contract/openapi/openapi.yaml: InteractiveResponse and
// its results; libs/contract/src/lib/interactive.ts). A poll's and a quiz's answer is a choice id, a
// Rating's a whole number from 0 to 100 as text, a Reaction's an emoji. Each result is checked again
// here, as the Web SDK checks it: a result that is no result of its kind is not drawn.

/** One choice's count and share (a whole percentage) of a poll's or quiz's votes. */
data class ChoiceCount(val id: String, val count: Int, val percent: Int)

/** One emoji's count of a Reaction. */
data class ReactionCount(val emoji: String, val count: Int)

/** A component's result as the Delivery API answers it, over its choices, its ratings or its emoji. */
sealed interface ResponseResult

/** A poll's or quiz's result: the votes in all and each choice's count and share, in the component's order. */
data class ChoiceResult(val total: Int, val choices: List<ChoiceCount>) : ResponseResult

/** A Rating's result: how many visitors rated it and their average on the 0 to 100 scale. */
data class RatingResult(val total: Int, val average: Int) : ResponseResult

/** A Reaction's result: the taps in all and each emoji's count, in the Reaction's order. */
data class ReactionResult(val total: Int, val reactions: List<ReactionCount>) : ResponseResult

/** A visitor's answer as the SDK keeps it: the value it stored and the result the server gave with it. */
internal data class StoredResponse(val value: String, val result: ResponseResult)

/**
 * What `POST /delivery/v1/responses` answers: the visitor's stored answer for the element (the first
 * one, so a repeat answers it again with `recorded` false) and the component's result now.
 */
data class InteractiveResponse(val elementId: String, val value: String, val recorded: Boolean, val result: ResponseResult)

/**
 * The outcome of posting an answer: [Answered] when the server accepted it (recorded or a repeat), or
 * [Failed] with the API's message, or the status when the API refused it (`status` is null for a
 * network failure or a closed client).
 */
sealed interface ResponseOutcome {
    data class Answered(val response: InteractiveResponse) : ResponseOutcome
    data class Failed(val message: String, val status: Int?) : ResponseOutcome
}

// A count: a whole number, never negative.
private fun JsonElement?.countOrNull(): Int? = (this as? JsonPrimitive)?.takeIf { !it.isString }?.intOrNull?.takeIf { it >= 0 }

// A whole percentage: 0 to 100.
private fun JsonElement?.percentOrNull(): Int? = (this as? JsonPrimitive)?.takeIf { !it.isString }?.intOrNull?.takeIf { it in 0..100 }

/**
 * A result read from its JSON: a poll's or quiz's (`choices`), a Reaction's (`reactions`) or a
 * Rating's (`average`), each checked; null for anything else.
 */
internal fun parseResponseResult(json: JsonElement?): ResponseResult? {
    val obj = json as? JsonObject ?: return null
    val total = obj["total"].countOrNull() ?: return null
    obj["choices"]?.let { raw ->
        val choices = (raw as? JsonArray)?.map { c ->
            val o = c as? JsonObject ?: return null
            val id = (o["id"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: return null
            ChoiceCount(id, o["count"].countOrNull() ?: return null, o["percent"].percentOrNull() ?: return null)
        } ?: return null
        return ChoiceResult(total, choices)
    }
    obj["reactions"]?.let { raw ->
        val reactions = (raw as? JsonArray)?.map { r ->
            val o = r as? JsonObject ?: return null
            val emoji = (o["emoji"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: return null
            ReactionCount(emoji, o["count"].countOrNull() ?: return null)
        } ?: return null
        return ReactionResult(total, reactions)
    }
    val average = obj["average"].percentOrNull() ?: return null
    return RatingResult(total, average)
}

/** A result as its JSON, the shape [parseResponseResult] reads back. */
internal fun responseResultJson(result: ResponseResult): JsonObject = when (result) {
    is ChoiceResult -> JsonObject(
        mapOf(
            "total" to JsonPrimitive(result.total),
            "choices" to JsonArray(result.choices.map { c ->
                JsonObject(mapOf("id" to JsonPrimitive(c.id), "count" to JsonPrimitive(c.count), "percent" to JsonPrimitive(c.percent)))
            }),
        ),
    )
    is ReactionResult -> JsonObject(
        mapOf(
            "total" to JsonPrimitive(result.total),
            "reactions" to JsonArray(result.reactions.map { r ->
                JsonObject(mapOf("emoji" to JsonPrimitive(r.emoji), "count" to JsonPrimitive(r.count)))
            }),
        ),
    )
    is RatingResult -> JsonObject(mapOf("total" to JsonPrimitive(result.total), "average" to JsonPrimitive(result.average)))
}

/** The answer a `POST /delivery/v1/responses` body carries, or null when it is not one. */
internal fun parseInteractiveResponse(body: JsonObject?): InteractiveResponse? {
    val obj = body ?: return null
    val elementId = (obj["elementId"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: return null
    val value = (obj["value"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: return null
    val recorded = (obj["recorded"] as? JsonPrimitive)?.takeIf { !it.isString }?.booleanOrNull ?: return null
    val result = parseResponseResult(obj["result"]) ?: return null
    return InteractiveResponse(elementId, value, recorded, result)
}
