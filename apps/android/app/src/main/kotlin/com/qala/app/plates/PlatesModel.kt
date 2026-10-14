package com.qala.app.plates

import com.qala.data.core.DefaultLbPlates
import com.qala.data.core.PlateEntry
import com.qala.data.core.PlateLoad
import com.qala.data.core.PlatePairs
import com.qala.data.model.PlateSettings
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.round

/*
 * The plate calculator's decisions as plain data (DESIGN 7.12): the bars, the target stepping, the
 * arithmetic line, and where every sprite sits. No Compose, so the stepping, the copy and the layout
 * are unit tested on the JVM. The plate math itself is Rust (qala-core plates); this file only
 * presents its result. Sprite placement mirrors apps/web/src/shared/plates.tsx, which placed the
 * same Blender renders by the same inches-along-the-bar geometry.
 */

/** The EZ bar's weight until Settings says otherwise (the web default, `settings.ezBar`). */
const val EzBarWeight = PlateSettings.DefaultEzBar

/** The target the calculator opens on, as the web's does. */
const val DefaultTarget = 245.0
const val TargetStep = 5.0

/** A bar the screen can plan on. [ez] draws the curl bar behind the collar. */
data class BarOption(val label: String, val weight: Double, val ez: Boolean)

/**
 * The cells of the bar picker: the two full-size bars, then the curl bar at the weight Settings has for it ("EZ 25"). A
 * default bar the picker does not offer (one this app never writes) gets a cell of its own, so the picker never lies
 * about the bar a lift is planned with.
 */
fun barOptions(plates: PlateSettings): List<BarOption> {
    val straight = (PlateSettings.DefaultBarChoices + plates.defaultBar).distinct().map { BarOption(fmtWeight(it), it, ez = false) }
    return straight + BarOption("EZ ${fmtWeight(plates.ezBar)}", plates.ezBar, ez = true)
}

/** The cell the calculator shows: the curl bar when the screen has switched to it, else the default bar from Settings. */
fun selectedBarIndex(options: List<BarOption>, plates: PlateSettings, ez: Boolean): Int =
    if (ez) options.lastIndex else options.indexOfFirst { !it.ez && it.weight == plates.defaultBar }.coerceAtLeast(0)

/** Stepping never goes under the bar, as on the web. */
fun stepTarget(current: Double, steps: Int, barWeight: Double): Double =
    max(barWeight, current + steps * TargetStep)

/** `String(Math.round(n * 100) / 100)` for plate weights. */
fun fmtWeight(n: Double): String {
    val v = round(n * 100) / 100
    return if (v == v.toInt().toDouble()) v.toInt().toString() else v.toString()
}

/** The line under the drawing: "45 bar + 2 × 100 = 245", and when the target itself cannot be loaded. */
data class CalcSummary(val main: String, val hint: String?)

fun calcSummary(bar: BarOption, load: PlateLoad?, target: Double): CalcSummary {
    val barName = if (bar.ez) "${fmtWeight(bar.weight)} EZ bar" else "${fmtWeight(bar.weight)} bar"
    val main = "$barName + 2 × ${fmtWeight(load?.perSideTotal ?: 0.0)} = ${load?.let { fmtWeight(it.total) } ?: "—"}"
    val hint = if (load != null && load.total != target) "nearest you can load to ${fmtWeight(target)}" else null
    return CalcSummary(main, hint)
}

/** The caption that names every plate, for TalkBack and for covered faces. */
fun calcCaption(bar: BarOption, perSide: List<Double>, perSideTotal: Double): String =
    if (perSide.isEmpty()) {
        if (bar.ez) "EZ bar, no plates." else "${fmtWeight(bar.weight)} lb bar, no plates."
    } else {
        val side = perSide.joinToString(" · ") { fmtWeight(it) }
        val on = if (bar.ez) "the EZ bar" else "a ${fmtWeight(bar.weight)} lb bar"
        "$side on each side, ${fmtWeight(perSideTotal)} lb a side, on $on"
    }

