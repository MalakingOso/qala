package com.qala.app.settings

import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.qala.app.LocalAppContainer
import com.qala.app.plates.PlateFace
import com.qala.app.plates.pairsText
import com.qala.app.skip.apply
import com.qala.app.skip.skipIcon
import com.qala.app.skip.undoWrites
import com.qala.app.today.TodayLoad
import com.qala.app.today.TodayUiState
import com.qala.data.model.GymSettings
import com.qala.data.model.PlateSettings
import com.qala.data.model.SettingsRecord
import com.qala.data.model.WeightUnit
import com.qala.data.repo.SettingsRepository
import com.qala.design.DayStrip
import com.qala.design.FlowHead
import com.qala.design.GearSlot
import com.qala.design.Group
import com.qala.design.GroupRow
import com.qala.design.LinkButton
import com.qala.design.Qala
import com.qala.design.QalaIcon
import com.qala.design.QalaIcons
import com.qala.design.QalaSwitch
import com.qala.design.QalaText
import com.qala.design.QalaType
import com.qala.design.RowStepper
import com.qala.design.ScalePicker
import com.qala.design.SecondaryButton
import com.qala.design.ToggleRow
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.launch

/** Where Settings opens scrolled to, when something sent the lifter to one group of it. */
enum class SettingsFocus {
    /** The plate calculator's Edit plates: the inventory is edited here. */
    Plates,
}

private val GroupGap = 14.dp

/**
 * Settings (DESIGN 7.13), in the web's order: Training status, then Training days (the weekday picker), Units, Bars and
 * plates (with the inventory under it as Your plates), Equipment you own, Warm-up and Rest timer. Every row is stored
 * (SettingsRepository: the core's training group for the unit and the days, the lifting groups for the rest) and the
 * lifting flow, the plate calculator and the warm-up read the stored values.
 *
 * Left out on purpose: the web's Learn from taps and Alert (the rest model does not learn and the alert is a buzz, so
 * there is nothing to set), Check-ins (the daily sleep and stress check-in does not exist on Android), Running (run
 * recording is not built), Coach and Appearance (their screens are not built).
 *
 * Each tap shows its result at once and hands over to the stored value when it catches up, so two quick taps on a stepper
 * do not undo each other, and the writes go in tap order. Today's skip sheet opens over this screen from Change, and Set
 * active ends the status the way Today's Undo does.
 */
