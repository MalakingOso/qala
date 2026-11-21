package com.qala.app.plan

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.qala.app.LocalAppContainer
import com.qala.app.settings.weekdayNames
import com.qala.app.workout.formatWeight
import com.qala.app.workout.unitLabel
import com.qala.data.model.SettingsRecord
import com.qala.data.program.BuiltinPlan
import com.qala.data.program.Builtins
import com.qala.data.program.StartResult
import com.qala.data.program.StartingWeights
import com.qala.design.LocalBarClearance
import com.qala.design.Card
import com.qala.design.FlowHead
import com.qala.design.Group
import com.qala.design.GroupLabel
import com.qala.design.GroupRow
import com.qala.design.PrimaryButton
import com.qala.design.Qala
import com.qala.design.QalaText
import com.qala.design.QalaTextField
import com.qala.design.QalaType
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject

private val BodyStyle = QalaType.body.copy(fontSize = 13.sp, lineHeight = 19.sp)

/**
 * The plan picker, pushed over Plan: a card for each built-in plan, then, for the one tapped, the starting weights it needs
 * and a Start button. Start writes on the container's scope (see [AppContainer.planStarter]), so going back mid-write cannot
 * leave a plan half chosen. Back from the weights returns to the list.
 */
@Composable
fun PlanPickerScreen(scroll: ScrollState, onBack: () -> Unit) {
    val container = LocalAppContainer.current
    val active by container.programs.active.collectAsState(initial = null)
    val record by container.settings.settings.collectAsState(initial = null)
    val data by container.settings.exerciseData.collectAsState(initial = null)
    var pickedId by rememberSaveable { mutableStateOf<String?>(null) }
    val picked = Builtins.byId(pickedId)
    BackHandler(enabled = picked != null) { pickedId = null }

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(scroll)
            .statusBarsPadding()
            .padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 24.dp + LocalBarClearance.current),
    ) {
        FlowHead(picked?.name ?: "Choose a plan", onBack = { if (picked != null) pickedId = null else onBack() })
        val settings = record
        val exerciseData = data
        when {
            settings == null || exerciseData == null -> Unit
            picked == null -> {
                QalaText("A plan starts at week 1. What you have logged stays in History.", Modifier.padding(bottom = 12.dp), QalaType.hint, Qala.colors.fgMuted)
                for (plan in Builtins.all) {
                    PlanCard(plan, current = active?.id == plan.id, onClick = { pickedId = plan.id })
                    Spacer(Modifier.height(12.dp))
                }
            }
            else -> StartingWeightsStep(picked, current = active?.id == picked.id, settings, exerciseData, onStarted = onBack)
        }
    }
}

@Composable
private fun PlanCard(plan: BuiltinPlan, current: Boolean, onClick: () -> Unit) {
    val c = Qala.colors
    Card(
        Modifier
            .clickable(role = Role.Button, onClickLabel = "Choose ${plan.name}", onClick = onClick)
            .semantics(mergeDescendants = true) {},
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            QalaText(plan.name, Modifier.weight(1f), QalaType.cardTitle, c.fg)
            if (current) GroupLabel("Current", color = c.accent)
        }
        QalaText("${plan.daysPerWeek} days a week · ${plan.audience}", Modifier.padding(top = 2.dp), QalaType.hint, c.fgMuted)
        QalaText(plan.blurb, Modifier.padding(top = 10.dp), BodyStyle, c.fgSecondary)
    }
}

/** One row a lift, prefilled from the lifter's 1RMs where they have them; Start stays off until every row holds a weight. */
@Composable
private fun StartingWeightsStep(plan: BuiltinPlan, current: Boolean, settings: SettingsRecord, exerciseData: JsonObject, onStarted: () -> Unit) {
    val c = Qala.colors
    val container = LocalAppContainer.current
    val unit = settings.unit
    var texts by rememberSaveable(plan.id) {
        mutableStateOf(plan.startingLifts.map { lift -> StartingWeights.prefill(lift, exerciseData, unit)?.let(::formatWeight) ?: "" })
    }
    var message by rememberSaveable { mutableStateOf<String?>(null) }
    var starting by remember { mutableStateOf(false) }
    val weights = texts.map { it.toDoubleOrNull() }
    val ready = weights.all { it != null && it > 0.0 }
    val ui = rememberCoroutineScope()

    Group("Starting weights") {
        plan.startingLifts.forEachIndexed { i, lift ->
            GroupRow(last = i == plan.startingLifts.lastIndex) {
                Column(Modifier.weight(1f)) {
                    QalaText(lift.name, style = QalaType.bodyStrong, color = c.fg)
                    QalaText("heaviest for ${lift.reps} clean reps", style = QalaType.hint, color = c.fgMuted)
                }
                QalaTextField(
                    value = texts[i],
                    onValueChange = { v -> texts = texts.toMutableList().also { it[i] = v.replace(',', '.').filter { ch -> ch.isDigit() || ch == '.' } } },
                    placeholder = "0",
                    label = "${lift.name} weight in ${unitLabel(unit)}",
                    modifier = Modifier.width(96.dp),
                    keyboardType = KeyboardType.Decimal,
                )
                QalaText(unitLabel(unit), Modifier.width(24.dp), QalaType.hint, c.fgMuted)
            }
        }
    }
    val days = settings.trainingWeekdays
    QalaText(
        if (days.size != plan.daysPerWeek) {
            "${plan.name} trains ${plan.daysPerWeek} days a week, so your training days become ${weekdayNames(plan.defaultWeekdays)}. Change them in Settings."
        } else {
            "It trains on your days: ${weekdayNames(days)}."
        },
        Modifier.padding(top = 12.dp),
        BodyStyle,
        c.fgSecondary,
    )
    if (plan.stateInText) {
        QalaText(
            "${plan.name} keeps its stages and weights in its own text, so they go back to the start from the weights above.",
            Modifier.padding(top = 8.dp),
            QalaType.hint,
            c.fgMuted,
        )
    }
    message?.let { QalaText(it, Modifier.padding(top = 12.dp), QalaType.bodyStrong, c.danger) }
    Spacer(Modifier.height(18.dp))
    PrimaryButton(
        text = when {
            plan.stateInText -> "Restart ${plan.name} at week 1"
            current -> "Restart ${plan.name}"
            else -> "Start ${plan.name}"
        },
        onClick = {
            val entered = plan.startingLifts.mapIndexed { i, lift -> lift.key to weights[i]!! }.toMap()
            starting = true
            message = null
            // The container's scope does the writing, so leaving the screen cannot cancel it between the program and the active id.
            val write = container.scope.async { container.planStarter.start(plan, entered) }
            ui.launch {
                try {
                    when (val result = write.await()) {
                        is StartResult.Refused -> message = result.reason
                        is StartResult.Started -> onStarted()
                    }
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    message = "Could not start the plan: ${e.message ?: e.javaClass.simpleName}"
                }
                starting = false
            }
        },
        large = true,
        enabled = ready && !starting,
    )
}
