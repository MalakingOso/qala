package com.qala.app.allex

import com.qala.app.workout.ExerciseState
import com.qala.app.workout.WorkoutState
import com.qala.app.workout.formatWeight
import com.qala.app.workout.repsTarget
import com.qala.app.workout.unitLabel

/*
 * The All exercises grid's decisions as plain data (DESIGN 7.7): what a card says, which card is current, and what the
 * screen shows. One grid serves the whole lifting flow, so it reads one type, the WorkoutState. While a workout is in
 * progress that is the live state, with done sets filled in and the exercise the lifter is on outlined; before one is
 * (the warm-up) it is the program's day opened fresh, nothing done and the first exercise current. No Compose, so the
 * lines and the states are unit tested on the JVM.
 */

/** One card: its position, name, prescription line and a box per set (true once the set is done). */
data class AllExCard(
    val number: Int,
    val name: String,
    val line: String,
    val done: List<Boolean>,
    val current: Boolean,
) {
    val sets: Int get() = done.size
    val doneCount: Int get() = done.count { it }
}

/** What the screen shows. [live] is true when [state] is the workout in progress, whose cards jump to its exercises. */
sealed interface AllExState {
    data object Loading : AllExState
    data object NoDay : AllExState
    data class Ready(val state: WorkoutState, val live: Boolean) : AllExState
}

/** "5 × 3 @ 207.5 lb", "5 × 3+ @ 207.5 lb" when the first set is as many as possible, "3 × 12" with no weight, "no sets" for none. */
fun detailLine(ex: ExerciseState): String {
    val first = ex.sets.firstOrNull() ?: return "no sets"
    val base = "${ex.sets.size} × ${repsTarget(first.targetReps, first.minReps, first.amrap)}"
    val weight = first.targetWeight ?: return base
    return "$base @ ${formatWeight(weight)} ${unitLabel(ex.unit)}"
}

/** Cards in the day's order; the current one is the exercise the workout is on. */
fun allExCards(state: WorkoutState): List<AllExCard> =
    state.exercises.mapIndexed { i, ex ->
        AllExCard(number = i + 1, name = ex.name, line = detailLine(ex), done = ex.sets.map { it.done }, current = i == state.current)
    }

/** "Day 4 · 3 exercises · 11 sets", or "· 4 of 11 sets" once any are logged: the line under the title. */
fun allExSummary(state: WorkoutState): String {
    val sets = state.totalSets
    val ex = if (state.exercises.size == 1) "1 exercise" else "${state.exercises.size} exercises"
    val st = when {
        state.loggedSets > 0 -> "${state.loggedSets} of $sets sets"
        sets == 1 -> "1 set"
        else -> "$sets sets"
    }
    return "${state.dayName} · $ex · $st"
}

/** The words for a card's accessibility node, which also say how far along it is. */
fun allExDescription(card: AllExCard): String =
    "${card.number}, ${card.name}, ${card.line}, ${card.doneCount} of ${card.sets} sets done"
