package com.qala.app.today

import com.qala.app.checkin.CheckInPlan
import com.qala.app.checkin.checkInPlan
import com.qala.app.skip.SkipRequest
import com.qala.app.skip.skipRequest
import com.qala.data.core.ReadinessSummary
import com.qala.data.core.TrendDirection
import com.qala.data.engine.EngineSnapshot
import com.qala.data.model.RunZone
import com.qala.data.model.SkipReason
import com.qala.data.model.WeightUnit
import com.qala.data.today.DayKind
import com.qala.data.today.DayStatus
import com.qala.data.today.DayStage
import com.qala.data.today.StageId
import com.qala.data.today.StageState
import com.qala.data.today.TodayPlan
import com.qala.design.RailStage
import com.qala.design.StageDotState
import com.qala.design.nowIndex
import kotlin.math.abs
import kotlin.math.roundToInt

/*
 * What Today shows, as plain data. Everything here is a pure function of the engine snapshot (no Compose, no Rust, no
 * clock), so the copy, the empty states and the rail mapping are unit tested on the JVM. The composables in
 * TodayScreen read these and add nothing of their own.
 */

/** Where a button on Today goes. The shell turns each into a route or a tab. */
enum class Destination { CheckIn, WarmUp, Workout, Run, Plan, Body, Settings, Skip }

/** A button's icon, named here so this file needs no Compose. */
enum class CtaIcon { None, CircleCheck, Flame, Dumbbell, SportShoe }

data class Cta(val label: String, val to: Destination, val icon: CtaIcon = CtaIcon.None)

/** One layout per stage hero. The two interludes share one. */
enum class HeroLayout { CheckIn, WarmUp, Lift, Run, Interlude }

/**
 * The big number of a hero: "112.5 lb × 3+" for the lift's top set, "4.0 mi" for a run. [label] sits over it,
 * [value] and [times] are set in the hero numeral face and [unit] in the record face.
 */
class HeroFigure(val label: String, val value: String, val unit: String?, val times: String? = null) {
    val text: String get() = listOfNotNull(value, unit, times?.let { "× $it" }).joinToString(" ")
}

/**
 * The first card of Today: the stage being looked at. [cta] stays on a stage that is only being previewed but
 * [ctaEnabled] is then false, so the preview is read-only.
 */
data class Hero(
    val stage: StageId,
    val layout: HeroLayout,
    val kicker: String,
    val title: String,
    val subtitle: String? = null,
    val figure: HeroFigure? = null,
    val lines: List<String> = emptyList(),
    val detail: String? = null,
    val cta: Cta? = null,
    val ctaEnabled: Boolean = true,
    /** The quiet "Skip today" under the button, on the stage the day is on while nothing is skipped. */
    val skip: Cta? = null,
    /** True when this is the stage the day is on, so the kicker reads in the accent colour. */
    val now: Boolean = false,
)

/** A plain card: a label, a title and a few lines, with an optional action. Next run, readiness and body weight. */
class InfoCard(
    val kicker: String,
    val title: String,
    val lines: List<String> = emptyList(),
    val action: Cta? = null,
    /** True when the card is saying there is nothing to show yet. */
    val empty: Boolean = false,
)

/** One weekday of the week card. [planned] and [done] are engine load units. */
class WeekCell(
    val letter: String,
    val dayName: String,
    val kind: DayKind,
    val planned: Double,
    val done: Double,
    val today: Boolean,
    /** Why a day that would have trained is off (a skip or a status); null for every other day. */
    val reason: SkipReason? = null,
) {
    val training: Boolean get() = kind == DayKind.LIFT
}

class WeekCard(
    val kicker: String,
    val title: String,
    val cells: List<WeekCell>,
    val caption: String?,
    val action: Cta? = null,
    val empty: Boolean = false,
)

/** What the screen can show: waiting for the first build, a build that failed, or the day. */
sealed interface TodayLoad {
    data object Loading : TodayLoad
    class Failed(val message: String) : TodayLoad
    class Ready(val model: TodayModel) : TodayLoad
}

fun todayLoad(snapshot: EngineSnapshot, use24h: Boolean): TodayLoad = when {
    snapshot.error != null -> TodayLoad.Failed(snapshot.error!!)
    !snapshot.loaded -> TodayLoad.Loading
    snapshot.today == null -> TodayLoad.Failed("Today has nothing to show yet.")
    else -> TodayLoad.Ready(TodayModel(snapshot, snapshot.today!!, use24h))
}

