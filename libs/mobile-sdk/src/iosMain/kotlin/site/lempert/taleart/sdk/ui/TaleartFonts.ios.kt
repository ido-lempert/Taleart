package site.lempert.taleart.sdk.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.platform.Font
import kotlinx.cinterop.BetaInteropApi
import kotlinx.cinterop.ExperimentalForeignApi
import kotlinx.cinterop.readBytes
import kotlinx.cinterop.reinterpret
import platform.CoreFoundation.CFRelease
import platform.CoreText.CTFontCopyAttribute
import cnames.structs.__CTFont
import platform.CoreText.kCTFontURLAttribute
import platform.Foundation.CFBridgingRelease
import platform.Foundation.CFBridgingRetain
import platform.Foundation.NSData
import platform.Foundation.NSNumber
import platform.Foundation.NSURL
import platform.Foundation.dataWithContentsOfURL
import platform.UIKit.UIFont
import platform.UIKit.UIFontDescriptorTraitItalic
import platform.UIKit.UIFontDescriptorTraitsAttribute
import platform.UIKit.UIFontWeightTrait

@Composable
internal actual fun rememberPlatformHostFonts(): HostFontLookup = IosHostFonts

/**
 * The fonts an iOS app can draw by family name (story 9.8): the fonts it registered (`UIAppFonts`
 * in Info.plist), and those iOS has, by their family name in any case (else by a face's own name,
 * as `UIFont(name:)` takes it). Compose draws through Skia, which takes a face's file: each face's
 * file is found through CoreText (`kCTFontURLAttribute`) and read once, then made a Compose font of
 * its weight and style. Each name is looked up once per process; main thread only.
 */
internal object IosHostFonts : HostFontLookup {
    private val found = HashMap<String, FontFamily?>()

    override fun find(name: String): FontFamily? {
        val key = fontKey(name)
        if (key.isEmpty()) return null
        if (key in found) return found[key]
        val family = runCatching { load(name, key) }.getOrNull()
        found[key] = family
        return family
    }

    private fun load(name: String, key: String): FontFamily? {
        val familyName = UIFont.familyNames.filterIsInstance<String>().firstOrNull { fontKey(it) == key }
        val faces = if (familyName != null) UIFont.fontNamesForFamilyName(familyName).filterIsInstance<String>()
        else listOfNotNull(UIFont.fontWithName(name.trim().trim('"', '\''), 12.0)?.fontName)
        val fonts = faces.mapNotNull(::face).distinctBy { it.weight to it.style }
        return if (fonts.isEmpty()) null else FontFamily(fonts)
    }

    @OptIn(ExperimentalForeignApi::class)
    private fun face(faceName: String): Font? {
        val font = UIFont.fontWithName(faceName, 12.0) ?: return null
        val url = fileOf(font) ?: return null
        val data = NSData.dataWithContentsOfURL(url) ?: return null
        val length = data.length.toInt()
        val bytes = data.bytes?.readBytes(length) ?: return null
        val traits = font.fontDescriptor.symbolicTraits
        @Suppress("UNCHECKED_CAST")
        val traitValues = font.fontDescriptor.objectForKey(UIFontDescriptorTraitsAttribute) as? Map<Any?, Any?>
        val weight = (traitValues?.get(UIFontWeightTrait) as? NSNumber)?.doubleValue ?: 0.0
        return Font(
            identity = "taleart-host-font-$faceName",
            data = bytes,
            weight = FontWeight(cssWeight(weight)),
            style = if (traits and UIFontDescriptorTraitItalic != 0u) FontStyle.Italic else FontStyle.Normal,
        )
    }

    // A UIFont is a CTFont (toll-free bridged): its file's URL.
    @OptIn(ExperimentalForeignApi::class, BetaInteropApi::class)
    private fun fileOf(font: UIFont): NSURL? {
        val ref = CFBridgingRetain(font) ?: return null
        return try {
            val attribute = CTFontCopyAttribute(ref.reinterpret<__CTFont>(), kCTFontURLAttribute) ?: return null
            CFBridgingRelease(attribute) as? NSURL
        } finally {
            CFRelease(ref)
        }
    }
}

/**
 * The CSS weight of a UIKit weight trait (-1 to 1): the nearest of UIFont.Weight's values
 * (ultraLight -0.8 is 100, regular 0 is 400, bold 0.4 is 700, black 0.62 is 900).
 */
internal fun cssWeight(trait: Double): Int {
    val steps = listOf(-0.8 to 100, -0.6 to 200, -0.4 to 300, 0.0 to 400, 0.23 to 500, 0.3 to 600, 0.4 to 700, 0.56 to 800, 0.62 to 900)
    return steps.minBy { kotlin.math.abs(it.first - trait) }.second
}
