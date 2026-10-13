package com.qala.design

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp

/*
 * The Plan screen's two controls (DESIGN 7.2): arrows over a week, and a tab for each day of it.
 */

/**
 * `<  This week  >`: a bordered arrow either side of the week's [label] and the dates under it. The label is a heading and
 * a polite live region, so moving to another week is spoken. An arrow with no week beyond it ([canPrevious], [canNext]
 * false) is dimmed and inert.
 */
@Composable
fun WeekSwitcher(
    label: String,
    range: String,
    canPrevious: Boolean,
    canNext: Boolean,
    onPrevious: () -> Unit,
    onNext: () -> Unit,
    modifier: Modifier = Modifier,
    previousDescription: String = "Previous week",
    nextDescription: String = "Next week",
) {
    val c = Qala.colors
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
        BorderedIconButton(QalaIcons.ChevronLeft, previousDescription, onPrevious, enabled = canPrevious)
        Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
            QalaText(
                label,
                Modifier.semantics { heading(); liveRegion = LiveRegionMode.Polite },
                QalaType.cardTitle,
                c.fg,
                TextAlign.Center,
                maxLines = 1,
            )
            QalaText(range, style = QalaType.hint, color = c.fgMuted, textAlign = TextAlign.Center, maxLines = 1)
        }
        BorderedIconButton(QalaIcons.ChevronRight, nextDescription, onNext, enabled = canNext)
    }
}

/**
 * One tab of [DayTabs]: the weekday [name] over the day of the month [date], then a [glyph]. The selected tab is ink, like
 * every picked cell, and today's name reads in ember when it is not the one picked. [done] tints the glyph teal; [struck]
 * draws the name and date through, for a day that was skipped or not logged. [description] is what a screen reader says.
 */
class DayTabItem(
    val name: String,
    val date: String,
    val glyph: ImageVector,
    val description: String,
    val selected: Boolean,
    val today: Boolean = false,
    val done: Boolean = false,
    val struck: Boolean = false,
)

/** Seven (or any number of) tabs in a row, each at least 44 dp wide and 72 dp tall. */
@Composable
fun DayTabs(
    items: List<DayTabItem>,
    onSelect: (Int) -> Unit,
    groupLabel: String,
    modifier: Modifier = Modifier,
) {
    val c = Qala.colors
    val shape = RoundedCornerShape(QalaTokens.radiusMd)
    val onInk = railColors().onInk
    Row(
        modifier.fillMaxWidth().selectableGroup().semantics { contentDescription = groupLabel },
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        items.forEachIndexed { i, item ->
            val ink = if (item.selected) onInk else c.fg
            val strike = if (item.struck) TextDecoration.LineThrough else TextDecoration.None
            Column(
                Modifier
                    .weight(1f)
                    .defaultMinSize(minHeight = 72.dp)
                    .background(if (item.selected) c.fg else c.bgSurface, shape)
                    .border(QalaTokens.borderWidth, if (item.selected) c.fg else c.border, shape)
                    .selectable(
                        selected = item.selected,
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null,
                        role = Role.Tab,
                        onClick = { onSelect(i) },
                    )
                    .semantics { contentDescription = item.description }
                    .padding(vertical = 8.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(3.dp, Alignment.CenterVertically),
            ) {
                QalaText(
                    item.name.uppercase(),
                    style = QalaType.tabLabel.copy(textDecoration = strike),
                    color = if (item.today && !item.selected) c.accent else if (item.selected) onInk.copy(alpha = 0.85f) else c.fgMuted,
                    maxLines = 1,
                )
                QalaText(item.date, style = QalaType.stat.copy(textDecoration = strike), color = ink, maxLines = 1)
                QalaIcon(
                    item.glyph,
                    null,
                    size = 16.dp,
                    tint = if (item.selected) onInk else if (item.done) c.progressFill else c.fgMuted,
                )
            }
        }
    }
}
