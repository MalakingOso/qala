package com.qala.app.skip

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.qala.app.LocalAppContainer
import com.qala.app.today.muscleName
import com.qala.data.model.SkipReason
import com.qala.design.ChipGrid
import com.qala.design.ChoiceChip
import com.qala.design.GroupLabel
import com.qala.design.IconTile
import com.qala.design.PrimaryButton
import com.qala.design.Qala
import com.qala.design.QalaIcon
import com.qala.design.QalaIcons
import com.qala.design.QalaSheet
import com.qala.design.QalaText
import com.qala.design.QalaTextField
import com.qala.design.QalaTokens
import com.qala.design.QalaType
import com.qala.design.beamerSurface
import com.qala.design.ScalePicker
import com.qala.design.SecondaryButton
import kotlinx.coroutines.launch

/** Whether the skip sheet is open, and what it was opened for. It lives in the shell's Today state, over the window. */
@Stable
class SkipSheetState {
    var open by mutableStateOf(false)
        private set

    /** The request the sheet was last opened with; kept while it slides away so the body does not change under it. */
    var request by mutableStateOf<SkipRequest?>(null)
        private set

    /** Counts openings, so each one starts from the request's draft even when the request is the same object as last time. */
    var opening by mutableIntStateOf(0)
        private set

    fun show(request: SkipRequest) {
        this.request = request
        opening += 1
        open = true
    }

    fun close() {
        open = false
    }
}

fun skipIcon(reason: SkipReason): ImageVector = when (reason) {
    SkipReason.Break -> QalaIcons.Sunset
    SkipReason.Vacation -> QalaIcons.TreePalm
    SkipReason.Sick -> QalaIcons.Thermometer
    SkipReason.Injured -> QalaIcons.Bandage
    SkipReason.Scheduling -> QalaIcons.CalendarOff
}

/**
 * The skip sheet (mockups/m4-skip-sheet.html option B): a bottom sheet over Today with the reasons as tiles, the
 * muscle chips only under Injured, a live "what happens" line, how long, and an optional note. Confirm writes through
 * the availability repository on the container's scope (a one-day skip or the persistent status, see [confirmWrites])
 * and closes. System Back closes the sheet before it leaves Today.
 */
@Composable
fun SkipSheet(state: SkipSheetState, modifier: Modifier = Modifier) {
    val request = state.request ?: return
    val container = LocalAppContainer.current
    // A fresh draft for each opening; the sheet keeps composing while it slides away, so a close does not reset it.
    var draft by remember(request, state.opening) { mutableStateOf(request.draft) }
    var noteOpen by remember(request, state.opening) { mutableStateOf(request.draft.note.isNotEmpty()) }
    val focus = LocalFocusManager.current

    fun confirm() {
        if (!draft.valid) return
        val writes = confirmWrites(draft, request.date, request.status)
        container.scope.launch { container.availability.apply(writes) }
        focus.clearFocus()
        state.close()
    }

    QalaSheet(
        open = state.open,
        title = request.title,
        hint = request.dayLine,
        onClose = { focus.clearFocus(); state.close() },
        modifier = modifier,
        footer = {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                SecondaryButton(dismissLabel(request.mode), onClick = { focus.clearFocus(); state.close() }, modifier = Modifier.weight(1f))
                PrimaryButton(confirmLabel(draft, request.mode), onClick = ::confirm, modifier = Modifier.weight(1f), enabled = draft.valid)
            }
        },
    ) {
        ReasonTiles(draft.reason) { draft = draft.withReason(it) }

        if (draft.reason == SkipReason.Injured) {
            SheetLabel("Which muscle?")
            ChipGrid(InjuryMuscles, columns = 3, groupLabel = "Which muscle?") { muscle, chipModifier ->
                ChoiceChip(
                    text = muscleName(muscle).replaceFirstChar { it.uppercase() },
                    selected = draft.muscle == muscle,
                    onClick = { draft = draft.withMuscle(muscle) },
                    modifier = chipModifier,
                    height = 40.dp,
                )
            }
        }

        Spacer(Modifier.height(10.dp))
        WhatHappens(whatHappens(draft.reason, draft.muscle, draft.span, container.shiftRules.getValue(draft.reason)))

        SheetLabel("How long?")
        ScalePicker(
            labels = SkipSpan.entries.map { it.label },
            selected = SkipSpan.entries.indexOf(draft.span),
            onPick = { draft = draft.withSpan(SkipSpan.entries[it]) },
            groupLabel = "How long?",
            cellHeight = 52.dp,
            fontSize = 12.5.sp,
            maxLines = 2,
        )

        Spacer(Modifier.height(10.dp))
        if (noteOpen) {
            QalaTextField(
                value = draft.note,
                onValueChange = { draft = draft.withNote(it) },
                placeholder = "e.g. left knee, flights Tuesday",
                label = "Note, optional",
                onDone = { focus.clearFocus() },
            )
        } else {
            AddNote { noteOpen = true }
        }
        Spacer(Modifier.height(4.dp))
    }
}

