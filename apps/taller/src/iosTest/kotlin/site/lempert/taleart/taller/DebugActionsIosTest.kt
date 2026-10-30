package site.lempert.taleart.taller

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

// Which accessibility element each timed debug action presses on iOS (the matching rules, on a tree as UIKit hands it over).
class DebugActionsIosTest {
    private val groups = listOf("Summer", "New arrivals", "Winter")

    private fun button(label: String, child: Boolean = false) = DebugElement(label, isButton = true, hasChildren = child)
    private fun text(label: String) = DebugElement(label, isButton = false, hasChildren = false)

    // The bar: a button per group named after it (a banner slide adds its position after a comma).
    private val bar = listOf(text("TaleArt"), button("Summer", true), button("New arrivals, group 2 of 3", true), button("Winter", true))

    // The viewer over it: the chrome, then a quiz's three choices (each a button with its text as a child).
    private val viewer = bar + listOf(
        button("Previous tale"), button("Next tale"), text("Quiz"), text("What is the capital of France?"),
        button("Paris, Paris", true), button("Lyon, Lyon", true), button("Nice, Nice", true), button("Pause"), button("Close"),
    )

    @Test
    fun anItemIsTheButtonNamedAfterItsGroup() {
        assertEquals(1, pickDebugTarget(DebugAction(DebugActionKind.OpenItem, 0), groups, bar))
        assertEquals(2, pickDebugTarget(DebugAction(DebugActionKind.OpenItem, 1), groups, bar))
        assertNull(pickDebugTarget(DebugAction(DebugActionKind.OpenItem, 5), groups, bar))
    }

    @Test
    fun anItemNotOnScreenYetIsNotFound() {
        assertNull(pickDebugTarget(DebugAction(DebugActionKind.OpenItem, 0), groups, listOf(text("TaleArt"))))
    }

    @Test
    fun aVoteIsTheNthChoiceNotAGroupItemNorTheChrome() {
        assertEquals(viewer.indexOfFirst { it.label == "Paris, Paris" }, pickDebugTarget(DebugAction(DebugActionKind.Vote, 0), groups, viewer))
        assertEquals(viewer.indexOfFirst { it.label == "Lyon, Lyon" }, pickDebugTarget(DebugAction(DebugActionKind.Vote, 1), groups, viewer))
        assertNull(pickDebugTarget(DebugAction(DebugActionKind.Vote, 3), groups, viewer))
    }

    @Test
    fun aPressIsTheNthEmojiButton() {
        val reaction = listOf(button("Next tale"), button("❤️, ❤️", true), button("😂, 😂", true), button("Close"))
        assertEquals(2, pickDebugTarget(DebugAction(DebugActionKind.Press, 1), groups, reaction))
    }

    @Test
    fun copyAndNextAreFoundByTheirLabels() {
        val promo = listOf(button("Previous tale"), button("Next tale"), button("Copy", true), button("Close"))
        assertEquals(2, pickDebugTarget(DebugAction(DebugActionKind.Copy), groups, promo))
        assertEquals(1, pickDebugTarget(DebugAction(DebugActionKind.SwipeNext), groups, promo))
        assertNull(pickDebugTarget(DebugAction(DebugActionKind.Copy), groups, bar))
    }
}
