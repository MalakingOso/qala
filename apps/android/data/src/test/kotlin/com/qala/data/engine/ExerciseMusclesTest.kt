package com.qala.data.engine

import com.qala.data.core.BuildEngineStateRequest
import com.qala.data.core.QalaCore
import com.qala.data.core.buildEngineState
import com.qala.data.core.exerciseMuscles
import com.qala.data.core.sessionMuscles
import com.qala.data.core.stateView
import com.qala.data.model.LiftEntryRecord
import com.qala.data.model.LiftSessionRecord
import com.qala.data.model.LiftSetRecord
import com.qala.data.model.SettingsRecord
import com.qala.data.model.WeightUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The Rust muscle lookup (`exercise_muscles` over the FFI) against what the engine really loads, exercise by exercise. */
class ExerciseMusclesTest {
    private val lifts = listOf("squat", "benchPress", "deadlift", "overheadPress", "bentOverRow", "latPulldown", "bicepCurl", "standingCalfRaise")

    @Test
    fun everyTargetTheLookupNamesIsOneTheEngineLoadsForThatExercise() {
        for (id in lifts) {
            val targets = QalaCore.exerciseMuscles(listOf(id)).getValue(id)?.targets
            assertNotNull("$id is in the library", targets)
            assertTrue("$id names a target", targets!!.isNotEmpty())
            val session = LiftSessionRecord(
                id = "s",
                startedAt = "2026-10-01T17:30:00-04:00",
                entries = listOf(LiftEntryRecord(id, List(3) { LiftSetRecord(100.0, WeightUnit.Lb, 5.0, rpe = 8.0, completed = true) })),
            )
            val result = QalaCore.buildEngineState(BuildEngineStateRequest(listOf(session), emptyList(), SettingsRecord()))
            assertEquals("$id is in the library", emptyList<String>(), result.warnings)
            val loaded = QalaCore.stateView(result.state).fatigueMuscle
            for (muscle in targets) {
                assertTrue("$id should load $muscle, loads ${loaded.keys}", (loaded[muscle] ?: 0.0) > 0.0)
            }
        }
    }

    @Test
    fun aSessionsMusclesAreTheDistinctTargetsInFirstSeenOrder() {
        val squat = QalaCore.exerciseMuscles(listOf("squat")).getValue("squat")!!.targets
        val bench = QalaCore.exerciseMuscles(listOf("benchPress")).getValue("benchPress")!!.targets
        val expected = (squat + bench).distinct()
        assertEquals(expected, QalaCore.sessionMuscles(listOf("squat", "benchPress", "squat")))
        assertEquals("a repeated exercise adds nothing", QalaCore.sessionMuscles(listOf("squat")), QalaCore.sessionMuscles(listOf("squat", "squat")))
    }

    @Test
    fun anUnknownExerciseHasNoMusclesAndAnEmptySessionNeedsNoCall() {
        assertNull(QalaCore.exerciseMuscles(listOf("zzz")).getValue("zzz"))
        assertEquals(emptyList<String>(), QalaCore.sessionMuscles(listOf("zzz")))
        assertEquals(emptyList<String>(), QalaCore.sessionMuscles(emptyList()))
    }
}
