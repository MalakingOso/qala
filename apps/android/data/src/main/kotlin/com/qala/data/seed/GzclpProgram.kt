package com.qala.data.seed

/**
 * The GZCLP program text the debug seed starts from: `inputs.programText` of
 * testdata/golden/lspp/builtins/gzclp.json, copied verbatim. A JVM test compares the two so this
 * cannot drift. The progression state of a program lives inside its text; the seed advances it with the
 * finish-day script after each session it logs.
 */
object GzclpProgram {
    const val NAME = "gzclp.md"

    const val TEXT: String = """# Week 1
## Day 1
// ...t1
t1: Squat / ...t1

// ...t2
t2: Bench Press / ...t2

// ...t3
t3: Lat Pulldown / ...t3

## Day 2
// ...t1
t1: Overhead Press / ...t1 / progress: custom(increase: 5lb) { ...t1 }

// ...t2
t2: Deadlift / ...t2 / progress: custom(increase: 10lb, stage3increase: 15lb) { ...t2 }

// ...t3
t3: Bent Over Row / ...t3

## Day 3
// ...t1
t1: Bench Press / ...t1 / progress: custom(increase: 5lb) { ...t1 }

// ...t2
t2: Squat / ...t2 / progress: custom(increase: 10lb, stage3increase: 15lb) { ...t2 }

// ...t3
t3: Lat Pulldown / ...t3

## Day 4
// ...t1
t1: Deadlift / ...t1

// ...t2
t2: Overhead Press / ...t2

// ...t3
t3: Bent Over Row / ...t3


// **T1**. It starts with **85% of 5RM** (or approximately **75% or 1RM**).
// You can adjust your 1RM by clicking the **1RM** link under the exercise name.
// There's the RM calculator there to help find it out if you don't know it

// **T1**.

// **T1**. Retest week, you may skip warmups. Find your new 5RM (5 rep max), as follows
// * Start with the bar, do 5 reps.
// * Throw on some more weight, do 5 reps.
// * Repeat, when the bar starts to get heavy, make smaller jumps.
// * When you finally get to a set that is hard, but you do it - take that number, and enter into "5RM Test" set weight
// * Mark it completed!
t1 / used: none / 4x3, 1x3+ / 5x2, 1x2+ / 9x1, 1x1+ / 1x5 (5RM Test) / 75% / progress: custom(increase: 10lb) {~
  if (descriptionIndex == 1) {
    descriptionIndex = 2
  }
  if (setVariationIndex == 4) {
    descriptionIndex = 2
    setVariationIndex = 1
    weights = completedWeights[1] * 0.85
    rm1 = completedWeights[1] / rpeMultiplier(5, 10)
  } else if (completedReps >= reps) {
    weights = completedWeights[ns] + state.increase
  } else if (setVariationIndex == 3) {
    descriptionIndex = 3
    setVariationIndex += 1
  } else {
    setVariationIndex += 1
  }
~}

// **T2**. Start with **35% of 1RM**.
// You can adjust your 1RM by clicking the **edit** icon, and setting the **1 Rep Max** value.
// There's the RM calculator there to help find it out if you don't know it

// **T2**.
t2 / used: none / 3x10 / 3x8 / 3x6 / 62% / progress: custom(stage1weight: 0lb, increase: 5lb, stage3increase: 10lb) {~
  if (descriptionIndex == 1) {
    descriptionIndex = 2
  }
  if (completedReps >= reps) {
    weights = completedWeights[ns] + state.increase
  } else if (setVariationIndex == 1) {
    state.stage1weight = completedWeights[ns]
    setVariationIndex += 1
  } else if (setVariationIndex == 2) {
    setVariationIndex += 1
  } else {
    setVariationIndex = 1
    weights = state.stage1weight + state.stage3increase
  }
~}

// **T3**.
t3 / used: none / 2x15, 1x15+ / 60% 90s / progress: custom(increase: 5lb) {~
  if (completedReps[ns] >= 25) {
    weights = completedWeights[ns] + state.increase
  }
~}
"""
}
