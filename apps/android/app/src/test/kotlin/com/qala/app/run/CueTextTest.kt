package com.qala.app.run

import com.qala.data.core.RunEvent
import com.qala.data.core.RunExpandedStep
import com.qala.data.core.RunStepKind
import com.qala.data.model.WeightUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class CueTextTest {
    private val mi = 1609.344

    @Test
    fun aDistanceMarkSaysTheDistanceTheMovingTimeAndTheAveragePace() {
        val cue = RunEvent.DistanceCue(1, mi, 552.0, 552.0 / mi)
        assertEquals("1 mile. Time 9 minutes 12 seconds. Average pace 9 minutes 12 seconds per mile.", cueText(cue, WeightUnit.Lb))
        val half = RunEvent.DistanceCue(1, mi / 2, 270.0, 270.0 / (mi / 2))
        assertEquals("0.5 miles. Time 4 minutes 30 seconds. Average pace 9 minutes per mile.", cueText(half, WeightUnit.Lb))
        val km = RunEvent.DistanceCue(2, 2000.0, 600.0, 0.3)
        assertEquals("2 kilometres. Time 10 minutes. Average pace 5 minutes per kilometre.", cueText(km, WeightUnit.Kg))
    }

    @Test
    fun aTimeMarkSaysTheSameThingsAndATimeAnHourInSaysTheHour() {
        assertEquals("1.5 miles. Time 5 minutes. Average pace 3 minutes 20 seconds per mile.", cueText(RunEvent.TimeCue(1, 2414.016, 300.0, 300.0 / 2414.016), WeightUnit.Lb))
        assertEquals("3 miles. Time 1 hour 2 minutes. Average pace 20 minutes 40 seconds per mile.", cueText(RunEvent.DistanceCue(3, 4828.032, 3720.0, 3720.0 / 4828.032), WeightUnit.Lb))
        assertEquals("a marker with no pace yet leaves the pace out", "1 mile. Time 45 seconds.", cueText(RunEvent.DistanceCue(1, mi, 45.0, null), WeightUnit.Lb))
    }

    @Test
    fun aStepStartNamesTheStepItsLengthAndItsTarget() {
        fun step(kind: RunStepKind, distanceM: Double? = null, seconds: Double? = null, mps: Double? = null) =
            RunEvent.StepStart(0, RunExpandedStep(kind, distanceM = distanceM, seconds = seconds, targetMps = mps, index = 0))
        assertEquals("Warm-up, 5 minutes.", cueText(step(RunStepKind.Warmup, seconds = 300.0), WeightUnit.Lb))
        assertEquals("Work, 0.5 miles, target pace 8 minutes per mile.", cueText(step(RunStepKind.Work, distanceM = mi / 2, mps = mi / 480.0), WeightUnit.Lb))
        assertEquals("Recover, 1 minute 30 seconds.", cueText(step(RunStepKind.Recover, seconds = 90.0), WeightUnit.Lb))
        assertEquals("Cool-down.", cueText(step(RunStepKind.Cooldown), WeightUnit.Lb))
    }

    @Test
    fun theCoachingCuesAreOneShortLineEachAndAStepEndStaysQuiet() {
        assertEquals("Speed up a little.", cueText(RunEvent.SpeedUp(0, 3.0), WeightUnit.Lb))
        assertEquals("Slow down a little.", cueText(RunEvent.SlowDown(0, 3.0), WeightUnit.Lb))
        assertEquals("Back in the zone.", cueText(RunEvent.BackInZone(0, 3.0), WeightUnit.Lb))
        assertEquals("Workout complete.", cueText(RunEvent.WorkoutComplete, WeightUnit.Lb))
        assertNull(cueText(RunEvent.StepEnd(0), WeightUnit.Lb))
    }

    @Test
    fun durationsAreSpokenInWholeUnitsWithTheRightPlurals() {
        assertEquals("1 second", spokenDuration(1.0))
        assertEquals("1 minute", spokenDuration(60.0))
        assertEquals("1 minute 1 second", spokenDuration(61.0))
        assertEquals("1 hour", spokenDuration(3600.0))
        assertEquals("2 hours 5 minutes", spokenDuration(7500.0))
    }
}
