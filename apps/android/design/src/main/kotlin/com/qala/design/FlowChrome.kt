package com.qala.design

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp

/**
 * A 44 dp bordered square with an icon, the head-of-screen button of the lifting flow (Back, all exercises, Finish):
 * the same surface as the Back button of [FlowHead], with an optional ink fill for the one that is on.
 */
@Composable
fun FlowIconButton(
    icon: ImageVector,
    contentDescription: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    on: Boolean = false,
) {
    val c = Qala.colors
    Box(
        modifier
            .size(44.dp)
            .beamerSurface(if (on) c.fg else c.bgSurface, c.border, QalaTokens.radiusMd, c.shadowCard)
            .clickable(role = Role.Button, onClickLabel = contentDescription, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        QalaIcon(icon, contentDescription, size = 22.dp, tint = if (on) railColors().onInk else c.fg)
    }
}

/**
 * The bar pinned under a lifting screen: the ground colour with a hairline above it, clear of the navigation bar (the
 * lifting flow has no tab bar, which is what normally clears it). Holds the screen's one primary action.
 */
@Composable
fun FlowBottomBar(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    val c = Qala.colors
    Column(
        modifier
            .fillMaxWidth()
            .background(c.bg)
            .drawBehind { drawRect(c.border, Offset.Zero, Size(size.width, QalaTokens.borderWidth.toPx())) }
            .windowInsetsPadding(WindowInsets.navigationBars)
            .padding(start = 16.dp, end = 16.dp, top = 10.dp + QalaTokens.borderWidth, bottom = 12.dp),
    ) {
        content()
    }
}
