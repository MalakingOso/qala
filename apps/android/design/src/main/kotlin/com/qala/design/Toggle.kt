package com.qala.design

import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.toggleable
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * The switch's look (DESIGN 5.5): a square-cornered 52 by 32 box with the 2 dp border and a 22 dp knob. Off it is a plain
 * surface with a faint knob; on it is ember with the on-accent knob. It only draws: the row around it ([ToggleRow]) is
 * the control, so the touch target is the whole row and TalkBack reads the row's label with "On" or "Off".
 */
@Composable
fun QalaToggle(on: Boolean, modifier: Modifier = Modifier) {
    val c = Qala.colors
    val travel by animateDpAsState(if (on) 25.dp else 5.dp, tween(QalaTokens.durationFast, easing = QalaTokens.ease), label = "knob")
    Box(
        modifier
            .size(52.dp, 32.dp)
            .background(if (on) c.accent else c.bgSurface)
            .border(QalaTokens.borderWidth, if (on) c.accent else c.border),
    ) {
        Box(
            Modifier
                .offset(x = travel, y = 5.dp)
                .size(22.dp)
                .background(if (on) c.onAccent else c.fgFaint),
        )
    }
}

/**
 * A row of a [Group] that is one switch: an optional [leading] picture, the [label] (and a quiet [hint] under it), and the
 * toggle at the end. The whole row flips it, with the switch role, so it is a 56 dp target. A row that is not [enabled]
 * is dimmed and does nothing.
 */
@Composable
fun ToggleRow(
    label: String,
    on: Boolean,
    onToggle: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
    last: Boolean = false,
    enabled: Boolean = true,
    hint: String? = null,
    leading: (@Composable RowScope.() -> Unit)? = null,
) {
    val c = Qala.colors
    GroupRow(
        modifier
            .alpha(if (enabled) 1f else 0.45f)
            .toggleable(
                value = on,
                enabled = enabled,
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                role = Role.Switch,
                onValueChange = onToggle,
            ),
        last = last,
        vertical = if (leading != null) 6.dp else 14.dp,
    ) {
        leading?.invoke(this)
        Box(Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
            Column {
                QalaText(label, style = QalaType.body, color = c.fg)
                if (hint != null) QalaText(hint, style = QalaType.hint.copy(fontSize = 12.sp, lineHeight = 17.sp), color = c.fgMuted)
            }
        }
        QalaToggle(on)
    }
}

/**
 * A switch that stands alone in a row of other controls (a stepper beside it): the same look as [QalaToggle], with a 52 by
 * 48 dp target and the switch role, spoken as [label]. Where the whole row is the switch, use [ToggleRow] instead.
 */
@Composable
fun QalaSwitch(on: Boolean, onToggle: (Boolean) -> Unit, label: String, modifier: Modifier = Modifier, enabled: Boolean = true) {
    Box(
        modifier
            .size(52.dp, 48.dp)
            .alpha(if (enabled) 1f else 0.45f)
            .toggleable(
                value = on,
                enabled = enabled,
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                role = Role.Switch,
                onValueChange = onToggle,
            )
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) {
        QalaToggle(on)
    }
}
