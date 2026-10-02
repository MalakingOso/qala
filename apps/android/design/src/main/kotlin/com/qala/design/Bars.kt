package com.qala.design

import androidx.compose.foundation.background
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
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp

/** Content is never wider than this, however wide the screen (the web's `.page` max-width). */
val ContentMaxWidth = 560.dp

class TabItem(val label: String, val icon: ImageVector)

/**
 * The bottom tab bar: 72 dp plus the navigation inset, a 2 dp top border, and a 40 x 3 dp ember bar over the
 * active tab. Tabs are at least 44 dp tall.
 */
@Composable
fun TabBar(
    items: List<TabItem>,
    selectedIndex: Int,
    onSelect: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    val c = Qala.colors
    Box(modifier.fillMaxWidth(), contentAlignment = Alignment.TopCenter) {
        Column(
            Modifier
                .widthIn(max = ContentMaxWidth)
                .fillMaxWidth()
                .background(c.bgSurface)
                .windowInsetsPadding(WindowInsets.navigationBars),
        ) {
            Box(Modifier.fillMaxWidth().height(QalaTokens.borderWidth).background(c.border))
            Row(Modifier.fillMaxWidth().height(72.dp - QalaTokens.borderWidth)) {
                items.forEachIndexed { i, item ->
                    val active = i == selectedIndex
                    Box(
                        Modifier
                            .weight(1f)
                            .fillMaxHeight()
                            .selectable(
                                selected = active,
                                interactionSource = remember { MutableInteractionSource() },
                                indication = null,
                                role = Role.Tab,
                                onClick = { onSelect(i) },
                            ),
                        contentAlignment = Alignment.Center,
                    ) {
                        if (active) {
                            Box(
                                Modifier
                                    .align(Alignment.TopCenter)
                                    .size(width = 40.dp, height = 3.dp)
                                    .background(c.accent),
                            )
                        }
                        Column(
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(5.dp),
                        ) {
                            QalaIcon(item.icon, null, size = 22.dp, tint = if (active) c.fg else c.fgMuted)
                            QalaText(item.label, style = QalaType.tabLabel, color = if (active) c.fg else c.fgMuted, maxLines = 1)
                        }
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
