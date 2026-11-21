package com.qala.design

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.text
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Content is never wider than this, however wide the screen (the web's `.page` max-width). */
val ContentMaxWidth = 560.dp

class TabItem(val label: String, val icon: ImageVector)

/** The tab bar without the navigation inset: Today's sheet stops are measured against it. */
val TabBarHeight = 72.dp

/**
 * How much of the bottom of the screen the floating tab bar covers (its zone plus the navigation inset), 0 where there is no bar or a keyboard is up.
 * The bar floats over the screen and paints nothing behind it, so a screen that scrolls adds this under its last row, and one that pins a bar of
 * its own to the bottom lifts that bar by it.
 */
val LocalBarClearance = androidx.compose.runtime.compositionLocalOf { 0.dp }

private val GlassFill = Color(0xEB160D08)
private val GlassRule = Color(0x29FFFFFF)
private val GlassInactive = Color(0xFFBCC5DA)
private val GlassEmber = Color(0xFFE0652B)
private val IslandShadow = QalaShadow(dx = 2.dp, dy = 4.dp, color = Color(0, 0, 0, 80), ringWidth = 0.dp, ringColor = Color.Transparent)

/** The island's own height: the rest of [TabBarHeight] is the 8 dp of air above and below it. */
private val IslandHeight = 56.dp

/** The page left either side of the island: less than the 16 dp the cards keep, so the bar reads a touch wider than the cards above it. */
private val IslandMargin = 10.dp

/**
 * The bottom tab bar, a dark island that floats in the [TabBarHeight] zone above the navigation inset (S50): 56 dp tall, fully rounded,
 * a hairline and a hard shadow, with 10 dp of page either side. The open tab is an ember pill that holds its icon and its name; the
 * others are icons alone and share what is left. The pill slides between tabs (it snaps with system animations off). Every tab still
 * answers to its name for TalkBack and for tests. [glass] is the more translucent version Today overlays on its film; elsewhere
 * the island is the theme's ink, so it reads the same on a light page and a dark one.
 */
@Composable
fun TabBar(
    items: List<TabItem>,
    selectedIndex: Int,
    onSelect: (Int) -> Unit,
    modifier: Modifier = Modifier,
    glass: Boolean = false,
) {
    val c = Qala.colors
    val rail = railColors()
    val fill = if (glass) GlassFill else rail.rowSelBg
    val rule = if (glass) GlassRule else if (Qala.dark) rail.rowSelBorder else Color.Transparent
    val ember = if (glass) GlassEmber else c.accent
    val animate = animationsEnabled(LocalContext.current)
    Box(
        modifier.fillMaxWidth().windowInsetsPadding(WindowInsets.navigationBars).height(TabBarHeight),
        contentAlignment = Alignment.Center,
    ) {
        Row(
            Modifier
                .widthIn(max = ContentMaxWidth)
                .fillMaxWidth()
                .padding(horizontal = IslandMargin)
                .height(IslandHeight)
                .beamerSurface(fill, rule, IslandHeight / 2, IslandShadow, borderWidth = 1.dp)
                .padding(6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            items.forEachIndexed { i, item ->
                val active = i == selectedIndex
                // 1 for the open tab, 0 for the rest; the weight and the label's colour follow it, so the pill grows and its name comes in with it.
                val open by animateFloatAsState(if (active) 1f else 0f, tween(if (animate) 260 else 0, easing = QalaTokens.ease), label = "tab")
                Row(
                    Modifier
                        .weight(1f + 1.3f * open)
                        .fillMaxHeight()
                        .background(ember.copy(alpha = open), CircleShape)
                        .selectable(
                            selected = active,
                            interactionSource = remember { MutableInteractionSource() },
                            indication = null,
                            role = Role.Tab,
                            onClick = { onSelect(i) },
                        )
                        .semantics { text = AnnotatedString(item.label) },
                    horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    QalaIcon(item.icon, null, size = 22.dp, tint = if (active) Color.White else GlassInactive)
                    // Paint alpha, not a layer: this bar sits over Today's video surface.
                    if (open > 0.01f) {
                        QalaText(
                            item.label,
                            Modifier.clearAndSetSemantics { },
                            QalaType.button.copy(fontSize = 13.sp, lineHeight = 16.sp),
                            Color.White.copy(alpha = open),
                            maxLines = 1,
                        )
                    }
                }
            }
        }
    }
}

/**
 * The phone header: 76 dp, a 2 dp bottom border, the Qala wordmark on the left and the History and Settings
 * buttons on the right.
 */
@Composable
fun TopBar(
    onHistory: () -> Unit,
    onSettings: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val c = Qala.colors
    val border = QalaTokens.borderWidth
    Row(
        modifier = modifier
            .fillMaxWidth()
            .defaultMinSize(minHeight = 76.dp)
            .drawBehind { drawRect(c.border, Offset(0f, size.height - border.toPx()), Size(size.width, border.toPx())) }
            .padding(top = 12.dp, bottom = 12.dp + border),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        QalaText("Qala", style = QalaType.wordmark, color = c.fg)
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(QalaIcons.History, "History", onHistory)
            IconButton(QalaIcons.Settings, "Settings", onSettings)
        }
    }
}

/** The date-and-block eyebrow over a 32 sp page title, with the 24 dp below it that every page head has. */
@Composable
fun PageHead(title: String, modifier: Modifier = Modifier, eyebrow: String? = null) {
    Column(modifier.fillMaxWidth().padding(bottom = 24.dp)) {
        if (eyebrow != null) {
            GroupLabel(eyebrow, Modifier.padding(bottom = 12.dp))
        }
        QalaText(title, style = QalaType.pageTitle, color = Qala.colors.fg)
    }
}

/**
 * The head of a screen that is not a tab (check-in, Settings): a bordered 44 dp Back button, then the [title] in the
 * stage-title face under an optional [eyebrow]. The shell's system Back does the same thing.
 */
@Composable
fun FlowHead(title: String, onBack: () -> Unit, modifier: Modifier = Modifier, eyebrow: String? = null) {
    val c = Qala.colors
    Row(modifier.fillMaxWidth().padding(bottom = 16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.Top) {
        Box(
            Modifier
                .size(44.dp)
                .beamerSurface(c.bgSurface, c.border, QalaTokens.radiusMd, c.shadowCard)
                .clickable(role = Role.Button, onClickLabel = "Back", onClick = onBack),
            contentAlignment = Alignment.Center,
        ) {
            QalaIcon(QalaIcons.ChevronLeft, "Back", size = 22.dp, tint = c.fg)
        }
        Column(Modifier.weight(1f).padding(top = 2.dp)) {
            if (eyebrow != null) GroupLabel(eyebrow, Modifier.padding(bottom = 2.dp))
            QalaText(title, Modifier.semantics { heading() }, QalaType.stageTitle, c.fg)
        }
    }
}
