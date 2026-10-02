package com.qala.design

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/*
 * The small controls the check-in, the skip sheet and Settings share (DESIGN 5, 5a). The picked cell, chip or day is ink
 * (the foreground colour with the on-ink text), never ember: ember is the one primary action on a screen.
 */

private val StripShape = RoundedCornerShape(QalaTokens.radiusMd)
private val ChipShape = RoundedCornerShape(QalaTokens.radius)

/** The ink fill's text colour: white on the light ink, the ground colour on the dark one. */
@Composable
private fun onInk(): Color = railColors().onInk

/** A cell of a strip: [picked] is ink, and every cell after the first has the strip's divider on its start edge. */
@Composable
private fun StripCell(
    label: String,
    picked: Boolean,
    first: Boolean,
    height: Dp,
    modifier: Modifier,
    fontSize: TextUnit = 14.sp,
    maxLines: Int = 1,
    /** The cell before this one is picked too, so the divider has to show against ink. */
    afterPicked: Boolean = false,
) {
    val c = Qala.colors
    val divider = QalaTokens.borderWidth
    val onInk = onInk()
    Box(
        modifier
            .heightIn(min = height)
            .background(if (picked) c.fg else Color.Transparent)
            .drawBehind {
                if (!first) drawRect(if (picked && afterPicked) onInk.copy(alpha = 0.3f) else c.border, Offset.Zero, Size(divider.toPx(), size.height))
            }
            .padding(horizontal = 2.dp),
        contentAlignment = Alignment.Center,
    ) {
        QalaText(
            label,
            style = QalaType.button.copy(fontSize = fontSize, lineHeight = fontSize * 1.2f),
            color = if (picked) onInk() else c.fg,
            textAlign = TextAlign.Center,
            maxLines = maxLines,
        )
    }
}

/**
 * The scale picker (DESIGN 5a): one bordered strip of equal cells, one of them picked, for a value on a scale (recovery
 * 0 to 10, soreness 1 to 4, how long a skip lasts). [selected] is an index into [labels], or null when nothing is
 * picked yet. Each cell is a radio button for TalkBack, spoken as [describe] (the label by default) inside the group
 * named [groupLabel]. A cell is [cellHeight] tall and as wide as the strip allows.
 */
@Composable
fun ScalePicker(
    labels: List<String>,
    selected: Int?,
    onPick: (Int) -> Unit,
    groupLabel: String,
    modifier: Modifier = Modifier,
    cellHeight: Dp = 48.dp,
    describe: (Int) -> String = { labels[it] },
    fontSize: TextUnit = 14.sp,
    maxLines: Int = 1,
) {
    val c = Qala.colors
    Row(
        modifier
            .fillMaxWidth()
            .selectableGroup()
            .semantics { contentDescription = groupLabel }
            .background(c.bgSurface, StripShape)
            .clip(StripShape)
            .border(QalaTokens.borderWidth, c.borderStrong, StripShape),
    ) {
        labels.forEachIndexed { i, label ->
            StripCell(
                label = label,
                picked = i == selected,
                first = i == 0,
                height = cellHeight,
                fontSize = fontSize,
                maxLines = maxLines,
                modifier = Modifier
                    .weight(1f)
                    .selectable(
                        selected = i == selected,
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null,
                        role = Role.RadioButton,
                        onClick = { onPick(i) },
                    )
                    .semantics { contentDescription = describe(i) },
            )
        }
    }
}

/**
 * Seven (or any number of) cells where each is on or off, for the training weekdays: the scale picker's look with
 * checkbox behaviour. [names] are the spoken names ("Monday"); [labels] are what the cell shows ("Mon").
 */
@Composable
fun DayStrip(
    labels: List<String>,
    names: List<String>,
    picked: Set<Int>,
    onToggle: (Int) -> Unit,
    groupLabel: String,
    modifier: Modifier = Modifier,
    cellHeight: Dp = 52.dp,
) {
    val c = Qala.colors
    Row(
        modifier
            .fillMaxWidth()
            .semantics { contentDescription = groupLabel }
            .background(c.bgSurface, StripShape)
            .clip(StripShape)
            .border(QalaTokens.borderWidth, c.borderStrong, StripShape),
    ) {
        labels.forEachIndexed { i, label ->
            val on = i in picked
            StripCell(
                label = label,
                picked = on,
                first = i == 0,
                height = cellHeight,
                afterPicked = (i - 1) in picked,
                modifier = Modifier
                    .weight(1f)
                    .toggleable(
                        value = on,
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null,
                        role = Role.Checkbox,
                        onValueChange = { onToggle(i) },
                    )
                    .semantics { contentDescription = names[i] },
            )
        }
    }
}

