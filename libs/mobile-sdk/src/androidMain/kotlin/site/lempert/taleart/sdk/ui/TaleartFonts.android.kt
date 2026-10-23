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

@Composable
internal actual fun rememberPlatformHostFonts(): HostFontLookup {
    val context = LocalContext.current.applicationContext
    return remember(context) { AndroidHostFonts.of(context) }
}

/**
 * The fonts an Android app ships, by family name (story 9.8): `res/font/<name>` looked up by
 * resource name through the app's resources, else `assets/fonts/<name>.ttf` or `.otf`, the name
 * matched as [fontResourceName] makes it, with its faces by suffix ([FACE_SUFFIXES]). Each name is
 * looked up once per process; main thread only.
 */
internal class AndroidHostFonts(private val context: Context) : HostFontLookup {
    private val found = HashMap<String, FontFamily?>()

    // The font files in assets/fonts by their matched name (no extension).
    private val assetFonts: Map<String, String> by lazy {
        val files = runCatching { context.assets.list(ASSET_DIR)?.toList() }.getOrNull().orEmpty()
        files.filter { it.endsWith(".ttf", ignoreCase = true) || it.endsWith(".otf", ignoreCase = true) }
            .mapNotNull { file -> fontResourceName(file.substringBeforeLast('.'))?.let { it to file } }
            .toMap()
    }

    override fun find(name: String): FontFamily? {
        val key = fontResourceName(name) ?: return null
        if (key in found) return found[key]
        val family = fromResources(key) ?: fromAssets(key)
        found[key] = family
        return family
    }

    // getIdentifier is the only way to reach a resource by a name that comes from content.
    @SuppressLint("DiscouragedApi")
    private fun fromResources(key: String): FontFamily? {
        val resources = context.resources
        val fonts = FACE_SUFFIXES.mapNotNull { face ->
            val id = resources.getIdentifier(key + face.suffix, "font", context.packageName)
            if (id == 0) null else Font(id, FontWeight(face.weight), if (face.italic) FontStyle.Italic else FontStyle.Normal)
        }
        return fonts.toFamily()
    }

    private fun fromAssets(key: String): FontFamily? {
        val fonts = FACE_SUFFIXES.mapNotNull { face ->
            assetFonts[key + face.suffix]?.let { file ->
                Font("$ASSET_DIR/$file", context.assets, FontWeight(face.weight), if (face.italic) FontStyle.Italic else FontStyle.Normal)
            }
        }
        return fonts.toFamily()
    }

    // `_regular` beside the bare name is the same face: the first of them is kept.
    private fun List<Font>.toFamily(): FontFamily? =
        distinctBy { it.weight to it.style }.takeIf { it.isNotEmpty() }?.let { FontFamily(it) }

    companion object {
        private const val ASSET_DIR = "fonts"
        private var shared: AndroidHostFonts? = null

        /** The process's lookup, over the application context. */
        fun of(context: Context): AndroidHostFonts =
            shared?.takeIf { it.context === context } ?: AndroidHostFonts(context).also { shared = it }
    }
}
