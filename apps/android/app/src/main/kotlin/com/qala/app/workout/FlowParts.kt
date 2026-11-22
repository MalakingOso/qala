package com.qala.app.workout

import androidx.compose.foundation.layout.RowScope
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.qala.design.FlowNode
import com.qala.design.QalaIcons
import com.qala.design.ScreenHead
import com.qala.design.StageDotState

/**
 * The head of a screen pushed over the wash (S49): a glass Back, the white [kicker] over the title, and the screen's own [actions] at the
 * end. It is [ScreenHead] with a Back; Warm-up, Workout and Rest call it until they take [ScreenHead] themselves.
 */
@Composable
fun WashHead(title: String, kicker: String?, onBack: () -> Unit, modifier: Modifier = Modifier, actions: @Composable RowScope.() -> Unit = {}) {
    ScreenHead(title, modifier, eyebrow = kicker, onBack = onBack, actions = actions)
}

/** The short name under a rail node: the whole name when it fits, else its first two words. A node label is two lines of 11 characters at most. */
private fun shortName(name: String): String = if (name.length <= 12) name else name.split(' ').take(2).joinToString(" ")

/**
 * The rail of Workout and Rest (S49): the warm-up first (done: the lifting began after it or without it), then one node per
 * exercise, the open one big. [hourglass] puts the hourglass on the open one, for Rest. Node `i` is exercise `i - 1`; node 0 is the warm-up.
 */
fun flowNodes(state: WorkoutState, hourglass: Boolean): List<FlowNode> = buildList {
    // Rest's rail is a display, so there the first node only names the warm-up; on Workout it opens it.
    add(FlowNode(StageDotState.Done, if (hourglass) "Warm-up" else "Warm-up, open it"))
    state.exercises.forEachIndexed { i, ex ->
        val current = i == state.current
        add(
            FlowNode(
                state = when {
                    current -> StageDotState.Now
                    ex.complete -> StageDotState.Done
                    else -> StageDotState.Later
                },
                description = "${ex.name}, ${ex.doneCount} of ${ex.setCount} sets done",
                text = "${i + 1}",
                icon = if (current && hourglass) QalaIcons.Hourglass else null,
                label = if (current || ex.complete) null else shortName(ex.name),
            ),
        )
    }
}