/** Today for one snapshot: the head, the rail, the hero for any stage, and the four other cards. */
class TodayModel(private val snapshot: EngineSnapshot, val plan: TodayPlan, private val use24h: Boolean) {
    val stages: List<RailStage> = railStages(plan, use24h)
    val nowIndex: Int = nowIndex(stages)
    val eyebrow: String = headEyebrow(snapshot, plan)

    /** The day's name, as the menu's title. */
    val menuTitle: String = weekdayName(plan.date)

    val nextRun: InfoCard = nextRunCard(snapshot)
    val readiness: InfoCard = readinessCard(snapshot)
    val week: WeekCard = weekCard(snapshot)
    val weight: InfoCard = weightCard(snapshot)

    /** What the check-in screen asks about today. */
    val checkIn: CheckInPlan = checkInPlan(snapshot, plan)

    /** What is on today (a skip or a status), as the card at the top of Today says it; null when nothing is. */
    val status: StatusCard? = statusCard(snapshot.status, snapshot.date)

    /** The records behind [status], for Undo and "I am better" to act on. */
    val dayStatus: DayStatus? = snapshot.status

    /** What the skip sheet opens with: a new skip, or a change of the status already on today. */
    val skip: SkipRequest = skipRequest(snapshot.date, snapshot.status)

    fun hero(viewing: Int): Hero = heroFor(snapshot, plan, viewing, nowIndex, use24h)
}

// ---- the rail ----

val StageId.label: String
    get() = when (this) {
        StageId.CHECK_IN -> "Check-in"
        StageId.WARM_UP -> "Warm-up"
        StageId.LIFT -> "Lift"
        StageId.RUN -> "Run"
        StageId.RECOVER -> "Recover"
        StageId.WIND_DOWN -> "Wind down"
    }

/** The rail's id for a stage: stable across days, so a preview survives the list changing shape. */
val StageId.railId: String
    get() = when (this) {
        StageId.CHECK_IN -> "check-in"
        StageId.WARM_UP -> "warm-up"
        StageId.LIFT -> "lift"
        StageId.RUN -> "run"
        StageId.RECOVER -> "recover"
        StageId.WIND_DOWN -> "wind-down"
    }

/** Today's stages as the rail and its menu read them. A done stage carries its time, read at the record's own offset. */
fun railStages(plan: TodayPlan, use24h: Boolean): List<RailStage> = plan.stages.map { s ->
    RailStage(
        id = s.id.railId,
        label = s.id.label,
        state = when (s.state) {
            StageState.DONE -> StageDotState.Done
            StageState.NOW -> StageDotState.Now
            StageState.LATER -> StageDotState.Later
            StageState.SKIPPED -> StageDotState.Skipped
        },
        interlude = s.passive,
        doneTime = if (s.state == StageState.DONE) s.doneAtMs?.let { formatClock(it, s.doneOffsetMin ?: 0, use24h) } else null,
    )
}

/**
 * The line over the page title: the weekday and what kind of day it is. The web's "Strength block 2 / week 3" has no
 * source on the phone yet, so a lift day names the program and its day instead.
 */
fun headEyebrow(snapshot: EngineSnapshot, plan: TodayPlan): String {
    val day = weekdayName(plan.date)
    val hero = snapshot.liftHero
    return when {
        plan.liftDay && hero != null -> "$day · ${hero.programName} ${hero.dayName.replaceFirstChar { it.lowercase() }}"
        plan.liftDay && plan.programDay == null -> "$day · No program yet"
        plan.liftDay -> "$day · Lift day"
        plan.skipReason != null -> "$day · Rest day, ${reasonWord(plan.skipReason!!)}"
        else -> "$day · Rest day"
    }
}

// ---- the hero ----

/**
 * The hero for the stage at [viewing]. [nowIndex] is the stage the day is on: the hero's label says Now when they are
 * the same and Preview when they are not, and only the stage that is now has a live button.
 */
