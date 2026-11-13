package com.qala.app.workout

import com.qala.data.model.PlateSettings
import com.qala.data.model.WeightUnit

/** The empty bar the plate math starts from: the default bar in Settings in pounds (45 until it is changed), 20 kg in kilograms. */
fun defaultBarWeight(unit: WeightUnit, setup: PlateSettings = PlateSettings()): Double = if (unit == WeightUnit.Kg) 20.0 else setup.defaultBar

/** How far a weight stepper moves: the smallest pair of plates on each side, 5 lb or 2.5 kg. */
fun weightStep(unit: WeightUnit): Double = if (unit == WeightUnit.Kg) 2.5 else 5.0
