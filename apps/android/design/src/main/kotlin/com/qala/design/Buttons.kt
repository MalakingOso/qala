package com.qala.design

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** A press moves the element 1 dp right and 2 dp down, the way the web's :active does (eased, 150 ms). */
@Composable
private fun Modifier.pressed(pressed: Boolean): Modifier {
    val t by animateFloatAsState(
        targetValue = if (pressed) 1f else 0f,
        animationSpec = tween(QalaTokens.durationFast, easing = QalaTokens.ease),
        label = "press",
    )
    return graphicsLayer {
        translationX = 1.dp.toPx() * t
        translationY = 2.dp.toPx() * t
    }
}

/** The ember action: [large] is the 64 dp one for the screen's main step. A press drops the shadow. */
@Composable
fun PrimaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    large: Boolean = false,
    icon: ImageVector? = null,
    enabled: Boolean = true,
) {
    val c = Qala.colors
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    Row(
        modifier = modifier
            .fillMaxWidth()
            .alpha(if (enabled) 1f else 0.5f)
            .clickable(interaction, indication = null, enabled = enabled, role = Role.Button, onClick = onClick)
            .pressed(pressed)
            .beamerSurface(
                fill = if (pressed) c.accentHover else c.accent,
                border = Color.Transparent,
                radius = QalaTokens.radius,
                shadow = if (pressed) null else c.shadowCta,
                borderWidth = 0.dp,
            )
            .defaultMinSize(minHeight = if (large) 64.dp else 52.dp)
            .padding(horizontal = 20.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        CompositionLocalProvider(LocalContentColor provides c.onAccent) {
            if (icon != null) QalaIcon(icon, null, size = if (large) 22.dp else 20.dp)
            QalaText(text, style = if (large) QalaType.buttonLarge else QalaType.button, maxLines = 1)
        }
    }
}

/** The quiet action: white, 2 dp border. [small] is the 40 dp inline one. */
@Composable
fun SecondaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    small: Boolean = false,
    icon: ImageVector? = null,
    enabled: Boolean = true,
) {
    val c = Qala.colors
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    Row(
        modifier = modifier
            .then(if (small) Modifier else Modifier.fillMaxWidth())
            .alpha(if (enabled) 1f else 0.5f)
            .clickable(interaction, indication = null, enabled = enabled, role = Role.Button, onClick = onClick)
            .pressed(pressed)
            .beamerSurface(
                fill = if (pressed) c.bgActive else c.bgSurface,
                border = if (pressed) c.borderStrong else c.border,
                radius = QalaTokens.radius,
            )
            .defaultMinSize(minHeight = if (small) 40.dp else 52.dp)
            .padding(horizontal = if (small) 14.dp else 20.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        CompositionLocalProvider(LocalContentColor provides c.fg) {
            if (icon != null) QalaIcon(icon, null, size = 20.dp)
            QalaText(
                text,
                style = if (small) QalaType.button.copy(fontSize = 13.sp) else QalaType.body,
                maxLines = 1,
            )
        }
    }
}

/** A 44 dp square with a [size] icon: the header and toolbar button. */
@Composable
fun IconButton(
    icon: ImageVector,
    contentDescription: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    size: Dp = 20.dp,
) {
    val c = Qala.colors
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    Row(
        modifier = modifier
            .clickable(interaction, indication = null, role = Role.Button, onClickLabel = null, onClick = onClick)
            .pressed(pressed)
            .beamerSurface(
                fill = if (pressed) c.bgHover else Color.Transparent,
                border = if (pressed) c.border else Color.Transparent,
                radius = QalaTokens.radius,
            )
            .defaultMinSize(44.dp, 44.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        QalaIcon(icon, contentDescription, size = size, tint = if (pressed) c.fg else c.fgSecondary)
    }
}
