package com.qala.app.checkin

import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.qala.design.Card
import com.qala.design.FlowHead
import com.qala.design.GroupLabel
import com.qala.design.PrimaryButton
import com.qala.design.Qala
import com.qala.design.QalaIcon
import com.qala.design.QalaIcons
import com.qala.design.QalaText
import com.qala.design.QalaTextField
import com.qala.design.QalaTokens
import com.qala.design.QalaType
import com.qala.design.ScalePicker

/**
 * The check-in (DESIGN 7.3, mockups/m4-checkin.html option A): recovery 0 to 10 on one strip, soreness 1 to 4 for each
 * muscle in [plan], one line of text, and Save. Every answer is one tap. Save hands the record to [onSave] and the shell
 * goes back to Today, where the rail has already moved on because it observes the snapshot.
 *
 * It lays its own column on the shell's [scroll], with Save pinned under it, so the button is in reach however many
 * muscles the day trains.
 */
@Composable
fun CheckInScreen(
    plan: CheckInPlan,
    scroll: ScrollState,
    onBack: () -> Unit,
    onSave: (CheckInSave) -> Unit,
) {
    val c = Qala.colors
    var draft by rememberSaveable(plan.initialSoreness, stateSaver = CheckInDraft.Saver) {
        mutableStateOf(CheckInDraft(soreness = plan.initialSoreness))
    }
    var saving by rememberSaveable { mutableStateOf(false) }          // one tap, one record
    val focus = LocalFocusManager.current

    Column(Modifier.fillMaxSize()) {
        Column(
            Modifier
                .weight(1f)
                .fillMaxWidth()
                .verticalScroll(scroll)
                .statusBarsPadding()
                .padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 16.dp),
        ) {
            FlowHead("How are you walking in?", onBack, eyebrow = plan.eyebrow)

            Card(hero = true, contentPadding = 14.dp, modifier = Modifier.padding(bottom = 12.dp)) {
                FieldHead("Recovery", "0 to 10")
                ScalePicker(
                    labels = (0..10).map { it.toString() },
                    selected = draft.recovery,
                    onPick = { draft = draft.withRecovery(it) },
                    groupLabel = "Recovery",
                    describe = { "$it of 10" },
                )
                Row(Modifier.fillMaxWidth().padding(top = 5.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                    RecoveryAnchors.forEach { QalaText(it, style = QalaType.hint.copy(fontSize = 11.sp, lineHeight = 15.sp), color = c.fgMuted, maxLines = 1) }
                }
            }

            Card(hero = true, contentPadding = 14.dp, modifier = Modifier.padding(bottom = 12.dp)) {
                FieldHead("Soreness", if (plan.liftDay) "muscles today trains" else "muscles to check")
                plan.muscles.forEachIndexed { i, muscle ->
                    SorenessRow(
                        muscle = muscle,
                        value = draft.soreness[muscle.id],
                        divider = i > 0,
                        onPick = { draft = draft.withSoreness(muscle.id, it) },
                    )
                }
            }

            Card(hero = true, contentPadding = 14.dp, modifier = Modifier.padding(bottom = 12.dp)) {
                FieldHead("Anything else?", "one line")
                QalaTextField(
                    value = draft.note,
                    onValueChange = { draft = draft.withNote(it) },
                    placeholder = "e.g. knee achy, short on time",
                    label = "Anything else, one line",
                    onDone = { focus.clearFocus() },
                )
            }

            if (plan.showTip) RestDayTip(restDayTip(draft.soreness, plan.injured))
        }

        // Save stays under the scroll: a hairline above it, the ground colour behind it.
        Column(
            Modifier
                .fillMaxWidth()
                .background(c.bg)
                .drawBehind { drawRect(c.border, Offset.Zero, Size(size.width, QalaTokens.borderWidth.toPx())) }
                .padding(start = 16.dp, end = 16.dp, top = 10.dp + QalaTokens.borderWidth, bottom = 12.dp),
        ) {
            PrimaryButton(
                "Save check-in",
                onClick = {
                    saving = true
                    onSave(draft.toSave())
                },
                large = true,
                enabled = !saving,
            )
        }
    }
}

@Composable
private fun FieldHead(label: String, hint: String) {
    Row(Modifier.fillMaxWidth().padding(bottom = 8.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.Bottom) {
        GroupLabel(label, Modifier.semantics { heading() })
        QalaText(hint, style = QalaType.hint.copy(fontSize = 11.5.sp, lineHeight = 15.sp), color = Qala.colors.fgMuted, maxLines = 1)
    }
}

@Composable
private fun SorenessRow(muscle: CheckInMuscle, value: Int?, divider: Boolean, onPick: (Int) -> Unit) {
    val c = Qala.colors
    Row(
        Modifier
            .fillMaxWidth()
            .drawBehind { if (divider) drawRect(c.border, Offset.Zero, Size(size.width, 1.dp.toPx())) }
            .padding(vertical = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            QalaText(muscle.label, style = QalaType.bodyStrong, color = c.fg, maxLines = 1)
            QalaText(muscleHint(muscle, value), style = QalaType.hint.copy(fontSize = 11.5.sp, lineHeight = 15.sp), color = c.fgMuted, maxLines = 2)
        }
        ScalePicker(
            labels = listOf("1", "2", "3", "4"),
            selected = value?.minus(1),
            onPick = { onPick(it + 1) },
            groupLabel = "${muscle.label} soreness",
            describe = { "${it + 1}, ${SorenessMeaning[it]}" },
            modifier = Modifier.width(176.dp),
            cellHeight = 44.dp,
        )
    }
}

/** The mobility line on a day with no lift (DECISIONS U10): a tip, not a stage. */
@Composable
private fun RestDayTip(text: String) {
    val c = Qala.colors
    val shape = RoundedCornerShape(QalaTokens.radiusMd)
    Row(
        Modifier
            .fillMaxWidth()
            .background(c.note, shape)
            .border(QalaTokens.borderWidth, c.noteBorder, shape)
            .padding(horizontal = 12.dp, vertical = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.Top,
    ) {
        QalaIcon(QalaIcons.Sun, null, Modifier.padding(top = 1.dp), size = 18.dp, tint = c.noteInk)
        Column {
            GroupLabel("Rest-day tip", color = c.noteInk)
            QalaText(text, Modifier.padding(top = 1.dp), QalaType.body.copy(fontSize = 12.5.sp, lineHeight = 18.sp), c.fg)
        }
    }
}
