package site.lempert.taleart.sdk.ui

import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals

// The bar's `layout` setting, read as bar.schema.json defines it: ring by default, an unknown or misspelt value is ring.
class BarLayoutSettingsTest {
    private fun json(text: String) = Json.parseToJsonElement(text)

    @Test
    fun aMissingLayoutIsRing() {
        assertEquals(BarLayout.Ring, BarSettings.read(null).layout)
        assertEquals(BarLayout.Ring, BarSettings.read(json("{}")).layout)
        assertEquals(BarLayout.Ring, BarSettings.read(json("[]")).layout)
    }

    @Test
    fun eachKnownLayoutIsKept() {
        for (layout in BarLayout.entries) {
            assertEquals(layout, BarSettings.read(json("""{"layout":"${layout.key}"}""")).layout, layout.key)
        }
        assertEquals(listOf("ring", "chip", "poster", "stack"), BarLayout.entries.map { it.key })
    }

    @Test
    fun anUnknownOrWrongTypedLayoutIsRing() {
        assertEquals(BarLayout.Ring, BarSettings.read(json("""{"layout":"tile"}""")).layout)
        assertEquals(BarLayout.Ring, BarSettings.read(json("""{"layout":"Poster"}""")).layout)
        assertEquals(BarLayout.Ring, BarSettings.read(json("""{"layout":null}""")).layout)
        assertEquals(BarLayout.Ring, BarSettings.read(json("""{"layout":3}""")).layout)
        assertEquals(BarLayout.Ring, BarSettings.read(json("""{"layout":["chip"]}""")).layout)
    }

    @Test
    fun theLayoutDoesNotChangeTheOtherSettings() {
        assertEquals(
            BarSettings(BarShape.RoundedSquare, BarSize.Large, false, BarAlignment.Center, 24, BarLayout.Stack),
            BarSettings.read(
                json("""{"layout":"stack","shape":"rounded-square","size":"large","showTitles":false,"alignment":"center","gap":24}"""),
            ),
        )
        assertEquals(BarSettings(layout = BarLayout.Chip), BarSettings.read(json("""{"layout":"chip","shape":"nope"}""")))
    }
}
