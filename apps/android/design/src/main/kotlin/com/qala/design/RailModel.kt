package com.qala.design

/** How one stage of the day reads on the rail. [Skipped] is a hollow ring; it has no other look. */
enum class StageDotState { Done, Now, Later, Skipped }

/**
 * One stage of Today's day rail, as the rail and its menu see it. The list is never a fixed length: a lift day has
 * six stages, a rest day three, so nothing downstream may assume six.
 *
 * An [interlude] stage (recover, wind down) has no doneness. "Now" skips it and it draws as a soft dot.
 * [doneTime] is the clock time the menu shows for a Done stage (for example "7:12"); later stages carry none.
 */
data class RailStage(
    val id: String,
    val label: String,
    val state: StageDotState,
    val interlude: Boolean = false,
    val doneTime: String? = null,
)

/**
 * The stage [delta] steps from [from], clamped to the list. Skips nothing (an interlude is a real stop when
 * previewing); an empty list answers 0.
 */
fun nextStage(stages: List<RailStage>, from: Int, delta: Int): Int =
    if (stages.isEmpty()) 0 else (from + delta).coerceIn(0, stages.lastIndex)

/**
 * The stage "now" points at: the first non-interlude stage that is [StageDotState.Now], else the first
 * non-interlude stage that is not Done (so a Later or Skipped stage), else the last one. An all-done day therefore
 * points at the final stage, which is usually an interlude.
 */
fun nowIndex(stages: List<RailStage>): Int {
    if (stages.isEmpty()) return 0
    val now = stages.indexOfFirst { !it.interlude && it.state == StageDotState.Now }
    if (now >= 0) return now
    val open = stages.indexOfFirst { !it.interlude && it.state != StageDotState.Done }
    return if (open >= 0) open else stages.lastIndex
}

/** The spoken name of the strip: "Day stages: lift now, 2 of 6 done". The "now" part is left out when nothing is Now. */
fun railDescription(stages: List<RailStage>): String {
    val now = stages.firstOrNull { !it.interlude && it.state == StageDotState.Now }
    val done = stages.count { it.state == StageDotState.Done }
    return buildString {
        append("Day stages")
        if (stages.isEmpty()) return@buildString
        append(": ")
        if (now != null) append(now.label.lowercase()).append(" now, ")
        append(done).append(" of ").append(stages.size).append(" done")
    }
}