fun heroFor(snapshot: EngineSnapshot, plan: TodayPlan, viewing: Int, nowIndex: Int, use24h: Boolean): Hero {
    val stage = plan.stages[viewing.coerceIn(0, plan.stages.lastIndex)]
    val isNow = viewing == nowIndex
    val kicker = kicker(stage, isNow)
    val live = isNow
    val done = doneLine(stage, use24h)
    val hero = when (stage.id) {
        StageId.CHECK_IN -> when (stage.state) {
            StageState.DONE -> Hero(
                stage.id, HeroLayout.CheckIn, kicker, "Checked in",
                lines = listOfNotNull(done, readinessLine(snapshot.readiness, checkedIn = true)),
            )
            StageState.SKIPPED -> skipped(stage.id, HeroLayout.CheckIn, kicker)
            else -> Hero(
                stage.id, HeroLayout.CheckIn, kicker, "How are you walking in?",
                lines = listOf(checkInLine(plan)),
                cta = Cta("Check in", Destination.CheckIn, CtaIcon.CircleCheck),
                ctaEnabled = live,
            )
        }

        StageId.WARM_UP -> when (stage.state) {
            StageState.DONE -> Hero(stage.id, HeroLayout.WarmUp, kicker, "Warm-up done", lines = listOfNotNull(done))
            StageState.SKIPPED -> skipped(stage.id, HeroLayout.WarmUp, kicker)
            else -> if (plan.programDay == null) {
                noProgram(stage.id, HeroLayout.WarmUp, kicker, "Warm-up", live)
            } else {
                Hero(
                    stage.id, HeroLayout.WarmUp, kicker, "Warm-up",
                    subtitle = snapshot.liftHero?.let { "Before ${it.exerciseName.lowercase()} day" },
                    lines = listOf("Get the joints moving, then ramp up to the first working set."),
                    cta = Cta("Start warm-up", Destination.WarmUp, CtaIcon.Flame),
                    ctaEnabled = live,
                )
            }
        }

        StageId.LIFT -> when (stage.state) {
            StageState.DONE -> Hero(
                stage.id, HeroLayout.Lift, kicker, "Lift done",
                subtitle = snapshot.liftHero?.let { "${it.dayName}, ${it.exerciseName.lowercase()} day" },
                lines = listOfNotNull(done),
            )
            StageState.SKIPPED -> skipped(stage.id, HeroLayout.Lift, kicker)
            else -> liftHero(snapshot, plan, kicker, live)
        }

        StageId.RUN -> when (stage.state) {
            StageState.DONE -> Hero(stage.id, HeroLayout.Run, kicker, "Run done", lines = listOfNotNull(done))
            StageState.SKIPPED -> skipped(stage.id, HeroLayout.Run, kicker)
            else -> runHero(snapshot, plan, kicker, live)
        }

        StageId.RECOVER -> Hero(
            stage.id, HeroLayout.Interlude, kicker, "Recover",
            lines = listOf(
                if (plan.liftDay) "Eat and drink well and keep moving gently. The easy run stays easy if you recover first."
                else "Rest day. Eat well, drink water and take a walk.",
            ),
            cta = Cta("See plan", Destination.Plan),
            ctaEnabled = live,
        )

        StageId.WIND_DOWN -> Hero(
            stage.id, HeroLayout.Interlude, kicker,
            if (plan.now == null) "Day complete" else "Wind down",
            lines = listOf(
                if (plan.now == null) "Nothing left for today. Sleep well."
                else "Screens down and lights low. The day is complete when its work is done.",
            ),
            cta = Cta("See plan", Destination.Plan),
            ctaEnabled = live,
        )
    }
    val open = stage.state == StageState.NOW
    return hero.copy(
        now = isNow && stage.state != StageState.DONE && stage.state != StageState.SKIPPED,
        skip = if (isNow && open && !stage.passive && plan.liftDay && snapshot.status == null) Cta("Skip today", Destination.Skip) else null,
    )
}

private fun kicker(stage: DayStage, isNow: Boolean): String {
    val name = stage.id.label.lowercase()
    return when {
        stage.state == StageState.DONE -> "Done · $name"
        stage.state == StageState.SKIPPED -> "Skipped · $name"
        isNow -> "Now · $name"
        else -> "Preview · $name"
    }
}

private fun doneLine(stage: DayStage, use24h: Boolean): String? =
    if (stage.state == StageState.DONE) stage.doneAtMs?.let { "Done at ${formatClock(it, stage.doneOffsetMin ?: 0, use24h)}." } else null

