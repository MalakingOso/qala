package com.qala.data.engine

import com.qala.data.core.BuildEngineStateRequest
import com.qala.data.core.QalaCore
import com.qala.data.core.buildEngineState
import com.qala.data.core.stateView
import com.qala.data.model.LiftEntryRecord
import com.qala.data.model.LiftSessionRecord
import com.qala.data.model.LiftSetRecord
import com.qala.data.model.SettingsRecord
import com.qala.data.model.WeightUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** The hand-kept muscle table against what the Rust adapter really loads, exercise by exercise. */
class ExerciseMusclesTest {
    @Test
    fun everyListedMuscleIsOneTheEngineLoadsForThatExercise() {
        for (id in ExerciseMuscles.known) {
            val session = LiftSessionRecord(
                id = "s",
                startedAt = "2026-10-01T17:30:00-04:00",
                entries = listOf(LiftEntryRecord(id, List(3) { LiftSetRecord(100.0, WeightUnit.Lb, 5.0, rpe = 8.0, completed = true) })),
            )
            val result = QalaCore.buildEngineState(BuildEngineStateRequest(listOf(session), emptyList(), SettingsRecord()))
            assertEquals("$id is in the library", emptyList<String>(), result.warnings)
            val loaded = QalaCore.stateView(result.state).fatigueMuscle
            for (muscle in ExerciseMuscles.targetsOf(id)) {
                assertTrue("$id should load $muscle, loads ${loaded.keys}", loaded.getValue(muscle) > 0.0)
            }
        }
    }

    @Test
    fun aSessionsMusclesAreTheDistinctTargets() {
        assertEquals(listOf("quads", "chest", "lats"), ExerciseMuscles.targetsOf(listOf("squat", "benchPress", "latPulldown")))
        assertEquals(listOf("lats", "upperback"), ExerciseMuscles.targetsOf(listOf("bentOverRow", "latPulldown")))
        assertEquals(emptyList<String>(), ExerciseMuscles.targetsOf("zzz"))
    }
}