@Composable
fun SettingsScreen(
    scroll: ScrollState,
    today: TodayLoad,
    ui: TodayUiState,
    focus: SettingsFocus?,
    onFocused: () -> Unit,
    onBack: () -> Unit,
    onPlates: () -> Unit,
) {
    val c = Qala.colors
    val container = LocalAppContainer.current
    val stored by container.settings.settings.collectAsState(initial = SettingsRecord())
    val model = (today as? TodayLoad.Ready)?.model

    // The weekday strip shows the tap at once and hands over to the stored value when it catches up.
    var pending by remember { mutableStateOf<List<Int>?>(null) }
    LaunchedEffect(stored.trainingWeekdays) { if (pending == stored.trainingWeekdays.sorted()) pending = null }
    val days = pending ?: stored.trainingWeekdays.sorted()

    var pendingUnit by remember { mutableStateOf<WeightUnit?>(null) }
    LaunchedEffect(stored.unit) { if (pendingUnit == stored.unit) pendingUnit = null }
    val unit = pendingUnit ?: stored.unit

    val storedGym by container.settings.gym.collectAsState(initial = GymSettings())
    var pendingGym by remember { mutableStateOf<GymSettings?>(null) }
    LaunchedEffect(storedGym) { if (pendingGym == storedGym) pendingGym = null }
    val gym = pendingGym ?: storedGym

    /**
     * Shows [next] now and stores it with [write]. The write starts undispatched on the container's scope, so it is queued
     * in tap order and outlives the screen; a write that fails drops the shown value back to the stored one.
     */
    fun edit(next: GymSettings, write: suspend SettingsRepository.() -> Unit) {
        pendingGym = next
        container.scope.launch(start = CoroutineStart.UNDISPATCHED) {
            try {
                container.settings.write()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                pendingGym = null
            }
        }
    }

    val platesRequester = remember { BringIntoViewRequester() }
    LaunchedEffect(focus) {
        if (focus == SettingsFocus.Plates) {
            withFrameNanos { }
            withFrameNanos { }
            platesRequester.bringIntoView()
            onFocused()
        }
    }

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(scroll)
            .statusBarsPadding()
            .padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 24.dp),
    ) {
        FlowHead("Settings", onBack)

        // ---- training status ----
        val status = model?.let { statusLine(it.dayStatus) }
        Group(
            "Training status",
            action = {
                if (model != null) {
                    LinkButton(
                        "Change",
                        onClick = { ui.skip.show(model.skip) },
                        Modifier.semantics { contentDescription = "Change today's status" },
                    )
                }
            },
        ) {
            if (status == null) {
                GroupRow(last = true) { QalaText("Getting today ready.", style = QalaType.hint, color = c.fgMuted) }
            } else {
                GroupRow(last = !status.set) {
                    QalaIcon(status.reason?.let(::skipIcon) ?: QalaIcons.PersonStanding, null, size = 20.dp)
                    Column(Modifier.weight(1f).semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite }) {
                        QalaText(status.text, style = QalaType.body)
                        QalaText(status.hint, style = QalaType.hint, color = c.fgMuted)
                    }
                }
                if (status.set) {
                    GroupRow(last = true, vertical = 8.dp) {
                        QalaText("Back to training", Modifier.weight(1f), QalaType.body)
                        SecondaryButton(
                            "Set active",
                            onClick = {
                                val day = model?.dayStatus ?: return@SecondaryButton
                                // The container's scope, not the screen's: the status card goes away when the snapshot catches up.
                                container.scope.launch { container.availability.apply(undoWrites(day, model.plan.date)) }
                            },
                            small = true,
                        )
                    }
                }
            }
        }

        // ---- training days ----
        Group("Training days", Modifier.padding(top = GroupGap)) {
            Column(Modifier.fillMaxWidth().padding(14.dp)) {
                QalaText(WeekdayExplanation, Modifier.padding(bottom = 12.dp), QalaType.body.copy(fontSize = 12.5.sp, lineHeight = 17.sp), c.fgSecondary)
                DayStrip(
                    labels = WeekdayLabels,
                    names = WeekdayNames,
                    picked = days.toSet(),
                    onToggle = { day ->
                        val next = toggleWeekday(days, day)
                        if (next != days) {
                            pending = next
                            container.scope.launch { container.settings.setTrainingWeekdays(next) }
                        }
                    },
                    groupLabel = "Training days",
                )
                Row(
                    Modifier.fillMaxWidth().padding(top = 10.dp).semantics(mergeDescendants = true) { contentDescription = weekdaySummary(days) },
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    QalaText(weekdayCount(days), style = QalaType.bodyStrong.copy(fontSize = 12.5.sp, lineHeight = 17.sp), color = c.fg)
                    QalaText(weekdayNames(days), style = QalaType.body.copy(fontSize = 12.sp, lineHeight = 17.sp), color = c.fgMuted)
                }
                QalaText(
                    weekdayWarning(days).orEmpty(),
                    Modifier.padding(top = 8.dp).semantics { liveRegion = LiveRegionMode.Polite },
                    QalaType.body.copy(fontSize = 12.sp, lineHeight = 17.sp),
                    c.fgSecondary,
                )
            }
        }

        // ---- units ----
        Group("Units", Modifier.padding(top = GroupGap)) {
            GroupRow(vertical = 8.dp) {
                QalaText("Weight", Modifier.weight(1f), QalaType.body)
                ScalePicker(
                    labels = UnitLabels,
                    selected = UnitChoices.indexOf(unit),
                    onPick = { i ->
                        val picked = UnitChoices[i]
                        if (picked != unit) {
                            pendingUnit = picked
                            container.scope.launch(start = CoroutineStart.UNDISPATCHED) { container.settings.setUnit(picked) }
                        }
                    },
                    groupLabel = "Weight unit",
                    modifier = Modifier.width(132.dp),
                    cellHeight = 44.dp,
                )
            }
            GroupRow(last = true) {
                QalaText("Distance and pace", Modifier.weight(1f), QalaType.body)
                QalaText(distanceAndPace(unit), style = QalaType.hint, color = c.fgMuted)
            }
        }

        // ---- bars and plates ----
        val plates = gym.plates
        Group(
            "Bars and plates",
            Modifier.padding(top = GroupGap),
            action = {
                LinkButton("Calculator", onClick = onPlates, Modifier.semantics { contentDescription = "Open plate calculator" })
            },
        ) {
            GroupRow(vertical = 8.dp) {
                QalaText("Default bar", Modifier.weight(1f), QalaType.body)
                ScalePicker(
                    labels = DefaultBarLabels,
                    selected = defaultBarIndex(plates.defaultBar),
                    onPick = { i ->
                        val bar = PlateSettings.DefaultBarChoices[i]
                        edit(gym.copy(plates = plates.copy(defaultBar = bar))) { setDefaultBar(bar) }
                    },
                    groupLabel = "Default bar",
                    modifier = Modifier.width(150.dp),
                    cellHeight = 44.dp,
                )
            }
            GroupRow(vertical = 6.dp) {
                QalaText("EZ bar", Modifier.weight(1f), QalaType.body)
                RowStepper(
                    value = barText(plates.ezBar),
                    onStep = { d ->
                        val weight = stepEzBar(plates.ezBar, d)
                        edit(gym.copy(plates = plates.copy(ezBar = weight))) { setEzBar(weight) }
                    },
                    decreaseDescription = "Lighter EZ bar",
                    increaseDescription = "Heavier EZ bar",
                    canDecrease = canStepEzBar(plates.ezBar, -1),
                    canIncrease = canStepEzBar(plates.ezBar, 1),
                    valueWidth = 72.dp,
                )
            }
            val kgNote = kilogramPlatesNote(unit)
            GroupRow(last = kgNote == null) {
                QalaText("Collars", Modifier.weight(1f), QalaType.body)
                QalaText(barText(0.0), style = QalaType.hint, color = c.fgMuted)
            }
            if (kgNote != null) GroupRow(last = true) { QalaText(kgNote, style = QalaType.hint, color = c.fgMuted) }
        }

        // ---- your plates ----
        Group("Your plates", Modifier.padding(top = GroupGap).bringIntoViewRequester(platesRequester)) {
            val on55 = plates.uses55
            GroupRow(vertical = 6.dp) {
                PlateFace(PlateSettings.OptionalPlate, plates.plates, height = PlateChipDp)
                QalaText("55 lb", style = QalaType.body)
                Spacer(Modifier.weight(1f))
                if (on55) {
                    RowStepper(
                        value = text55(plates),
                        onStep = { d ->
                            val next = plates.stepped55(d)
                            edit(gym.copy(plates = next)) { setPlates(next.plates) }
                        },
                        decreaseDescription = "One fewer pair of 55 lb plates",
                        increaseDescription = "One more pair of 55 lb plates",
                        canDecrease = canStep55(plates, -1),
                        canIncrease = canStep55(plates, 1),
                        valueWidth = 58.dp,
                    )
                } else {
                    QalaText(text55(plates), style = QalaType.hint, color = c.fgMuted)
                }
                QalaSwitch(
                    on = on55,
                    onToggle = { on ->
                        val next = plates.with55(if (on) 1.0 else null)
                        edit(gym.copy(plates = next)) { setPlates(next.plates) }
                    },
                    label = "Use 55 lb plates",
                )
            }
            val rows = plateRows(plates)
            rows.forEachIndexed { i, row ->
                GroupRow(last = i == rows.lastIndex, vertical = 6.dp) {
                    PlateFace(row.weight, plates.plates, height = PlateChipDp)
                    QalaText(row.label, Modifier.weight(1f), QalaType.body)
                    RowStepper(
                        value = pairsText(row.pairs),
                        onStep = { d ->
                            val next = plates.stepped(row.weight, d)
                            edit(gym.copy(plates = next)) { setPlates(next.plates) }
                        },
                        decreaseDescription = "One fewer pair of ${row.label} plates",
                        increaseDescription = "One more pair of ${row.label} plates",
                        canDecrease = row.canLess,
                        canIncrease = row.canMore,
                        valueWidth = 64.dp,
                    )
                }
            }
        }

        // ---- equipment ----
        Group("Equipment you own", Modifier.padding(top = GroupGap)) {
            EquipmentRows.forEachIndexed { i, row ->
                ToggleRow(
                    label = row.label,
                    on = gym.equipment.owns(row.item),
                    onToggle = { owned -> edit(gym.copy(equipment = gym.equipment.with(row.item, owned))) { setOwned(row.item, owned) } },
                    last = i == EquipmentRows.lastIndex,
                    leading = { GearSlot(row.gear, width = 64.dp) },
                )
            }
        }

        // ---- warm-up ----
        val warmup = gym.warmup
        val rows = warmupRows(warmup, gym.equipment)
        Group("Warm-up", Modifier.padding(top = GroupGap)) {
            ToggleRow(
                label = "Build a warm-up",
                on = warmup.enabled,
                onToggle = { on -> edit(gym.copy(warmup = warmup.copy(enabled = on))) { setWarmupEnabled(on) } },
            )
            ToggleRow(
                label = "Soft tissue",
                on = warmup.softTissue,
                onToggle = { on -> edit(gym.copy(warmup = warmup.copy(softTissue = on))) { setSoftTissue(on) } },
                enabled = rows.softTissue,
            )
            ToggleRow(
                label = "Prefer Theragun",
                on = warmup.preferPercussion,
                onToggle = { on -> edit(gym.copy(warmup = warmup.copy(preferPercussion = on))) { setPreferPercussion(on) } },
                enabled = rows.preferPercussion,
            )
            GroupRow(Modifier.alpha(if (rows.time) 1f else 0.45f), last = true, vertical = 6.dp) {
                QalaText("Time", Modifier.weight(1f), QalaType.body)
                RowStepper(
                    value = minutesText(warmup.minutes),
                    onStep = { d ->
                        val minutes = stepWarmupMinutes(warmup.minutes, d)
                        edit(gym.copy(warmup = warmup.copy(minutes = minutes))) { setWarmupMinutes(minutes) }
                    },
                    decreaseDescription = "Shorter warm-up",
                    increaseDescription = "Longer warm-up",
                    canDecrease = rows.time && canStepWarmupMinutes(warmup.minutes, -1),
                    canIncrease = rows.time && canStepWarmupMinutes(warmup.minutes, 1),
                    valueWidth = 72.dp,
                )
            }
        }

        // ---- rest timer ----
        Group("Rest timer", Modifier.padding(top = GroupGap)) {
            ToggleRow(
                label = "Automatic rest",
                hint = "Logging a set opens Rest",
                on = gym.rest.auto,
                onToggle = { on -> edit(gym.copy(rest = gym.rest.copy(auto = on))) { setAutoRest(on) } },
            )
            ToggleRow(
                label = "Show plates",
                hint = "On set rows, Rest and the warm-up",
                on = gym.rest.showPlates,
                onToggle = { on -> edit(gym.copy(rest = gym.rest.copy(showPlates = on))) { setShowPlates(on) } },
                last = true,
            )
        }
    }
}

/** The plate faces in Settings rows are a little smaller than the calculator's, so a stepper fits beside the 55s. */
private const val PlateChipDp = 32f
