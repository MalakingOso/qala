package com.qala.design

import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** A 52 dp square minus or plus (44 dp in a row of a list): a bordered surface that sinks one step when pressed, like every button here. */
@Composable
private fun StepButton(icon: ImageVector, description: String, enabled: Boolean, size: Dp = 52.dp, onClick: () -> Unit) {
    val c = Qala.colors
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    Box(
        Modifier
            .size(size)
            .alpha(if (enabled) 1f else 0.4f)
            .clickable(interaction, indication = null, enabled = enabled, role = Role.Button, onClickLabel = description, onClick = onClick)
            .beamerSurface(if (pressed) c.bgActive else c.bgSurface, if (pressed) c.borderStrong else c.border, QalaTokens.radiusMd),
        contentAlignment = Alignment.Center,
    ) {
        QalaIcon(icon, description, size = if (size < 52.dp) 20.dp else 22.dp, tint = c.fg)
    }
}

/**
 * A value you nudge (DESIGN 5.9): a label over a minus button, the value in the hero numeral face with its [unit] after
 * it, and a plus button, in one row that fills its width. [onStep] gets -1 or +1; the caller decides what a step is.
 * TalkBack reads the value as one line ("Weight, 150 lb") and the buttons by [decreaseDescription] and [increaseDescription].
 */
@Composable
fun Stepper(
    label: String,
    value: String,
    onStep: (Int) -> Unit,
    decreaseDescription: String,
    increaseDescription: String,
    modifier: Modifier = Modifier,
    unit: String? = null,
    canDecrease: Boolean = true,
    canIncrease: Boolean = true,
) {
    val c = Qala.colors
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        GroupLabel(label)
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            StepButton(QalaIcons.Minus, decreaseDescription, canDecrease) { onStep(-1) }
            val text: AnnotatedString = buildAnnotatedString {
                append(value)
                if (unit != null) withStyle(SpanStyle(fontSize = 13.sp, color = c.fgMuted)) { append(" $unit") }
            }
            QalaText(
                text,
                Modifier
                    .weight(1f)
                    .defaultMinSize(minHeight = 52.dp)
                    .semantics(mergeDescendants = true) { contentDescription = "$label, $value" + (unit?.let { " $it" } ?: "") },
                QalaType.figure.copy(fontSize = 38.sp, lineHeight = 46.sp, fontFeatureSettings = "tnum, lnum"),
                c.fg,
                TextAlign.Center,
                maxLines = 1,
            )
            StepButton(QalaIcons.Plus, increaseDescription, canIncrease) { onStep(1) }
        }
    }
}

/**
 * A small stepper for a row of a list (a pair count, a bar weight, a number of minutes): minus, the [value] as a word or
 * a figure at a fixed width so the buttons do not move as it changes, and plus. The buttons are 44 dp, the touch minimum.
 * [onStep] gets -1 or +1; the caller decides what a step is and when it stops ([canDecrease], [canIncrease]).
 */
@Composable
fun RowStepper(
    value: String,
    onStep: (Int) -> Unit,
    decreaseDescription: String,
    increaseDescription: String,
    modifier: Modifier = Modifier,
    canDecrease: Boolean = true,
    canIncrease: Boolean = true,
    valueWidth: Dp = 68.dp,
) {
    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        StepButton(QalaIcons.Minus, decreaseDescription, canDecrease, size = 44.dp) { onStep(-1) }
        QalaText(
            value,
            Modifier.width(valueWidth),
            QalaType.log.copy(fontSize = 13.sp, lineHeight = 18.sp),
            Qala.colors.fg,
            TextAlign.Center,
            maxLines = 1,
        )
        StepButton(QalaIcons.Plus, increaseDescription, canIncrease, size = 44.dp) { onStep(1) }
    }
}
