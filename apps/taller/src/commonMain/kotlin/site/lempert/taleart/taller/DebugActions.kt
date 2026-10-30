package site.lempert.taleart.taller

/** What a timed debug action does on the screen (see [TallerDebugOptions]). */
enum class DebugActionKind {
    /** Opens the zone's item (a bar item or a banner slide) at the index, as a tap does. */
    OpenItem,

    /** Picks the choice at the index of the poll or quiz on the tale in the viewer. */
    Vote,

    /** Presses the emoji at the index of the reaction on the tale in the viewer. */
    Press,

    /** Presses the Copy of the promo code on the tale in the viewer. */
    Copy,

    /** Presses the viewer's Next tale (the last tale of a group goes on to the next group). */
    SwipeNext,
}

/** One timed action: its [kind] and, for the ones that pick among several, the [index]. */
data class DebugAction(val kind: DebugActionKind, val index: Int = 0)

/**
 * The timed actions the options ask for, in the order they run: open the item, vote, press, copy, swipe to the next.
 * Each runs [TallerDebugOptions.autoDelayMs] after the one before.
 */
val TallerDebugOptions.actions: List<DebugAction>
    get() = buildList {
        autoOpenItem?.let { add(DebugAction(DebugActionKind.OpenItem, it)) }
        autoVote?.let { add(DebugAction(DebugActionKind.Vote, it)) }
        autoPress?.let { add(DebugAction(DebugActionKind.Press, it)) }
        if (autoCopy) add(DebugAction(DebugActionKind.Copy))
        if (autoSwipeNext) add(DebugAction(DebugActionKind.SwipeNext))
    }

/**
 * Performs [action] on what is on screen now through the platform's accessibility tree, as a person's tap on the same
 * control would; true when it found the control and pressed it. [groupNames] are the zone's group names, in order (an
 * item is found by its name). The screen may not be ready yet, so the caller tries again until it is.
 */
expect fun performDebugAction(action: DebugAction, groupNames: List<String>): Boolean