/** "plenty", "1 pair", "0 pairs": the inventory row's right-hand words. */
fun pairsText(pairs: PlatePairs): String = when (pairs) {
    PlatePairs.Enough -> "plenty"
    is PlatePairs.Count -> {
        val n = pairs.pairs
        "${fmtWeight(n)} ${if (n == 1.0) "pair" else "pairs"}"
    }
}

// ---- sprite choice (plates.tsx THICK / DIAMETER / color rules) ----

/** Thickness in inches (what the renders used). */
val PlateThick: Map<Double, Float> = mapOf(
    55.0 to 3.3f, 45.0 to 2.9f, 35.0 to 2.3f, 25.0 to 1.67f,
    10.0 to 0.94f, 5.0 to 0.75f, 2.5 to 0.6f, 1.25 to 0.5f,
)

private val PlateDiameter: Map<Double, Float> = mapOf(
    55.0 to 17.7f, 45.0 to 17.7f, 35.0 to 17.7f, 25.0 to 17.7f,
    10.0 to 17.7f, 5.0 to 9f, 2.5 to 6.5f, 1.25 to 5f,
)

private val RenderedWeights: List<Double> = PlateThick.keys.sorted()

private val SpriteColors = listOf("red", "blue", "yellow", "green", "white", "charcoal", "silver")

/** Bumper defaults by weight in lb (`BUMPER_COLORS.lb`); anything else is charcoal. */
fun bumperColorLb(weight: Double): String = when (fmtWeight(weight)) {
    "55" -> "red"
    "45" -> "blue"
    "35" -> "yellow"
    "25" -> "green"
    "10" -> "white"
    "5" -> "charcoal"
    "2.5", "1.25" -> "silver"
    else -> "charcoal"
}

/** The plate size to draw for a weight: itself, or the nearest rendered one. */
fun sizeKey(weight: Double): Double =
    if (PlateThick.containsKey(weight)) weight
    else RenderedWeights.reduce { a, b -> if (abs(b - weight) < abs(a - weight)) b else a }

/** Named color for a weight: the inventory's, else the bumper default. */
fun colorName(weight: Double, inventory: List<PlateEntry>): String {
    val named = inventory.firstOrNull { it.weight == weight }?.color?.ifEmpty { null }
        ?: bumperColorLb(weight)
    return when {
        named in SpriteColors -> named
        named == "black" -> "charcoal"
        named == "gray" -> "silver"
        else -> "charcoal"
    }
}

/** The sprite for a plate, in its color if rendered, else the nearest fallback color. */
fun plateSprite(prefix: String, weight: Double, inventory: List<PlateEntry>): PlateSprite? {
    val k = fmtWeight(sizeKey(weight))
    val want = colorName(weight, inventory)
    for (c in listOf(want, "charcoal", "silver", "blue")) {
        PlateSprites.sprites["${prefix}_${k}_$c"]?.let { return it }
    }
    return null
}

/** Face-on sprite height in dp for inventory rows: one size whatever the weight. */
const val FaceChipDp = 38f

// ---- loaded-bar layout (PlateDrawing in plates.tsx) ----

/** The drawing's height in dp; the bottom strip holds the covered plates' weights. */
const val DrawHeightDp = 226f
private const val LabelHeight = 18f
private const val MaxScale = 0.4f

/** One sprite placed in the drawing: its image box in dp and its stacking order. */
data class SpriteDraw(val sprite: PlateSprite, val left: Float, val top: Float, val width: Float, val height: Float, val z: Int)

/** A weight written under an inner plate whose face the next plate covers. */
data class PlateLabel(val text: String, val centerX: Float, val top: Float)

/** The soft ellipse the loaded bar sits on. */
data class FloorEllipse(val cx: Float, val cy: Float, val rx: Float, val ry: Float)

data class PlateLayout(val draws: List<SpriteDraw>, val labels: List<PlateLabel>, val floor: FloorEllipse?)

/**
 * Where every sprite goes for one loaded side, in a drawing [width] dp wide.
 * `u` is inches along the bar from the collar's face; a sprite's `ox, oy` is the
 * point on its image that sits on the axis at `u`. Mirrors the web drawing,
 * apart from the sleeve-end bore clip (noted in the plates report).
 */
