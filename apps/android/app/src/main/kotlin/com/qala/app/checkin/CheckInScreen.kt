package com.qala.app.checkin

import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.qala.design.GroupLabel
import com.qala.design.PinnedBar
import com.qala.design.PrimaryButton
import com.qala.design.Qala
import com.qala.design.QalaIcon
import com.qala.design.QalaIcons
import com.qala.design.QalaText
import com.qala.design.QalaTextField
import com.qala.design.QalaTokens
import com.qala.design.QalaType
import com.qala.design.ScalePicker
import com.qala.design.ScreenHead
import com.qala.design.Wash
import com.qala.design.WashCard
import com.qala.design.WashPage
import com.qala.design.WashScrim

/**
 * The check-in (DESIGN 7.3, mockups/m4-checkin.html option A, S51 board CheckIn): recovery 0 to 10 as glass squares straight on the
 * wash, soreness 1 to 4 for each muscle in [plan] and one line of text on white cards, and Save. Every answer is one tap. Save hands the
 * record to [onSave] and the shell goes back to Today, where the rail has already moved on because it observes the snapshot.
 *
 * It is a [WashPage] on the shell's [scroll] with Save in a [PinnedBar], so the button is in reach however many muscles the day
 * trains. The last card ends [BarRoom] above the page's own bottom padding, so the bar never covers it.
 */
@Composable
fun CheckInScreen(
    plan: CheckInPlan,
    scroll: ScrollState,
    onBack: () -> Unit,
    onSave: (CheckInSave) -> Unit,
) {
    var draft by rememberSaveable(plan.initialSoreness, stateSaver = CheckInDraft.Saver) {
        mutableStateOf(CheckInDraft(soreness = plan.initialSoreness))
    }
    var saving by rememberSaveable { mutableStateOf(false) }          // one tap, one record
    val focus = LocalFocusManager.current

    WashPage(
        scroll,
        WashScrim.Soft,
        head = { ScreenHead("How are you walking in?", eyebrow = plan.eyebrow, onBack = onBack) },
        pinned = {
            PinnedBar {
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
        },
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Column {
                FieldHead("Recovery", "0 to 10", onWash = true)
                GlassScale(
                    labels = (0..10).map { it.toString() },
                    selected = draft.recovery,
                    onPick = { draft = draft.withRecovery(it) },
                    groupLabel = "Recovery",
                    describe = { "$it of 10" },
                )
                Row(Modifier.fillMaxWidth().padding(top = 5.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                    RecoveryAnchors.forEach {
                        QalaText(it, style = QalaType.hint.copy(fontSize = 11.sp, lineHeight = 15.sp, shadow = Wash.TextShadow), color = Color.White.copy(alpha = 0.8f), maxLines = 1)
                    }
                }
            }

            WashCard {
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

            WashCard {
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
        Spacer(Modifier.height(BarRoom))
    }
}

/** The pinned Save bar's height without the tab bar's clearance: its 10 dp of top padding and the large button's 64 dp. */
private val BarRoom = 74.dp

/** A field's head: its name at the left, a quiet hint at the right. [onWash] is for the one that sits straight on the wash, in white. */
@Composable
private fun FieldHead(label: String, hint: String, onWash: Boolean = false) {
    Row(Modifier.fillMaxWidth().padding(bottom = 8.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.Bottom) {
        if (onWash) {
            QalaText(label.uppercase(), Modifier.semantics { heading() }, Wash.Kicker, Wash.Text2)
            QalaText(hint, style = QalaType.log.copy(fontSize = 11.sp, lineHeight = 14.sp, shadow = Wash.TextShadow), color = Color.White.copy(alpha = 0.8f), maxLines = 1)
        } else {
            GroupLabel(label, Modifier.semantics { heading() })
            QalaText(hint, style = QalaType.hint.copy(fontSize = 11.5.sp, lineHeight = 15.sp), color = Qala.colors.fgMuted, maxLines = 1)
        }
    }
}

/**
 * The recovery scale: one glass square for each of [labels], straight on the wash, the picked one white with ink. It reads to TalkBack as
 * [ScalePicker] does: a group named [groupLabel] of radio buttons, each spoken as [describe].
 */
@Composable
private fun GlassScale(labels: List<String>, selected: Int?, onPick: (Int) -> Unit, groupLabel: String, describe: (Int) -> String) {
    val shape = RoundedCornerShape(QalaTokens.radiusLg)
    Row(
        Modifier.fillMaxWidth().selectableGroup().semantics { contentDescription = groupLabel },
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        labels.forEachIndexed { i, label ->
            val picked = i == selected
            Box(
                Modifier
                    .weight(1f)
                    .height(44.dp)
                    .background(if (picked) Color.White.copy(alpha = 0.92f) else Wash.GlassFill, shape)
                    .then(if (picked) Modifier else Modifier.border(1.dp, Wash.GlassBorder, shape))
                    .selectable(
                        selected = picked,
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null,
                        role = Role.RadioButton,
                        onClick = { onPick(i) },
                    )
                    .semantics { contentDescription = describe(i) },
                contentAlignment = Alignment.Center,
            ) {
                QalaText(label, style = QalaType.log.copy(fontWeight = FontWeight.Medium, lineHeight = 13.sp), color = if (picked) Wash.EmberInk else Wash.Text, maxLines = 1)
            }
        }
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
