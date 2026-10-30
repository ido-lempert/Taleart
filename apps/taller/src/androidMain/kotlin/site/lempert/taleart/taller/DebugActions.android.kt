package site.lempert.taleart.taller

import android.view.View
import android.view.ViewGroup
import android.view.inspector.WindowInspector
import androidx.compose.ui.InternalComposeUiApi
import androidx.compose.ui.node.RootForTest
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import site.lempert.taleart.sdk.i18n.TaleartStrings

/**
 * Android: the controls are found in the semantics tree of every window of this process (the viewer is a dialog window of
 * its own) and pressed through their click action, as an accessibility service's click would, so no finger is needed.
 */
@OptIn(InternalComposeUiApi::class)
actual fun performDebugAction(action: DebugAction, groupNames: List<String>): Boolean {
    val nodes = WindowInspector.getGlobalWindowViews().flatMap { composeRoots(it) }.flatMap { flatten(it.semanticsOwner.rootSemanticsNode) }
    val clickable = nodes.filter { SemanticsActions.OnClick in it.config }
    fun role(node: SemanticsNode): Role? = node.config.getOrNull(SemanticsProperties.Role)
    fun described(node: SemanticsNode): List<String> =
        node.config.getOrNull(SemanticsProperties.ContentDescription).orEmpty() + node.config.getOrNull(SemanticsProperties.Text).orEmpty().map { it.text }
    val target: SemanticsNode? = when (action.kind) {
        DebugActionKind.OpenItem -> {
            val name = groupNames.getOrNull(action.index) ?: return false
            clickable.firstOrNull { node -> role(node) == Role.Button && described(node).any { it == name || it.startsWith("$name,") } }
        }
        DebugActionKind.Vote -> clickable.filter { role(it) == Role.RadioButton }.getOrNull(action.index)
        // A reaction's emoji is a button with a selected state; the viewer's own controls have none.
        DebugActionKind.Press -> clickable.filter { role(it) == Role.Button && SemanticsProperties.Selected in it.config }.getOrNull(action.index)
        DebugActionKind.Copy -> clickable.firstOrNull { role(it) == Role.Button && described(it).contains(TaleartStrings.DEFAULTS.getValue("promo.copy")) }
        DebugActionKind.SwipeNext -> clickable.firstOrNull { described(it).contains(TaleartStrings.DEFAULTS.getValue("viewer.nextTale")) }
    }
    val click = target?.config?.getOrNull(SemanticsActions.OnClick)?.action ?: return false
    // The semantics tree is read on the main thread only.
    return click.invoke()
}

private fun flatten(node: SemanticsNode): List<SemanticsNode> = listOf(node) + node.children.flatMap { flatten(it) }

@OptIn(InternalComposeUiApi::class)
private fun composeRoots(view: View): List<RootForTest> {
    if (view is RootForTest) return listOf(view)
    if (view !is ViewGroup) return emptyList()
    return (0 until view.childCount).flatMap { composeRoots(view.getChildAt(it)) }
}
