package site.lempert.taleart.taller

import platform.UIKit.UIAccessibilityTraitButton
import platform.UIKit.UIApplication
import platform.UIKit.UIView
import platform.UIKit.UIWindow
import platform.UIKit.accessibilityActivate
import platform.UIKit.accessibilityElements
import platform.UIKit.accessibilityLabel
import platform.UIKit.accessibilityTraits
import platform.darwin.NSObject
import site.lempert.taleart.sdk.i18n.TaleartStrings

/**
 * iOS: Compose Multiplatform mirrors its semantics tree as UIKit accessibility elements (the tree VoiceOver reads), on the
 * view of every Compose window of the app (the viewer is presented over the page, so it is in the same windows). The control
 * is found there and pressed with `accessibilityActivate()`, which runs the semantics click action as VoiceOver's double tap
 * does, so no finger is needed.
 */
actual fun performDebugAction(action: DebugAction, groupNames: List<String>): Boolean {
    val elements = accessibilityElementsOnScreen()
    val target = pickDebugTarget(action, groupNames, elements.map { it.toDebugElement() })?.let { elements[it] } ?: return false
    return target.accessibilityActivate()
}

private fun NSObject.toDebugElement() = DebugElement(
    label = accessibilityLabel.orEmpty(),
    isButton = (accessibilityTraits and UIAccessibilityTraitButton) != 0uL,
    hasChildren = (accessibilityElements as? List<*>)?.isNotEmpty() == true,
)

/** Every accessibility element of the app's windows, in tree order (a parent before its children). */
private fun accessibilityElementsOnScreen(): List<NSObject> {
    val found = mutableListOf<NSObject>()
    fun element(o: Any?) {
        val e = o as? NSObject ?: return
        found += e
        (e.accessibilityElements as? List<*>)?.forEach { element(it) }
    }
    fun view(v: UIView) {
        (v.accessibilityElements as? List<*>)?.forEach { element(it) }
        v.subviews.filterIsInstance<UIView>().forEach { view(it) }
    }
    UIApplication.sharedApplication.windows.filterIsInstance<UIWindow>().forEach { view(it) }
    return found
}

/** What the matching rules of [pickDebugTarget] read of one accessibility element. */
data class DebugElement(val label: String, val isButton: Boolean, val hasChildren: Boolean)

/**
 * The index in [elements] of the control [action] presses, or null when it is not there (yet). A bar item or banner slide is
 * a button named after its group (the label is the name, or starts with `name,`). A poll, quiz or reaction choice is a button
 * that has a child (its text) and is not a group's item: the choices in tree order. Copy and Next tale are found by their
 * English label, as the SDK's default strings give it.
 */
fun pickDebugTarget(action: DebugAction, groupNames: List<String>, elements: List<DebugElement>): Int? {
    val buttons = elements.withIndex().filter { it.value.isButton }
    return when (action.kind) {
        DebugActionKind.OpenItem -> {
            val name = groupNames.getOrNull(action.index) ?: return null
            buttons.firstOrNull { it.value.label == name || it.value.label.startsWith("$name,") }?.index
        }
        DebugActionKind.Vote, DebugActionKind.Press ->
            buttons.filter { it.value.hasChildren && groupNames.none { n -> it.value.label == n || it.value.label.startsWith("$n,") } }
                .getOrNull(action.index)?.index
        DebugActionKind.Copy -> {
            val copy = TaleartStrings.DEFAULTS.getValue("promo.copy")
            buttons.firstOrNull { it.value.label == copy || it.value.label.startsWith("$copy,") }?.index
        }
        DebugActionKind.SwipeNext -> {
            val next = TaleartStrings.DEFAULTS.getValue("viewer.nextTale")
            buttons.firstOrNull { it.value.label == next }?.index
        }
    }
}
