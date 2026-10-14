package com.qala.data.core

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.nullable
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonPrimitive
import uniffi.qala_ffi.chooseNextPlates as ffiChooseNextPlates
import uniffi.qala_ffi.describeChange as ffiDescribeChange
import uniffi.qala_ffi.planPlates as ffiPlanPlates
import uniffi.qala_ffi.platesShorthand as ffiPlatesShorthand
import uniffi.qala_ffi.roundWeight as ffiRoundWeight

// ---- plates (qala-core plates.rs; docs/rust-core.md R2) ----
// The TS plate math in packages/core stays the oracle; these DTOs are the
// Kotlin face of the Rust port, checked against it by the golden vectors.

/** How many pairs of a plate the inventory holds: a count, or plenty. */
sealed interface PlatePairs {
    data object Enough : PlatePairs
    data class Count(val pairs: Double) : PlatePairs
}

/** On the wire a count is a number and plenty is the string `"enough"`, as in TS. */
object PlatePairsSerializer : KSerializer<PlatePairs> {
    override val descriptor: SerialDescriptor =
        PrimitiveSerialDescriptor("com.qala.data.core.PlatePairs", PrimitiveKind.STRING)

    override fun serialize(encoder: Encoder, value: PlatePairs) {
        when (value) {
            PlatePairs.Enough -> encoder.encodeString("enough")
            is PlatePairs.Count -> encoder.encodeDouble(value.pairs)
        }
    }

    override fun deserialize(decoder: Decoder): PlatePairs {
        val element = (decoder as JsonDecoder).decodeJsonElement()
        val primitive = element.jsonPrimitive
        return if (primitive.isString) {
            require(primitive.content == "enough") { "pairs must be a count or \"enough\"" }
            PlatePairs.Enough
        } else {
            PlatePairs.Count(primitive.double)
        }
    }
}

/** One inventory row: a plate weight and how many pairs are available. */
@Serializable
data class PlateEntry(
    val weight: Double,
    @Serializable(with = PlatePairsSerializer::class) val pairs: PlatePairs,
    val color: String = "",
)

/** Plates on one side, heaviest first, with the totals the screen shows. */
@Serializable
data class PlateLoad(
    val perSide: List<Double>,
    val perSideTotal: Double,
    val total: Double,
    val barWeight: Double,
    val collarWeight: Double,
)

/** The exact load when there is one, and the nearest loadable below and above. */
@Serializable
data class PlatePlan(
    val requestedTotal: Double,
    val barWeight: Double,
    val collarWeight: Double,
    val perSideTarget: Double,
    val exact: PlateLoad? = null,
    val below: PlateLoad? = null,
    val above: PlateLoad? = null,
)

/** A between-set move: the load, how to get there, and what it costs. */
@Serializable
data class NextPlateChoice(
    val load: PlateLoad,
    val instruction: String,
    val keptInner: Int,
    val platesMoved: Int,
)

/** Nearest loadable load: exact, else the nearer of below and above (ties go below). */
fun PlatePlan.nearestLoadable(): PlateLoad? {
    if (exact != null) return exact
    if (below != null && above != null) {
        val dBelow = kotlin.math.abs(below.total - requestedTotal)
        val dAbove = kotlin.math.abs(above.total - requestedTotal)
        return if (dAbove < dBelow) above else below
    }
    return below ?: above
}

@Serializable
private data class PlanPlatesRequest(
    val requestedTotal: Double,
    val barWeight: Double,
    val collarWeight: Double,
    val plates: List<PlateEntry>,
)

@Serializable
private data class RoundWeightRequest(
    val targetWeight: Double,
    val barWeight: Double,
    val collarWeight: Double,
    val plates: List<PlateEntry>,
)

@Serializable
private data class ChooseNextRequest(
    val currentPerSide: List<Double>,
    val nextTotal: Double,
    val barWeight: Double,
    val collarWeight: Double,
    val plates: List<PlateEntry>,
)

@Serializable
private data class DescribeChangeRequest(val currentPerSide: List<Double>, val nextPerSide: List<Double>)

@Serializable
private data class ShorthandRequest(val perSide: List<Double>)

fun QalaCore.planPlates(requestedTotal: Double, barWeight: Double, plates: List<PlateEntry>, collarWeight: Double = 0.0): PlatePlan = call(
    PlanPlatesRequest.serializer(), PlatePlan.serializer(),
    PlanPlatesRequest(requestedTotal, barWeight, collarWeight, plates), ::ffiPlanPlates,
)

/** The loadable total nearest to [targetWeight] (ties go below). */
fun QalaCore.roundWeight(targetWeight: Double, barWeight: Double, plates: List<PlateEntry>, collarWeight: Double = 0.0): Double = call(
    RoundWeightRequest.serializer(), Double.serializer(),
    RoundWeightRequest(targetWeight, barWeight, collarWeight, plates), ::ffiRoundWeight,
)

fun QalaCore.chooseNextPlates(
    currentPerSide: List<Double>,
    nextTotal: Double,
    barWeight: Double,
    plates: List<PlateEntry>,
    collarWeight: Double = 0.0,
): NextPlateChoice? = call(
    ChooseNextRequest.serializer(), NextPlateChoice.serializer().nullable,
    ChooseNextRequest(currentPerSide, nextTotal, barWeight, collarWeight, plates), ::ffiChooseNextPlates,
)

/** E.g. "take off 5, add 25 each side"; "no change" when the loads match. */
fun QalaCore.describeChange(currentPerSide: List<Double>, nextPerSide: List<Double>): String = call(
    DescribeChangeRequest.serializer(), String.serializer(),
    DescribeChangeRequest(currentPerSide, nextPerSide), ::ffiDescribeChange,
)

/** "per side 45 · 45 · 10", or "bar" for an empty bar. */
fun QalaCore.platesShorthand(perSide: List<Double>): String = call(
    ShorthandRequest.serializer(), String.serializer(), ShorthandRequest(perSide), ::ffiPlatesShorthand,
)

/**
 * The default lb inventory from `packages/core/plates.ts` (`defaultLbInventory`):
 * a 45 lb bar gym with 1.25 lb plates listed at zero pairs until the owner
 * enters a real inventory. It is what Settings holds until the inventory is
 * edited there (`PlateSettings`), so the calculator, the plate hints and the
 * warm-up plan on it by default.
 */
val DefaultLbPlates: List<PlateEntry> = listOf(
    PlateEntry(45.0, PlatePairs.Enough, "blue"),
    PlateEntry(35.0, PlatePairs.Enough, "yellow"),
    PlateEntry(25.0, PlatePairs.Enough, "green"),
    PlateEntry(10.0, PlatePairs.Enough, "white"),
    PlateEntry(5.0, PlatePairs.Enough, "charcoal"),
    PlateEntry(2.5, PlatePairs.Enough, "silver"),
    PlateEntry(1.25, PlatePairs.Count(0.0), "silver"),
)
