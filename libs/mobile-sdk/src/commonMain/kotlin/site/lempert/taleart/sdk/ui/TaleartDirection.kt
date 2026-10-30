package site.lempert.taleart.sdk.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.unit.LayoutDirection
import site.lempert.taleart.sdk.TaleartSdk

/**
 * The layout direction a configured value asks for: `ltr` or `rtl` (any case, spaces trimmed), else null,
 * which means the platform's own direction. `TaleartConfig.layoutDirection` is read through it.
 */
internal fun layoutDirectionOf(value: String?): LayoutDirection? = when (value?.trim()?.lowercase()) {
    "ltr" -> LayoutDirection.Ltr
    "rtl" -> LayoutDirection.Rtl
    else -> null
}

/**
 * Lays [content] out in the direction `TaleartConfig.layoutDirection` asks for; with none set it is the
 * platform's (the composition's own [LocalLayoutDirection]). Every SDK view that lays out tales wraps its
 * content in it, so the bar, the banner, the poll and rating, and the viewer follow one setting.
 */
@Composable
internal fun ProvideTaleartDirection(content: @Composable () -> Unit) {
    val configured = remember(TaleartSdk.config) { layoutDirectionOf(TaleartSdk.config.layoutDirection) }
    if (configured == null) content() else CompositionLocalProvider(LocalLayoutDirection provides configured, content = content)
}

/**
 * The host's layout direction, as the canvas sees it: the canvas lays its boxes out left to right whatever the
 * host is, so the components that lay their own content out (a poll's halves, a rating's track) read the host's
 * direction here and provide it to their content with [HostDirection].
 */
internal val LocalHostLayoutDirection = staticCompositionLocalOf { LayoutDirection.Ltr }

/** Lays [content] out in the host's direction ([LocalHostLayoutDirection]), inside a canvas that places left to right. */
@Composable
internal fun HostDirection(content: @Composable () -> Unit) {
    CompositionLocalProvider(LocalLayoutDirection provides LocalHostLayoutDirection.current, content = content)
}

/**
 * Lays [content] out left to right whatever the direction around it, for text and numbers that stay
 * left to right: a countdown's digits, a promo code, a percentage (`dir="ltr"` in the Web SDK).
 */
@Composable
internal fun LeftToRight(content: @Composable () -> Unit) {
    CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Ltr, content = content)
}