private fun skipped(id: StageId, layout: HeroLayout, kicker: String) =
    Hero(id, layout, kicker, "${id.label} skipped", lines = listOf("Not logged today. The plan carries on."))

private fun noProgram(id: StageId, layout: HeroLayout, kicker: String, title: String, live: Boolean) = Hero(
    id, layout, kicker, title,
    lines = listOf("No program yet. Add one in Plan and Today shows your warm-up and lift."),
    cta = Cta("Open Plan", Destination.Plan),
    ctaEnabled = live,
)

private fun checkInLine(plan: TodayPlan): String = when {
    plan.skipReason != null -> "Today is off (${reasonWord(plan.skipReason!!)}). Check in, then rest."
    !plan.liftDay -> "Rest day. Check in, then recover."
    plan.programDay == null -> "Check in to set today's readiness."
    else -> "Check in to set today's loads."
}

private fun liftHero(snapshot: EngineSnapshot, plan: TodayPlan, kicker: String, live: Boolean): Hero {
    val hero = snapshot.liftHero
    if (plan.programDay == null) return noProgram(StageId.LIFT, HeroLayout.Lift, kicker, "Lift", live)
    if (hero == null) {
        return Hero(
            StageId.LIFT, HeroLayout.Lift, kicker, "Lift",
            lines = listOf("The program has nothing prescribed for this day."),
        )
    }
    val top = hero.topSet
    return Hero(
        StageId.LIFT, HeroLayout.Lift, kicker, hero.dayName,
        subtitle = "${hero.exerciseName} day",
        figure = if (top.weight == null) {
            HeroFigure("Your top set", trimNumber(top.reps), "reps")
        } else {
            HeroFigure("Your top set", trimNumber(top.weight!!), unitName(top.unit), trimNumber(top.reps) + if (top.amrap) "+" else "")
        },
        lines = listOfNotNull(
            snapshot.injured.firstOrNull()?.let { "Adjusted around your ${muscleName(it)}. Direct work for it is off." },
            readinessLine(snapshot.readiness, checkedIn = snapshot.readiness?.checkedInToday == true),
        ),
        detail = "${plural(hero.exerciseCount, "exercise")} · ${plural(hero.setCount, "set")}",
        cta = Cta("Start workout", Destination.Workout, CtaIcon.Dumbbell),
        ctaEnabled = live,
    )
}

private fun runHero(snapshot: EngineSnapshot, plan: TodayPlan, kicker: String, live: Boolean): Hero {
    val next = snapshot.nextRun
    val unit = snapshot.unit
    return when {
        next != null && next.date == plan.date -> Hero(
            StageId.RUN, HeroLayout.Run, kicker, next.plan.label,
            figure = HeroFigure("Distance", distanceIn(unit, next.plan.distanceM), distanceUnit(unit)),
            lines = listOf(effortText(next.plan.zone) + "."),
            cta = Cta("Start run", Destination.Run, CtaIcon.SportShoe),
            ctaEnabled = live,
        )

        next != null -> Hero(
            StageId.RUN, HeroLayout.Run, kicker, "No run today",
            lines = listOf("Your next run is ${dayWord(plan.date, next.date)}: ${next.plan.label.lowercase()}, ${distanceIn(unit, next.plan.distanceM)} ${distanceUnit(unit)}."),
            cta = Cta("Start a run", Destination.Run, CtaIcon.SportShoe),
            ctaEnabled = live,
        )

        else -> Hero(
            StageId.RUN, HeroLayout.Run, kicker, "No run planned",
            lines = listOf("Plan a run and it shows here. You can still start one."),
            cta = Cta("Start a run", Destination.Run, CtaIcon.SportShoe),
            ctaEnabled = live,
        )
    }
}

/** The effort a planned run asks for, in words. The plan holds a zone and a distance, not a pace. */
fun effortText(zone: RunZone): String = when (zone) {
    RunZone.Easy -> "Conversational pace"
    RunZone.Steady -> "Even pace"
    RunZone.Hard -> "Hard effort"
}

private fun plural(n: Int, word: String) = if (n == 1) "1 $word" else "$n ${word}s"

// ---- readiness ----

/** The score on the web's 0 to 100 scale. */
fun scorePoints(score: Double): Int = (score * 100).roundToInt()

