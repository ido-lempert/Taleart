package site.lempert.taleart.sdk.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.UriHandler
import site.lempert.taleart.sdk.ComponentRef
import site.lempert.taleart.sdk.GroupRef
import site.lempert.taleart.sdk.TaleRef
import site.lempert.taleart.sdk.TaleartEvent
import site.lempert.taleart.sdk.TaleartListener
import site.lempert.taleart.sdk.TaleartSdk
import site.lempert.taleart.sdk.analytics.AnalyticsEventType
import site.lempert.taleart.sdk.deliver
import site.lempert.taleart.sdk.delivery.DeliveryTale
import site.lempert.taleart.sdk.delivery.DeliveryTaleGroup
import site.lempert.taleart.sdk.i18n.StringOverrides
import site.lempert.taleart.sdk.i18n.Translate
import site.lempert.taleart.sdk.i18n.createTranslate
import site.lempert.taleart.sdk.i18n.mergeStrings
import site.lempert.taleart.sdk.keyPrefix

/**
 * What the zone's UI needs from its view: the texts in effect, the listener of the view, and the
 * zone's name in events (the first 8 characters of its key and its slug). It is provided by the zone
 * composable and read by every part of its display and viewer.
 */
internal class TaleartContext(
    val translate: Translate,
    val listener: TaleartListener?,
    val zoneKeyPrefix: String,
    val zoneSlug: String,
    private val tracker: TaleartTracker? = null,
) {
    /** Queues an analytics event of this zone (none without a tracker, as for a zone the host passed in). */
    fun track(type: AnalyticsEventType, group: GroupRef, tale: TaleRef? = null) {
        tracker?.track(type, group, tale)
    }

    /**
     * A group's bar item or banner slide was shown for the first time in a render: `groupImpression`
     * to the listeners, and an impression event.
     */
    fun impression(group: GroupRef) {
        track(AnalyticsEventType.Impression, group)
        val event = event("groupImpression", group = group)
        deliver(listener, event) { it.onGroupImpression(event) }
    }

    /** An event of this zone, named the way the listeners expect it. */
    fun event(
        name: String,
        group: GroupRef? = null,
        tale: TaleRef? = null,
        component: ComponentRef? = null,
        url: String? = null,
    ) = TaleartEvent(
        name = name,
        zoneKeyPrefix = zoneKeyPrefix,
        zoneSlug = zoneSlug,
        group = group,
        tale = tale,
        component = component,
        url = url,
    )
}

/**
 * The texts, listener and zone of the zone on screen. The default reads the SDK's configuration, so a
 * viewer shown outside a zone composable (in a test, or by the host) still translates and reports.
 */
internal val LocalTaleartContext = compositionLocalOf {
    TaleartContext(TaleartSdk.translate, null, "", "")
}

/** Where a zone's analytics events are queued: implemented by [TaleartZoneController] for a zone it reads. */
internal fun interface TaleartTracker {
    fun track(type: AnalyticsEventType, group: GroupRef, tale: TaleRef?)
}

/**
 * Opens a call to action of the viewer's tale: reports `actionClicked` to the listeners and opens the
 * URL unless one of them handled it. Provided by the viewer; without one a link opens in the browser.
 */
internal fun interface LinkOpener {
    fun open(component: ComponentRef, url: String)
}

internal val LocalLinkOpener = compositionLocalOf<LinkOpener?> { null }

/**
 * Opens [href] for the call to action [component]: through the viewer's [opener] (which reports it
 * to the listeners), else straight in the system browser.
 */
internal fun openLink(opener: LinkOpener?, uri: UriHandler, component: ComponentRef, href: String) {
    if (opener != null) opener.open(component, href) else runCatching { uri.openUri(href) }
}

/** The translate function for a view: the SDK's, with the view's [locale] and [strings] over it. */
internal fun viewTranslate(locale: String?, strings: Map<String, StringOverrides>?): Translate {
    val config = TaleartSdk.config
    val sdkLocale = config.locale.trim().ifEmpty { TaleartSdk.locale }
    val viewLocale = locale?.trim()?.ifEmpty { null } ?: sdkLocale
    return createTranslate(viewLocale, mergeStrings(config.strings, strings), config.stringsForEveryLocale)
}

/** The zone's context, rebuilt when the view's settings change. */
@Composable
internal fun rememberTaleartContext(
    zoneKey: String,
    zoneSlug: String,
    locale: String?,
    strings: Map<String, StringOverrides>?,
    listener: TaleartListener?,
    tracker: TaleartTracker? = null,
): TaleartContext {
    val config = TaleartSdk.config
    return remember(config, locale, strings, listener, zoneKey, zoneSlug, tracker) {
        TaleartContext(viewTranslate(locale, strings), listener, keyPrefix(zoneKey), zoneSlug, tracker)
    }
}

/** The group of [groups] named as an event names it: its id, name and position in the zone (from 0). */
internal fun groupRef(groups: List<DeliveryTaleGroup>, group: DeliveryTaleGroup): GroupRef =
    GroupRef(group.id, group.name, groups.indexOfFirst { it.id == group.id }.coerceAtLeast(0))

/** The tale of [group] named as an event names it: its id, position in the group (from 0) and title. */
internal fun taleRef(tale: DeliveryTale, index: Int): TaleRef =
    TaleRef(tale.id, index, tale.title)