@Composable
private fun SheetLabel(text: String) {
    GroupLabel(text, Modifier.padding(top = 16.dp, bottom = 8.dp, start = 2.dp).semantics { heading() })
}

/** The five reasons as two-column tiles (the last one wide): an icon tile and the name, the picked one outlined in ink. */
@Composable
private fun ReasonTiles(picked: SkipReason, onPick: (SkipReason) -> Unit) {
    Column(Modifier.fillMaxWidth().selectableGroup().semantics { contentDescription = "Why skip?" }, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        SkipReasons.chunked(2).forEach { row ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                row.forEach { reason -> ReasonTile(reason, reason == picked, Modifier.weight(1f)) { onPick(reason) } }
            }
        }
    }
}

@Composable
private fun ReasonTile(reason: SkipReason, picked: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val c = Qala.colors
    Row(
        modifier
            .heightIn(min = 52.dp)
            .beamerSurface(c.bgSurface, if (picked) c.fg else c.border, QalaTokens.radiusMd, if (picked) c.shadowCard else null)
            .selectable(
                selected = picked,
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                role = Role.RadioButton,
                onClick = onClick,
            )
            .semantics { contentDescription = reasonTitle(reason) }
            .padding(horizontal = 10.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconTile(skipIcon(reason), size = 32.dp, ink = picked)
        QalaText(reasonTitle(reason), style = QalaType.bodyStrong.copy(fontSize = 14.sp, lineHeight = 18.sp), color = c.fg, maxLines = 1)
    }
}

/** The live line: what the plan does for the picked reason, muscle and span. A polite live region, so a change is spoken. */
@Composable
private fun WhatHappens(text: String) {
    val c = Qala.colors
    val shape = RoundedCornerShape(QalaTokens.radiusMd)
    Row(
        Modifier
            .fillMaxWidth()
            .background(c.bgRecessed, shape)
            .border(QalaTokens.borderWidth, c.border, shape)
            .padding(horizontal = 12.dp, vertical = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.Top,
    ) {
        QalaIcon(QalaIcons.Info, null, Modifier.padding(top = 1.dp).size(18.dp), size = 18.dp, tint = c.fg)
        QalaText(
            buildAnnotatedString {
                withStyle(SpanStyle(color = c.fg, fontWeight = FontWeight.SemiBold)) { append("What happens. ") }
                append(text)
            },
            Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            QalaType.body.copy(fontSize = 12.5.sp, lineHeight = 18.sp),
            c.fgSecondary,
        )
    }
}

@Composable
private fun AddNote(onClick: () -> Unit) {
    val c = Qala.colors
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 44.dp)
            .selectable(selected = false, interactionSource = remember { MutableInteractionSource() }, indication = null, role = Role.Button, onClick = onClick)
            .padding(horizontal = 2.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        QalaText("Add a note", style = QalaType.button.copy(fontSize = 13.sp), color = c.fgSecondary)
        QalaIcon(QalaIcons.Plus, null, size = 18.dp, tint = c.fgSecondary)
    }
}