fun plateLayout(perSide: List<Double>, ez: Boolean, width: Float, inventory: List<PlateEntry> = DefaultLbPlates): PlateLayout {
    if (width <= 0f) return PlateLayout(emptyList(), emptyList(), null)
    val ax = PlateSprites.AXIS_X
    val ay = PlateSprites.AXIS_Y
    val tile = PlateSprites.TILE_IN
    val endIn = PlateSprites.END_IN
    val thick = perSide.map { PlateThick[sizeKey(it)] ?: 1f }
    val starts = ArrayList<Float>(perSide.size)
    var u = 0f
    for (t in thick) {
        starts.add(u)
        u += t
    }
    val uOuter = u
    val tip = if (perSide.isNotEmpty()) 4.2f else 6.0f
    val uEnd = uOuter + tip
    val collar = PlateSprites.sprites.getValue("bar_collar")
    val endSprite = PlateSprites.sprites.getValue("sleeve_end")
    val plateSprites = perSide.map { plateSprite("plate", it, inventory) }
    val widest = max(plateSprites.maxOfOrNull { it?.ox ?: 0f } ?: 0f, collar.ox)
    val leftPx = widest + 1.2f * ax
    val rightPx = (uEnd - endIn) * ax + (endSprite.w - endSprite.ox)
    val needW = leftPx + rightPx
    val plateH = PlateSprites.sprites.getValue("plate_45_blue").h.toFloat()
    val s = min(MaxScale, min((width - 8f) / needW, (DrawHeightDp - LabelHeight - 6f) / plateH))
    val p0x = (width - needW * s) / 2f + leftPx * s
    val p0y = (DrawHeightDp - LabelHeight) / 2f + 6f
    fun at(uu: Float): Pair<Float, Float> = (p0x + uu * ax * s) to (p0y + uu * ay * s)
    fun draw(sprite: PlateSprite, uu: Float, z: Int): SpriteDraw {
        val (x, y) = at(uu)
        return SpriteDraw(sprite, x - sprite.ox * s, y - sprite.oy * s, sprite.w * s, sprite.h * s, z)
    }
    val draws = ArrayList<SpriteDraw>()
    if (ez) {
        draws.add(draw(PlateSprites.sprites.getValue("ez_back"), 0f, 2))
    } else {
        val knurl = PlateSprites.sprites.getValue("knurl_tile")
        var uu = -7f
        while (at(uu).first + (knurl.w - knurl.ox) * s > 0f) {
            draws.add(draw(knurl, uu, 1))
            uu -= tile
        }
        draws.add(draw(collar, 0f, 2))
    }
    val sleeve = PlateSprites.sprites.getValue("sleeve_tile")
    var su = 0f
    while (su < uOuter + 0.1f) {
        draws.add(draw(sleeve, su, 3))
        su += tile
    }
    plateSprites.forEachIndexed { i, sp -> if (sp != null) draws.add(draw(sp, starts[i], 10 + i)) }
    draws.add(draw(endSprite, uEnd - endIn, 40))
    var lowest = p0y
    plateSprites.forEachIndexed { i, sp ->
        if (sp != null) lowest = max(lowest, at(starts[i]).second + (sp.h - sp.oy) * s)
    }
    val labels = ArrayList<PlateLabel>()
    var lastX = Float.NEGATIVE_INFINITY
    for (i in 0 until (perSide.size - 1).coerceAtLeast(0)) {
        val sp = plateSprites[i] ?: continue
        val x = at(starts[i]).first - sp.ox * s + (thick[i] * ax * s) / 2f
        if (x - lastX < 16f) continue
        lastX = x
        labels.add(PlateLabel(fmtWeight(perSide[i]), x, lowest + 4f))
    }
    val floor = if (perSide.isEmpty()) null else FloorEllipse(
        cx = at(uOuter / 2f).first + 20f * s,
        cy = lowest - 6f * s,
        rx = max(40f, (uOuter * ax + 330f) * s * 0.55f),
        ry = 10f * s + 4f,
    )
    return PlateLayout(draws, labels, floor)
}
