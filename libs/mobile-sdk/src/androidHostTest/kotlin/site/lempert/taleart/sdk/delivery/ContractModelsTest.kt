package site.lempert.taleart.sdk.delivery

import kotlinx.serialization.KSerializer
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

// The hand-written Delivery models against the contract's OpenAPI spec (libs/contract/openapi),
// which the Web SDK's types are generated from: every model has exactly the schema's fields, so a
// field added to or renamed in the contract fails here until the models follow.
class ContractModelsTest {
    private val spec: List<String> by lazy {
        val workingDir = File(System.getProperty("user.dir") ?: ".").absoluteFile
        var dir: File? = workingDir
        while (dir != null && !File(dir, SPEC).isFile) dir = dir.parentFile
        File(checkNotNull(dir) { "$SPEC not found above $workingDir" }, SPEC).readLines()
    }

    // The property names and the `required` list of a schema under components/schemas.
    private fun schema(name: String): Pair<Set<String>, Set<String>> {
        val start = spec.indexOf("    $name:")
        assertTrue(start >= 0, "schema $name is in the spec")
        val block = spec.drop(start + 1).takeWhile { it.isBlank() || it.startsWith("     ") }
        val required = block.firstOrNull { it.startsWith("      required: [") }
            ?.substringAfter('[')?.substringBefore(']')?.split(',')?.map { it.trim() }?.toSet().orEmpty()
        val properties = block.dropWhile { it != "      properties:" }.drop(1)
            .takeWhile { it.isBlank() || it.startsWith("        ") }
            .mapNotNull { Regex("""^ {8}([A-Za-z0-9_]+):""").find(it)?.groupValues?.get(1) }
            .toSet()
        return properties to required
    }

    private fun check(name: String, serializer: KSerializer<*>) {
        val (properties, required) = schema(name)
        val fields = (0 until serializer.descriptor.elementsCount).map(serializer.descriptor::getElementName).toSet()
        assertEquals(properties, fields, "the fields of $name")
        assertTrue(fields.containsAll(required), "$name has every required field $required")
    }

    @Test
    fun theZoneMatchesDeliveryZone() = check("DeliveryZone", DeliveryZone.serializer())

    @Test
    fun theDisplayMatchesDeliveryFrame() = check("DeliveryFrame", DeliveryFrame.serializer())

    @Test
    fun theTaleGroupMatchesDeliveryTaleGroup() = check("DeliveryTaleGroup", DeliveryTaleGroup.serializer())

    @Test
    fun theTaleMatchesDeliveryTale() = check("DeliveryTale", DeliveryTale.serializer())

    @Test
    fun theMediaMatchesDeliveryMedia() = check("DeliveryMedia", DeliveryMedia.serializer())

    @Test
    fun theCoverMatchesDeliveryCover() = check("DeliveryCover", DeliveryCover.serializer())

    @Test
    fun theFontMatchesDeliveryFont() = check("DeliveryFont", DeliveryFont.serializer())

    private companion object {
        const val SPEC = "libs/contract/openapi/openapi.yaml"
    }
}
