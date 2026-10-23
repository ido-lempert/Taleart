package site.lempert.taleart.sdk.ui

import android.annotation.SuppressLint
import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import java.util.Locale

@Composable
internal actual fun rememberPlatformHostFonts(): HostFontLookup {
    val context = LocalContext.current.applicationContext
    return remember(context) { AndroidHostFonts.of(context) }
}

/**
 * The font the app installed under the family [name], as the SDK draws content that names it
 * ([TaleartFonts]): a registered family first, then `res/font` and `assets/fonts`. Null when the
 * app has none; content naming it then draws in its fallback. For hosts checking their fonts.
 */
fun TaleartFonts.findInstalled(context: Context, name: String): FontFamily? =
    registered(name) ?: AndroidHostFonts.of(context.applicationContext).find(name)

/**
 * The fonts an Android app ships, by family name (story 9.8): `res/font/<resource name>` through
 * the app's resources ([fontResourceName]), else `assets/fonts/<name>.ttf` or `.otf` (the family in
 * any case, Unicode allowed, or its resource name); faces by suffix ([FACE_SUFFIXES]) only when the
 * bare name has no font. Each name is looked up once per process; main thread only.
 */
internal class AndroidHostFonts(private val context: Context) : HostFontLookup {
    private val found = HashMap<String, FontFamily?>()

    // The font files in assets/fonts by their base name in lower case.
    private val assetFonts: Map<String, String> by lazy {
        val files = runCatching { context.assets.list(ASSET_DIR)?.toList() }.getOrNull().orEmpty()
        files.filter { it.endsWith(".ttf", ignoreCase = true) || it.endsWith(".otf", ignoreCase = true) }
            .associateBy { it.substringBeforeLast('.').lowercase(Locale.ROOT) }
    }

    override fun find(name: String): FontFamily? {
        val key = fontKey(name)
        if (key.isEmpty()) return null
        if (key in found) return found[key]
        val family = runCatching { lookUp(key) }.getOrNull()
        found[key] = family
        return family
    }

    private fun lookUp(key: String): FontFamily? {
        val resource = fontResourceName(key)
        // The bare name first: a font file, or an XML font family with its own faces.
        resource?.let(::resourceId)?.let { return FontFamily(Font(it)) }
        val assetNames = listOfNotNull(key, key.replace(" ", ""), resource).distinct()
        assetNames.firstNotNullOfOrNull { assetFonts[it] }?.let { return FontFamily(Font("$ASSET_DIR/$it", context.assets)) }
        // Only then the faces by suffix.
        val faces = FACE_SUFFIXES.mapNotNull { face ->
            val weight = FontWeight(face.weight)
            val style = if (face.italic) FontStyle.Italic else FontStyle.Normal
            resource?.let { resourceId(it + face.resource) }?.let { Font(it, weight, style) }
                ?: assetNames.firstNotNullOfOrNull { assetFonts[it + face.asset] ?: assetFonts[it + face.resource] }
                    ?.let { Font("$ASSET_DIR/$it", context.assets, weight, style) }
        }
        return faces.takeIf { it.isNotEmpty() }?.let { FontFamily(it) }
    }

    // getIdentifier is the only way to reach a resource by a name that comes from content.
    @SuppressLint("DiscouragedApi")
    private fun resourceId(name: String): Int? =
        context.resources.getIdentifier(name, "font", context.packageName).takeIf { it != 0 }

    companion object {
        private const val ASSET_DIR = "fonts"
        private var shared: AndroidHostFonts? = null

        /** The process's lookup, over the application context. */
        fun of(context: Context): AndroidHostFonts =
            shared?.takeIf { it.context === context } ?: AndroidHostFonts(context).also { shared = it }
    }
}
