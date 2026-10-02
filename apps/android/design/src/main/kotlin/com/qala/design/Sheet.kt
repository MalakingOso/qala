package com.qala.design

import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.isTraversalGroup
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private const val OpenMs = 240
private const val CloseMs = 200
private val SheetRadius = 12.dp

/**
 * A bottom sheet over the screen it is composed over (the scrim covers what it is placed over, so compose it once, in
 * the shell, above the tab bar). [open] drives it; every way out ends in [onClose]: the scrim, the system Back (a
 * [BackHandler] inside, so it composes after, and beats, a shell-level one), and a drag down on the handle or title.
 *
 * It has a grab handle, a [title] in the page-title face with an optional [hint] beside it, a body that scrolls, and a
 * [footer] pinned under the body, so the confirm button is always in reach however long the body gets. The footer
 * clears the navigation bar and the keyboard. Motion is a 240 ms slide up and a 200 ms slide down; with system
 * animations off it snaps (see [animationsEnabled]).
 *
 * For TalkBack the sheet is a pane named [title], the scrim a Close button, and the shell is expected to hide the
 * screen behind it while it is open.
 */
@Composable
fun QalaSheet(
    open: Boolean,
    title: String,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
    hint: String? = null,
    footer: @Composable ColumnScope.() -> Unit = {},
    body: @Composable ColumnScope.() -> Unit,
) {
    val context = LocalContext.current
    val progress = remember { Animatable(if (open) 1f else 0f) }
    var settled by remember { mutableStateOf(open) }               // composed from the open request until the slide down ends

    LaunchedEffect(open) {
        val animate = animationsEnabled(context)
        if (open) {
            settled = true
            if (animate) progress.animateTo(1f, tween(OpenMs, easing = QalaTokens.ease)) else progress.snapTo(1f)
        } else {
            if (animate) progress.animateTo(0f, tween(CloseMs, easing = EaseIn)) else progress.snapTo(0f)
            settled = false
        }
    }
    BackHandler(enabled = open, onBack = onClose)
    if (!open && !settled) return

    val c = Qala.colors
    val rail = railColors()
    val shape = RoundedCornerShape(topStart = SheetRadius, topEnd = SheetRadius)
    Box(modifier.fillMaxSize()) {
        Box(
            Modifier
                .fillMaxSize()
                .graphicsLayer { alpha = progress.value }
                .background(rail.scrim)
                .pointerInput(Unit) { detectTapGestures { onClose() } }
                .semantics {
                    role = Role.Button
                    contentDescription = "Close $title"
                    onClick { onClose(); true }
                },
        )
        Box(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.statusBars), contentAlignment = Alignment.BottomCenter) {
            Column(
                Modifier
                    .widthIn(max = ContentMaxWidth)
                    .fillMaxWidth()
                    .graphicsLayer { translationY = size.height * (1f - progress.value) }
                    .drawBehind {
                        // The sheet runs off the bottom of the screen, so its own bottom edge is never drawn: the fill
                        // and the border are taller than the box. The shadow sits 4 dp above the top edge.
                        val below = 24.dp.toPx()
                        val radius = CornerRadius(SheetRadius.toPx())
                        val border = QalaTokens.borderWidth.toPx()
                        drawRoundRect(c.shadowCard.color, Offset(0f, -4.dp.toPx()), Size(size.width, size.height + below), radius)
                        drawRoundRect(c.bg, Offset.Zero, Size(size.width, size.height + below), radius)
                        drawRoundRect(
                            c.borderStrong,
                            Offset(border / 2, border / 2),
                            Size(size.width - border, size.height + below),
                            CornerRadius((SheetRadius.toPx() - border / 2).coerceAtLeast(0f)),
                            style = Stroke(border),
                        )
                    }
                    .pointerInput(Unit) { detectTapGestures { } }          // a tap on the sheet is not a tap on the scrim
                    .semantics {
                        paneTitle = title
                        isTraversalGroup = true
                    },
            ) {
                Column(
                    Modifier
                        .fillMaxWidth()
                        .pointerInput(Unit) {
                            var travelled = 0f
                            detectVerticalDragGestures(
                                onDragStart = { travelled = 0f },
                                onDragEnd = { if (travelled > 56.dp.toPx()) onClose() },
                            ) { _, delta -> travelled += delta }
                        }
                        .padding(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 10.dp),
                ) {
                    Box(
                        Modifier
                            .align(Alignment.CenterHorizontally)
                            .padding(bottom = 10.dp)
                            .background(c.borderStrong, RoundedCornerShape(2.dp))
                            .height(4.dp)
                            .widthIn(min = 36.dp),
                    )
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.Bottom) {
                        QalaText(
                            title,
                            Modifier.weight(1f, fill = false).semantics { heading() },
                            QalaType.pageTitle.copy(fontSize = 24.sp, lineHeight = 28.sp),
                            c.fg,
                            maxLines = 1,
                        )
                        if (hint != null) QalaText(hint, Modifier.padding(start = 12.dp), QalaType.hint, c.fgMuted, maxLines = 1)
                    }
                }
                Column(
                    Modifier
                        .weight(1f, fill = false)
                        .verticalScroll(rememberScrollState())
                        .padding(horizontal = 16.dp),
                    content = body,
                )
                Column(
                    Modifier
                        .fillMaxWidth()
                        .windowInsetsPadding(WindowInsets.navigationBars.union(WindowInsets.ime))
                        .padding(start = 16.dp, end = 16.dp, top = 10.dp, bottom = 14.dp),
                    content = footer,
                )
            }
        }
    }
}
