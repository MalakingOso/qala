package com.qala.data.engine

/**
 * The engine muscle ids an exercise trains, for the check-in soreness grid and the readiness session muscles.
 *
 * The Rust adapter maps every library exercise itself (`muscles.rs`), but it does not export the lookup over
 * the FFI, so this is a hand-kept copy for the lifts the app plans around, taken from the targets the
 * adapter's own tests list. A test builds an engine state per exercise and checks each id is a muscle the
 * engine actually loads. An exercise missing here gives no muscles, which readiness treats as "unknown".
 */
object ExerciseMuscles {
    private val targets: Map<String, List<String>> = mapOf(
        "squat" to listOf("quads"),
        "benchPress" to listOf("chest"),
        "deadlift" to listOf("glutes"),
        "overheadPress" to listOf("frontdelts"),
        "bentOverRow" to listOf("lats", "upperback"),
        "latPulldown" to listOf("lats"),
    )

    /** Primary muscles of one exercise, empty when unknown. */
    fun targetsOf(exerciseId: String): List<String> = targets[exerciseId].orEmpty()

    /** The distinct primary muscles of a session's exercises, in first-seen order. */
    fun targetsOf(exerciseIds: List<String>): List<String> = exerciseIds.flatMap(::targetsOf).distinct()

    /** The exercise ids this table knows. */
    val known: Set<String> get() = targets.keys
}