/** How a score sits against the 28-day average, in a few words. */
fun againstAverage(points: Int, average: Int): String {
    val gap = points - average
    return when {
        abs(gap) <= 3 -> "In line with your average"
        gap in -9..-4 -> "A little under your average"
        gap <= -10 -> "Well under your average"
        gap in 4..9 -> "A little above your average"
        else -> "Well above your average"
    }
}

/** "Readiness 72 of 100, a little under your average." for the lift hero, or null when there is nothing to say. */
fun readinessLine(readiness: ReadinessSummary?, checkedIn: Boolean): String? {
    if (readiness == null) return null
    if (readiness.checkinCount28d == 0 && !readiness.checkedInToday) return null
    val points = scorePoints(readiness.today.score)
    val average = readiness.average28d?.let { scorePoints(it) }
    val head = if (checkedIn) "Readiness $points of 100" else "Readiness about $points of 100 before you check in"
    return if (average == null) "$head." else "$head, ${againstAverage(points, average).replaceFirstChar { it.lowercase() }}."
}

fun readinessCard(snapshot: EngineSnapshot): InfoCard {
    val r = snapshot.readiness
    if (r == null || (r.checkinCount28d == 0 && !r.checkedInToday)) {
        return InfoCard(
            "Readiness", "No score yet",
            lines = listOf("Your first check-in sets it. The 28-day average builds as you check in."),
            empty = true,
        )
    }
    val points = scorePoints(r.today.score)
    val average = r.average28d?.let { scorePoints(it) }
    val ready = readyDatesSentence(r, snapshot.date)
    return InfoCard(
        kicker = if (r.checkedInToday) "Readiness · $points of 100" else "Readiness · estimate $points of 100",
        title = if (average == null) "No average yet" else againstAverage(points, average),
        lines = listOfNotNull(
            average?.let { "Your 28-day average is $it." },
            if (r.checkedInToday) null else "This is an estimate from training. Check in to firm it up.",
            ready,
        ),
    )
}

/**
 * Which muscles are not ready yet, in plain words: "Quads ready Wednesday, everything else is ready now." Muscles that
 * come back the same day share a clause, and one still loaded after the cap says so.
 */
fun readyDatesSentence(readiness: ReadinessSummary, today: String): String {
    if (readiness.readyDates.isEmpty()) return "Everything is ready now."
    val clauses = readiness.readyDates.groupBy { it.date to it.capped }.map { (key, group) ->
        val names = joinWords(group.map { muscleName(it.muscle) })
        val (date, capped) = key
        if (capped) "$names still loaded after three weeks" else "$names ready ${dayWord(today, date)}"
    }
    // One clause reads as a sentence with its tail; several are set off with semicolons, since a clause can hold a list.
    return if (clauses.size == 1) {
        clauses[0].capitalized() + ", everything else is ready now."
    } else {
        clauses.joinToString("; ").capitalized() + ". Everything else is ready now."
    }
}

// ---- next run ----

fun nextRunCard(snapshot: EngineSnapshot): InfoCard {
    val next = snapshot.nextRun
    if (next == null) {
        return InfoCard(
            "Next run", "No run planned",
            lines = listOf("Runs you plan show up here with distance and effort."),
            action = Cta("Plan a run", Destination.Plan),
            empty = true,
        )
    }
    val unit = snapshot.unit
    return InfoCard(
        kicker = "Next run · ${dayWord(snapshot.date, next.date)}",
        title = "${next.plan.label} · ${distanceIn(unit, next.plan.distanceM)} ${distanceUnit(unit)}",
        lines = listOf(effortText(next.plan.zone)),
    )
}

// ---- this week ----

private val Letters = listOf("M", "T", "W", "T", "F", "S", "S")
private val DayNames = listOf("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")

