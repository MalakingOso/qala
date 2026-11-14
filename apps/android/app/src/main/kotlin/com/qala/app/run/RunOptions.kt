package com.qala.app.run

import com.qala.data.core.RunAutoPauseOptions
import com.qala.data.core.RunCueOptions
import com.qala.data.core.RunOpts
import com.qala.data.model.CueEvery
import com.qala.data.model.RunningSettings
import com.qala.data.model.WeightUnit

private const val MileM = 1609.344

/**
 * The recorder's options from Running in Settings: the cue interval in the lifter's unit (miles with pounds, kilometres with
 * kilograms), the splits at the same unit, and auto-pause off by a threshold nothing falls under.
 */
fun runOpts(running: RunningSettings, unit: WeightUnit): RunOpts {
    val metric = unit == WeightUnit.Kg
    val cues = if (!running.cues) null else when (running.cueEvery) {
        CueEvery.Half -> RunCueOptions(everyDistM = if (metric) 500.0 else MileM / 2)
        CueEvery.One -> RunCueOptions(everyDistM = if (metric) 1000.0 else MileM)
        CueEvery.Time -> RunCueOptions(everySec = 300.0)
    }
    return RunOpts(
        autopause = if (running.autopause) null else RunAutoPauseOptions(lowMps = 0.0),
        splitM = if (metric) 1000.0 else null,
        cues = cues,
    )
}
