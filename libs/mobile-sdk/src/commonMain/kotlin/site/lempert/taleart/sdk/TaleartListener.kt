package site.lempert.taleart.sdk

/** A group of the zone, as an event names it: its id, name and position in the zone (from 0). */
data class GroupRef(
    val id: String,
    val name: String,
    val index: Int,
)

/** A tale in its group: its id, position in the group (from 0) and title. */
data class TaleRef(
    val id: String,
    val index: Int,
    val title: String,
)

/**
 * A call to action or a component of a tale: its element id, its type (`button`, `image-button`,
 * `swipe-up`, `countdown`, `promo-code`, `poll`, `quiz`, `rating`, `reaction`) and, for a component
 * that reports a value, the value: a promo code's code, or a visitor's answer (a poll's option id, a
 * quiz's answer id, a Rating's number from 0 to 100, a Reaction's emoji).
 */
data class ComponentRef(
    val id: String,
    val type: String,
    val value: String? = null,
)

/**
 * What a [TaleartListener] hook receives, the same for every hook as the Web SDK's event
 * (libs/web-sdk/src/lib/hooks.ts): [name] is the hook's name without `on` in lower camel case
 * (`loaded`, `loadFailed`, `groupImpression`, `groupCapped`, `presented`, `dismissed`, `taleShown`,
 * `actionClicked`, `userInteracted`, `componentEvent`). The zone is named by [zoneKeyPrefix], the first 8
 * characters of its key (never the whole key) and [zoneSlug] (empty when the read failed before
 * the zone came). Each event fills what applies: [group], [tale], [component], [url] and [newTab]
 * for an action, [component] and [action] for a component event, [error] for a failed load, [rule]
 * for a capped group.
 */
data class TaleartEvent(
    val name: String,
    val zoneKeyPrefix: String,
    val zoneSlug: String = "",
    val group: GroupRef? = null,
    val tale: TaleRef? = null,
    val component: ComponentRef? = null,
    /**
     * What a component of the tale did (`componentEvent`): `ended` (a countdown reached its end), or
     * `copied` (a promo code was copied, its value the code), or `selected` (a visitor's answer was
     * accepted, its value the answer). [component] names the component.
     */
    val action: String? = null,
    /** The destination of an action, when it opens one. */
    val url: String? = null,
    /** Whether the action opens a new tab (always false in the native SDK, which opens links in the system browser). */
    val newTab: Boolean = false,
    /** The message of a failed load. */
    val error: String? = null,
    /** The frequency cap a group reached (`groupCapped`): the rule the group is hidden by. */
    val rule: FrequencyRule? = null,
)

/**
 * The hooks a host app sets (as the Web SDK's `hooks`): set them for every view with
 * [TaleartSdk.init] and [TaleartConfig.listener], or for one view with its `listener`. Both run, the
 * view's first, then the global one; [onEvent] gets every event. Each hook's default does nothing, so
 * override only what you need. A hook that throws is logged and the SDK goes on.
 *
 * [onActionClicked] is the one hook with an answer: return true when the app handled the action (it
 * routes the link itself), and the SDK then does not open the URL. Return false (the default) and the
 * system browser opens it.
 *
 * Swift: subclass [TaleartListenerBase] and override the hooks you need.
 */
interface TaleartListener {
    /** The zone was read and its display is rendered (or none is needed). */
    fun onLoaded(event: TaleartEvent) {}

    /** The zone could not be read: a refused key, a network failure or a bad answer. `event.error` is the message. */
    fun onLoadFailed(event: TaleartEvent) {}

    /** A group's bar item or banner slide was seen (once per group per load). */
    fun onGroupImpression(event: TaleartEvent) {}

    /**
     * A group was hidden by the frequency cap (`TaleartConfig.frequency`) on a load: `event.group` is
     * the group and `event.rule` the rule it reached. Once per group per load.
     */
    fun onGroupCapped(event: TaleartEvent) {}

    /** The full-screen viewer opened on a group. */
    fun onPresented(event: TaleartEvent) {}

    /** The full-screen viewer closed; `event.group` is the group it showed last. */
    fun onDismissed(event: TaleartEvent) {}

    /** A tale came on screen in the viewer. */
    fun onTaleShown(event: TaleartEvent) {}

    /**
     * A call to action of a tale was activated, before it opens [TaleartEvent.url]. Return true when
     * the app handled it; the SDK then does not open the URL.
     */
    fun onActionClicked(event: TaleartEvent): Boolean = false

    /**
     * The server accepted a visitor's answer to a poll, a quiz, a rating or a reaction: `event.component`
     * names the element and its value is the answer. Once per answer; an answer kept from an earlier
     * visit is not reported again. Fired in addition to `onComponentEvent` (`selected`).
     */
    fun onUserInteracted(event: TaleartEvent) {}

    /**
     * A component of a tale did something (components, 2026-10-29), as the Web SDK's `componentEvent`:
     * `event.component` names it and `event.action` says what it did (`ended` for a countdown, `copied`
     * for a promo code, whose `component.value` is the code, or `selected` for an answer accepted by the
     * server, whose value is the answer). Fired in addition to the other events.
     */
    fun onComponentEvent(event: TaleartEvent) {}

    /** Every event, in one stream. */
    fun onEvent(event: TaleartEvent) {}
}

/**
 * A [TaleartListener] that does nothing, to subclass: the Swift counterpart of the interface, whose
 * defaults Objective-C cannot inherit. Override only the hooks you need.
 */
open class TaleartListenerBase : TaleartListener {
    override fun onLoaded(event: TaleartEvent) {}
    override fun onLoadFailed(event: TaleartEvent) {}
    override fun onGroupImpression(event: TaleartEvent) {}
    override fun onGroupCapped(event: TaleartEvent) {}
    override fun onPresented(event: TaleartEvent) {}
    override fun onDismissed(event: TaleartEvent) {}
    override fun onTaleShown(event: TaleartEvent) {}
    override fun onActionClicked(event: TaleartEvent): Boolean = false
    override fun onUserInteracted(event: TaleartEvent) {}
    override fun onComponentEvent(event: TaleartEvent) {}
    override fun onEvent(event: TaleartEvent) {}
}

// Runs the hooks of the listeners in order (the view's, then the global one), each guarded: a hook
// that throws is logged and changes nothing else. `specific` calls the hook named for the event, then
// every listener's onEvent gets it.
internal fun deliver(local: TaleartListener?, event: TaleartEvent, specific: (TaleartListener) -> Unit) {
    val listeners = listeners(local)
    for (listener in listeners) guarded(event.name) { specific(listener) }
    for (listener in listeners) guarded("onEvent") { listener.onEvent(event) }
}

// As [deliver] for actionClicked: true when any listener's hook handled the action.
internal fun deliverAction(local: TaleartListener?, event: TaleartEvent): Boolean {
    val listeners = listeners(local)
    var handled = false
    for (listener in listeners) guarded("actionClicked") { if (listener.onActionClicked(event)) handled = true }
    for (listener in listeners) guarded("onEvent") { listener.onEvent(event) }
    return handled
}

private fun listeners(local: TaleartListener?): List<TaleartListener> = listOfNotNull(local, TaleartSdk.config.listener)

private inline fun guarded(hook: String, block: () -> Unit) {
    try {
        block()
    } catch (e: Exception) {
        println("TaleArt: the $hook listener threw; the SDK continues: ${e.message}")
    }
}

/** The first 8 characters of a zone key: the only part of it an event names. */
internal fun keyPrefix(zoneKey: String): String = zoneKey.take(8)
