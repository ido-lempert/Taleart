package site.lempert.taleart.sdk.targeting

import kotlinx.serialization.json.Json
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals

// The copy of the shared audience-rule table in commonTest (AudienceRuleCases.kt) must match the contract's
// file, so every SDK runs the same cases. The file is found above the working directory, as ContractModelsTest does.
class AudienceRuleCasesSyncTest {
    @Test
    fun theCopyMatchesTheContractsTable() {
        val workingDir = File(System.getProperty("user.dir") ?: ".").absoluteFile
        var dir: File? = workingDir
        while (dir != null && !File(dir, CASES).isFile) dir = dir.parentFile
        val contract = File(checkNotNull(dir) { "$CASES not found above $workingDir" }, CASES).readText()
        // Parsed on both sides, so the layout of the copy does not matter, only its content.
        assertEquals(Json.parseToJsonElement(contract), Json.parseToJsonElement(AUDIENCE_RULE_CASES_JSON))
    }

    private companion object {
        const val CASES = "libs/contract/targeting/audience-rule.cases.json"
    }
}
