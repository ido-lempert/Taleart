package site.lempert.taleart.sdk.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.platform.Font
import cnames.structs.__CTFont
import kotlinx.cinterop.BetaInteropApi
import kotlinx.cinterop.ExperimentalForeignApi
import kotlinx.cinterop.readBytes
import kotlinx.cinterop.reinterpret
import platform.CoreFoundation.CFRelease
import platform.CoreText.CTFontCopyAttribute
import platform.CoreText.kCTFontURLAttribute
import platform.Foundation.CFBridgingRelease
import platform.Foundation.CFBridgingRetain
import platform.Foundation.NSBundle
import platform.Foundation.NSData
import platform.Foundation.NSFileManager
import platform.Foundation.NSFileSize
import platform.Foundation.NSNumber
import platform.Foundation.NSURL
import platform.Foundation.dataWithContentsOfFile
import platform.UIKit.UIFont
import platform.UIKit.UIFontDescriptorTraitItalic
import platform.UIKit.UIFontDescriptorTraitsAttribute
import platform.UIKit.UIFontWeightTrait

@Composable
internal actual fun rememberPlatformHostFonts(): HostFontLookup = IosHostFonts.shared

/** A face of an installed family: the file it is in, its weight and italic. */
internal data class HostFace(val faceName: String, val path: String, val weight: Int, val italic: Boolean)

/**
 * The fonts an iOS app ships, by family name (story 9.8): the fonts it registered (`UIAppFonts`) or
 * that otherwise lie inside its main bundle, never fonts iOS itself has. [faces] lists a family's
 * faces (case-insensitive family name) and [read] a font file's bytes. Compose draws through Skia,
 * which takes a face's bytes: each file is read once (shared by the faces in it) and only when a
 * name first resolves to it; a collection (`.ttc`, `.otc`) or a file over [MAX_HOST_FONT_BYTES]
 * is skipped. Each name is looked up once; main thread only.
 */
internal class IosHostFonts(
    private val faces: (familyKey: String) -> List<HostFace>,
    private val size: (path: String) -> Long?,
    private val read: (path: String) -> ByteArray?,
) : HostFontLookup {
    private val found = HashMap<String, FontFamily?>()
    private val files = HashMap<String, ByteArray?>()

    override fun find(name: String): FontFamily? {
        val key = fontKey(name)
        if (key.isEmpty()) return null
        if (key in found) return found[key]
        val family = runCatching { load(key) }.getOrNull()
        found[key] = family
        return family
    }

    private fun load(key: String): FontFamily? {
        val fonts = faces(key).mapNotNull { face ->
            val bytes = bytesOf(face.path) ?: return@mapNotNull null
            Font(
                identity = "taleart-host-font-${face.faceName}",
                data = bytes,
                weight = FontWeight(face.weight),
                style = if (face.italic) FontStyle.Italic else FontStyle.Normal,
            )
        }.distinctBy { it.weight to it.style }
        return if (fonts.isEmpty()) null else FontFamily(fonts)
    }

    // A file's bytes, read once whatever number of faces it holds; null for one not to read.
    private fun bytesOf(path: String): ByteArray? {
        if (path in files) return files[path]
        val lower = path.lowercase()
        val bytes = when {
            lower.endsWith(".ttc") || lower.endsWith(".otc") -> null
            (size(path) ?: Long.MAX_VALUE) > MAX_HOST_FONT_BYTES -> null
            else -> read(path)
        }
        files[path] = bytes
        return bytes
    }

    companion object {
        /** The process's lookup, over the app's own fonts. */
        val shared: IosHostFonts by lazy { IosHostFonts(::bundleFaces, ::fileSize, ::readFile) }
    }
}

// The faces of the family named by [familyKey] whose files lie in the app's main bundle.
private fun bundleFaces(familyKey: String): List<HostFace> {
    val bundle = (resolved(NSURL.fileURLWithPath(NSBundle.mainBundle.bundlePath)) ?: return emptyList()).trimEnd('/') + "/"
    val family = UIFont.familyNames.filterIsInstance<String>().firstOrNull { fontKey(it) == familyKey } ?: return emptyList()
    return UIFont.fontNamesForFamilyName(family).filterIsInstance<String>().mapNotNull { faceName ->
        val font = UIFont.fontWithName(faceName, 12.0) ?: return@mapNotNull null
        val path = fileOf(font)?.let(::resolved) ?: return@mapNotNull null
        if (!path.startsWith(bundle)) return@mapNotNull null
        @Suppress("UNCHECKED_CAST")
        val traits = font.fontDescriptor.objectForKey(UIFontDescriptorTraitsAttribute) as? Map<Any?, Any?>
        val weight = (traits?.get(UIFontWeightTrait) as? NSNumber)?.doubleValue ?: 0.0
        HostFace(faceName, path, cssWeight(weight), font.fontDescriptor.symbolicTraits and UIFontDescriptorTraitItalic != 0u)
    }
}

// A file URL's path with its symbolic links resolved (/var is /private/var on a device).
private fun resolved(url: NSURL): String? = (url.URLByResolvingSymlinksInPath ?: url).path

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

@OptIn(ExperimentalForeignApi::class)
private fun fileSize(path: String): Long? =
    (NSFileManager.defaultManager.attributesOfItemAtPath(path, null)?.get(NSFileSize) as? NSNumber)?.longLongValue

@OptIn(ExperimentalForeignApi::class)
private fun readFile(path: String): ByteArray? {
    val data = NSData.dataWithContentsOfFile(path) ?: return null
    return data.bytes?.readBytes(data.length.toInt())
}

/**
 * The CSS weight of a UIKit weight trait (-1 to 1): the nearest of UIFont.Weight's values
 * (ultraLight -0.8 is 100, regular 0 is 400, bold 0.4 is 700, black 0.62 is 900).
 */
internal fun cssWeight(trait: Double): Int {
    val steps = listOf(-0.8 to 100, -0.6 to 200, -0.4 to 300, 0.0 to 400, 0.23 to 500, 0.3 to 600, 0.4 to 700, 0.56 to 800, 0.62 to 900)
    return steps.minBy { kotlin.math.abs(it.first - trait) }.second
}
