package com.qala.app.run

import com.qala.data.model.CueEvery
import com.qala.data.model.RunningSettings
import com.qala.data.model.WeightUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class RunOptionsTest {
    @Test
    fun theCueIntervalFollowsTheSettingAndTheUnit() {
        assertEquals(804.672, runOpts(RunningSettings(), WeightUnit.Lb).cues!!.everyDistM!!, 1e-9)
        assertEquals(1609.344, runOpts(RunningSettings(cueEvery = CueEvery.One), WeightUnit.Lb).cues!!.everyDistM!!, 1e-9)
        assertEquals(500.0, runOpts(RunningSettings(), WeightUnit.Kg).cues!!.everyDistM!!, 0.0)
        assertEquals(1000.0, runOpts(RunningSettings(cueEvery = CueEvery.One), WeightUnit.Kg).cues!!.everyDistM!!, 0.0)
        val time = runOpts(RunningSettings(cueEvery = CueEvery.Time), WeightUnit.Lb).cues!!
        assertEquals(300.0, time.everySec!!, 0.0)
        assertNull(time.everyDistM)
        assertNull("cues off is no cue options at all", runOpts(RunningSettings(cues = false), WeightUnit.Lb).cues)
    }

    @Test
    fun splitsFollowTheUnitAndAutoPauseOffIsAThresholdNothingFallsUnder() {
        assertNull(runOpts(RunningSettings(), WeightUnit.Lb).splitM)
        assertEquals(1000.0, runOpts(RunningSettings(), WeightUnit.Kg).splitM!!, 0.0)
        assertNull(runOpts(RunningSettings(), WeightUnit.Lb).autopause)
        assertEquals(0.0, runOpts(RunningSettings(autopause = false), WeightUnit.Lb).autopause!!.lowMps!!, 0.0)
    }
}
