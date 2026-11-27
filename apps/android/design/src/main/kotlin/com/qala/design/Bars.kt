package com.qala.design

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
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
 * answers to its name for TalkBack and for tests. It is the same dark glass on every screen and in both themes (S51), because the wash
 * and the film behind it are dark in both.
 */
@Composable
fun TabBar(
    items: List<TabItem>,
    selectedIndex: Int,
    onSelect: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
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
                .beamerSurface(GlassFill, GlassRule, IslandHeight / 2, IslandShadow, borderWidth = 1.dp)
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
                        .background(GlassEmber.copy(alpha = open), CircleShape)
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
