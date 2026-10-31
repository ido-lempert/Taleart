package site.lempert.taleart.sdk.delivery

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject

/**
 * The outcome of reading a zone from JSON the app holds (no backend): the zone, or the list of what is
 * wrong with the text. The input is exactly the body of `GET /delivery/v1/zone`, as the Web SDK's
 * `parseZoneJson` takes it. See `TaleartSdk.parseZoneJson`.
 */
sealed interface ZoneParse {
    /** The zone, read and checked as a zone read from the Delivery API is. */
    data class Success(val zone: DeliveryZone) : ZoneParse

    /** The text is no zone; [errors] say why, one readable line each (never empty). */
    data class Failure(val errors: List<String>) : ZoneParse {
        /** All errors in one line, the message a failed read logs. */
        val message: String get() = "The zone JSON is not valid: " + errors.joinToString("; ")
    }
}

/** Reads [json], the body of `GET /delivery/v1/zone`, into a zone; never throws. */
internal fun parseZoneJsonText(json: String): ZoneParse {
    if (json.isBlank()) return ZoneParse.Failure(listOf("The zone JSON is empty"))
    val root = try {
        Json.parseToJsonElement(json)
    } catch (e: Exception) {
        return ZoneParse.Failure(listOf("Not valid JSON: ${(e.message ?: e.toString()).lineSequence().first()}"))
    }
    if (root !is JsonObject) return ZoneParse.Failure(listOf("The zone must be a JSON object (the body of GET /delivery/v1/zone)"))
    val errors = mutableListOf<String>()
    val frame = root["frame"]
    when {
        frame == null -> errors += "\"frame\" is missing (an object, or null for a zone without a display)"
        frame !is JsonObject && frame !is JsonNull -> errors += "\"frame\" must be an object or null"
    }
    val groups = root["taleGroups"]
    if (groups == null) {
        errors += "\"taleGroups\" is missing (a list of tale groups)"
    } else if (groups !is JsonArray) {
        errors += "\"taleGroups\" must be a list"
    } else {
        groups.forEachIndexed { index, group ->
            when {
                group !is JsonObject -> errors += "taleGroups[$index] must be an object"
                group["tales"] !is JsonArray -> errors += "taleGroups[$index].tales must be a list"
            }
        }
    }
    if (errors.isNotEmpty()) return ZoneParse.Failure(errors)
    return try {
        ZoneParse.Success(readZone(root))
    } catch (e: Exception) {
        ZoneParse.Failure(listOf("The zone could not be read: ${e.message ?: e.toString()}"))
    }
}