fun weekCard(snapshot: EngineSnapshot): WeekCard {
    val week = snapshot.week
    val load = snapshot.weekLoad
    val cells = (0..6).map { i ->
        val day = week?.days?.getOrNull(i)
        WeekCell(
            letter = Letters[i],
            dayName = DayNames[i],
            kind = day?.kind ?: DayKind.REST,
            planned = load?.planned?.getOrNull(i) ?: 0.0,
            done = load?.done?.getOrNull(i) ?: 0.0,
            today = day != null && day.date == snapshot.date,
            reason = day?.reason,
        )
    }
    val planned = cells.sumOf { it.planned }
    val done = cells.sumOf { it.done }
    if (planned <= 0.0 && done <= 0.0) {
        val days = cells.filter { it.training }.map { it.dayName.take(3) }
        return WeekCard(
            kicker = "This week",
            title = "Nothing planned",
            cells = cells,
            caption = if (days.isEmpty()) "No training days are set. Pick them in Settings."
            else "Your training days are ${joinWords(days)}. Change them in Settings.",
            action = Cta("Open Settings", Destination.Settings),
            empty = true,
        )
    }
    val today = cells.firstOrNull { it.today }
    return WeekCard(
        kicker = "This week",
        title = if (planned <= 0.0) "${loadUnits(done)} load done" else "${loadUnits(done)} of ${loadUnits(planned)} load done",
        cells = cells,
        caption = today?.let {
            when {
                it.reason != null -> "Today is skipped (${reasonWord(it.reason)}). ${if (snapshot.status?.shifts == true) "The plan shifts out." else "The plan holds."}"
                it.planned <= 0.0 && it.done <= 0.0 -> "Today is a rest day."
                else -> "Today: ${loadUnits(it.planned)} planned, ${loadUnits(it.done)} done."
            }
        },
    )
}

// ---- body weight ----

fun weightCard(snapshot: EngineSnapshot): InfoCard {
    val latest = snapshot.latestWeight
    if (latest == null) {
        return InfoCard(
            "Body weight", "No weigh-ins yet",
            lines = listOf("Log a weight and the 7-day trend shows up here."),
            action = Cta("Log weight", Destination.Body),
            empty = true,
        )
    }
    val unit = snapshot.unit
    val name = unitName(unit)
    val trend = snapshot.weightTrend
    val kicker = "Body weight · ${dayWord(snapshot.date, latest.date)}"
    val title = "${weightIn(unit, latest.kg)} $name"
    if (trend == null) {
        return InfoCard(kicker, title, lines = listOf("The 7-day trend shows after three weigh-ins in a week."))
    }
    // The weekly move and the direction are two measurements (this 7-day window against the last, and today's step of
    // the 7-day average) and they can disagree, so each gets its own line and neither is inferred from the other.
    val delta = trend.deltaPerWeekKg?.let { weeklyDelta(unit, it) }
    return InfoCard(
        kicker, title,
        lines = listOfNotNull(
            "7-day average ${weightIn(unit, trend.avg7Kg)} $name.",
            delta,
            directionLine(trend.direction, trend.runDays),
        ),
    )
}

/** "0.9 lb lower than the week before." A move that rounds to nothing is "Same as the week before." */
fun weeklyDelta(unit: WeightUnit, deltaKg: Double): String {
    val shown = oneDecimal(weightValue(unit, abs(deltaKg)))
    return when {
        shown == "0.0" -> "Same as the week before."
        deltaKg < 0 -> "$shown ${unitName(unit)} lower than the week before."
        else -> "$shown ${unitName(unit)} higher than the week before."
    }
}

/** "The 7-day average is down 4 days running." One day is "down today"; a flat average has no run. */
fun directionLine(direction: TrendDirection, runDays: Int): String = when {
    direction == TrendDirection.Flat -> "The 7-day average is flat today."
    runDays >= 2 -> "The 7-day average is ${direction.word} $runDays days running."
    else -> "The 7-day average is ${direction.word} today."
}

private val TrendDirection.word: String
    get() = when (this) {
        TrendDirection.Up -> "up"
        TrendDirection.Down -> "down"
        TrendDirection.Flat -> "flat"
    }

// ---- which stage is on screen ----

/**
 * The index of the stage on screen: the one being previewed, found by its id so a stage list that changes shape (a
 * check-in turning a six-stage day into a different one) cannot point at the wrong row, else the stage the day is on.
 */
fun viewingIndex(stages: List<RailStage>, nowIndex: Int, previewing: String?): Int =
    previewing?.let { id -> stages.indexOfFirst { it.id == id }.takeIf { it >= 0 } } ?: nowIndex

/** What to remember when the screen moves to [index]: nothing (follow now) at the now stage, else that stage's id. */
fun previewFor(stages: List<RailStage>, nowIndex: Int, index: Int): String? =
    if (index == nowIndex || index !in stages.indices) null else stages[index].id