/** A choice chip (4 dp radius): the picked one is ink. [height] is its touch height. */
@Composable
fun ChoiceChip(
    text: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    height: Dp = 44.dp,
) {
    val c = Qala.colors
    Box(
        modifier
            .heightIn(min = height)
            .background(if (selected) c.fg else c.bgSurface, ChipShape)
            .border(QalaTokens.borderWidth, if (selected) c.fg else c.border, ChipShape)
            .selectable(
                selected = selected,
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                role = Role.RadioButton,
                onClick = onClick,
            )
            .padding(horizontal = 4.dp, vertical = 6.dp),
        contentAlignment = Alignment.Center,
    ) {
        QalaText(
            text,
            style = QalaType.button.copy(fontSize = 13.sp, lineHeight = 17.sp),
            color = if (selected) onInk() else c.fg,
            textAlign = TextAlign.Center,
            maxLines = 1,
        )
    }
}

/** [items] laid out [columns] to a row, each chip taking an equal share: the muscle picker's grid. */
@Composable
fun <T> ChipGrid(
    items: List<T>,
    columns: Int,
    groupLabel: String,
    modifier: Modifier = Modifier,
    chip: @Composable (T, Modifier) -> Unit,
) {
    Column(
        modifier.fillMaxWidth().selectableGroup().semantics { contentDescription = groupLabel },
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        items.chunked(columns).forEach { row ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                row.forEach { item -> chip(item, Modifier.weight(1f)) }
                repeat(columns - row.size) { Box(Modifier.weight(1f)) }
            }
        }
    }
}

/**
 * A one-line text field: 2 dp border that turns ember while it has focus, 48 dp tall, a [placeholder] while empty.
 * [label] is what TalkBack calls it, since the visible label sits outside the field.
 */
@Composable
fun QalaTextField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    label: String,
    modifier: Modifier = Modifier,
    onDone: (() -> Unit)? = null,
) {
    val c = Qala.colors
    var focused by remember { mutableStateOf(false) }
    val shape = RoundedCornerShape(QalaTokens.radiusMd)
    BasicTextField(
        value = value,
        onValueChange = onValueChange,
        modifier = modifier
            .fillMaxWidth()
            .onFocusChanged { focused = it.isFocused }
            .background(c.bgSurface, shape)
            .border(QalaTokens.borderWidth, if (focused) c.accent else c.border, shape)
            .defaultMinSize(minHeight = 48.dp)
            .semantics { contentDescription = label }
            .padding(horizontal = 12.dp, vertical = 12.dp),
        textStyle = QalaType.body.copy(fontSize = 14.sp, lineHeight = 20.sp, color = c.fg),
        singleLine = true,
        cursorBrush = SolidColor(c.accent),
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
        keyboardActions = KeyboardActions(onDone = { onDone?.invoke() }),
        decorationBox = { inner ->
            Box(contentAlignment = Alignment.CenterStart) {
                if (value.isEmpty()) QalaText(placeholder, style = QalaType.body.copy(fontSize = 14.sp, lineHeight = 20.sp), color = c.fgMuted, maxLines = 1)
                inner()
            }
        },
    )
}

/** A square icon on the active tint, [ink] for the picked or on state: the skip reasons and the status card. */
@Composable
fun IconTile(icon: ImageVector, modifier: Modifier = Modifier, size: Dp = 36.dp, ink: Boolean = false) {
    val c = Qala.colors
    Box(
        modifier
            .size(size)
            .background(if (ink) c.fg else c.bgActive, RoundedCornerShape(QalaTokens.radiusMd)),
        contentAlignment = Alignment.Center,
    ) {
        QalaIcon(icon, null, size = size * 0.55f, tint = if (ink) onInk() else c.fg)
    }
}

/** A quiet text action under a card's sentence: bold, underlined, with a 48 dp touch height. */
@Composable
fun LinkButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val c = Qala.colors
    Box(
        modifier
            .heightIn(min = 48.dp)
            .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, role = Role.Button, onClick = onClick),
        contentAlignment = Alignment.CenterStart,
    ) {
        QalaText(
            text,
            style = QalaType.button.copy(fontSize = 13.sp, lineHeight = 18.sp, textDecoration = TextDecoration.Underline),
            color = c.fg,
            maxLines = 1,
        )
    }
}
