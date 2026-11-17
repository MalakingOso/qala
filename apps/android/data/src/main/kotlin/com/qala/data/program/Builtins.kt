package com.qala.data.program

import com.qala.data.seed.GzclpProgram
import java.util.Locale
import java.util.UUID

/**
 * A lift the picker asks a starting weight for: the heaviest weight the lifter can do for [reps] clean reps. LS++ keeps
 * one 1RM per lift in `exerciseData` and the program text holds percentages of it, so the entered weight becomes
 * `weight / share`, where [share] is the part of the 1RM that set sits at in the text. That way week 1 lands on the
 * weight that was entered.
 */
data class StartingLift(
    /** The `exerciseData` key (`squat_barbell`). A wrong key falls back silently to the catalog's starting weight. */
    val key: String,
    val name: String,
    val reps: Int,
    val share: Double,
)

/** A plan the picker offers. Adding another is one text and its list of [startingLifts]. */
data class BuiltinPlan(
    /** The program row's id. Picking the plan again rewrites that row. */
    val id: String,
    /** What the picker calls it. */
    val name: String,
    /** The program's own name (the evaluator's, and what Plan's eyebrow shows). */
    val programName: String,
    val daysPerWeek: Int,
    /** 0 is Monday. Set when the lifter's training days do not match [daysPerWeek]. */
    val defaultWeekdays: List<Int>,
    val audience: String,
    val blurb: String,
    val startingLifts: List<StartingLift>,
    val text: String,
    /**
     * True when the plan keeps its stages and weights in its own text rather than in the 1RMs. Picking it again then puts it
     * back at the start, so the picker says so.
     */
    val stateInText: Boolean = false,
)

/** The plans the app ships. */
object Builtins {
    /**
     * The share of 1RM a set of 5 sits at in the text. `rpeMultiplier(5, 10)` of the LS++ RPE table is 0.86526; this is
     * that rounded up to three places. LS++ rounds a prescribed weight down to the plates, so a weight the finish-day
     * script set exactly (the script divides by the exact table value) must land a hair above, never a hair below.
     */
    const val FiveRepShare = 0.866

    /** The same for a set of 3: `rpeMultiplier(3, 10)` is 0.92142. */
    const val ThreeRepShare = 0.922

    private val squat = StartingLift("squat_barbell", "Squat", 5, FiveRepShare)
    private val bench = StartingLift("benchPress_barbell", "Bench Press", 5, FiveRepShare)
    private val press = StartingLift("overheadPress_barbell", "Overhead Press", 5, FiveRepShare)
    private val deadlift = StartingLift("deadlift_barbell", "Deadlift", 5, FiveRepShare)
    private val clean = StartingLift("powerClean_barbell", "Power Clean", 3, ThreeRepShare)

    /**
     * The id the debug seed gave its GZCLP row before there was a catalog, a name-based UUID. It stays that exact value:
     * installs that already hold the row show it as the current plan, and picking GZCLP rewrites it in place.
     */
    val Gzclp = BuiltinPlan(
        id = UUID.nameUUIDFromBytes("qala-seed:program:gzclp".toByteArray()).toString(),
        name = "GZCLP",
        programName = GzclpProgram.NAME,
        daysPerWeek = 4,
        defaultWeekdays = listOf(0, 2, 4, 5),
        audience = "Beginners and early intermediates",
        blurb = "Four days a week of squat, bench, press and deadlift in three tiers. Sets and reps change when you stall.",
        startingLifts = listOf(squat, bench, press, deadlift),
        text = GzclpProgram.TEXT,
        stateInText = true,
    )

    val TexasMethod = BuiltinPlan(
        id = "program-texas-method",
        name = "Texas Method",
        programName = "Texas Method.md",
        daysPerWeek = 3,
        defaultWeekdays = listOf(0, 2, 4),
        audience = "Lifters coming off a novice program",
        blurb = "Volume on Monday, a light day on Wednesday, a new 5-rep max on Friday. Bench and press take turns week by week.",
        startingLifts = listOf(squat, bench, press, deadlift, clean),
        text = texasMethodText(),
    )

    val all: List<BuiltinPlan> = listOf(Gzclp, TexasMethod)

    fun byId(id: String?): BuiltinPlan? = all.firstOrNull { it.id == id }

    private fun pctOf1Rm(share: Double) = String.format(Locale.ROOT, "%.2f%%", share * 100)

    /** [of5Rm] of the lifter's 5RM, as a percentage of their 1RM. */
    private fun pct(of5Rm: Double) = pctOf1Rm(of5Rm * FiveRepShare)

    /**
     * Rippetoe's Texas Method (startingstrength.com/article/the_texas_method), written for this app. Two weeks of three
     * days, so the rotation is six days: bench is the heavy upper lift in week A and press in week B. Every load is a
     * fixed share of one 1RM per lift, so Monday, Wednesday and Friday move together. Friday's set of 5 is the 5RM: when
     * it is made, the lift's 5RM becomes the previous 5RM plus the increment (or the weight lifted plus the increment, when
     * that is more). It adds to the previous 5RM and not to the weight on the bar, because the app logs the weight the
     * plates can load, which is below the program's whenever the increment is smaller than a plate step. Deadlift moves up on
     * its Monday set and the power clean when all five sets of 3 are made. A missed set repeats the weight.
     */
    private fun texasMethodText(): String {
        // LS++ shares a lift's progress script across every day it appears on, so each script says which day it runs after.
        fun raise(increment: String, reps: Int, dayInWeek: Int) = """progress: custom(increment: $increment) {~
  if (dayInWeek == $dayInWeek && completedReps >= reps) {
    rm1 = (max(rm1 * rpeMultiplier($reps, 10), completedWeights[ns]) + state.increment) / rpeMultiplier($reps, 10)
  }
~}"""

        fun week(name: String, heavy: String, light: String, lightShare: Double) = """# $name
## Volume Day
// 5x5 at 90% of your 5RM, with 5 minutes between sets.
Squat / 5x5 / ${pct(0.90)} / 300s
$heavy / 5x5 / ${pct(0.90)} / 300s
// One heavy set of 5 after the squats.
Deadlift / 1x5 / ${pct(1.0)} / 300s / ${raise("5lb", 5, 1)}

## Recovery Day
// Light day: 80% of Monday's squat weight.
Squat / 2x5 / ${pct(0.72)} / 180s
$light / 3x5 / ${pct(lightShare)} / 180s
Chin Up / 3x5+ / 0lb / 300s / warmup: none
// Optional. Skip it if you are short on time.
Back Extension, Bodyweight / 5x10 / 0lb / 180s / warmup: none

## Intensity Day
// Work up to one set of 5 at the new 5RM. Make it and the weight goes up next week.
Squat / 1x5 / ${pct(1.0)} / 300s / ${raise("5lb", 5, 3)}
$heavy / 1x5 / ${pct(1.0)} / 300s / ${raise("2.5lb", 5, 3)}
Power Clean / 5x3 / ${pctOf1Rm(ThreeRepShare)} / 300s / ${raise("2.5lb", 3, 3)}
"""

        return week("Week 1", "Bench Press", "Overhead Press", 0.85) + "\n\n" +
            week("Week 2", "Overhead Press", "Bench Press", 0.80)
    }
}
