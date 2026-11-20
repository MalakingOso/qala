package com.qala.design

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
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

/** Content is never wider than this, however wide the screen (the web's `.page` max-width). */
val ContentMaxWidth = 560.dp

class TabItem(val label: String, val icon: ImageVector)

/** The tab bar without the navigation inset: Today's sheet stops are measured against it. */
val TabBarHeight = 72.dp

/** The tab bar over Today's film: dark tint (no cheap backdrop blur on native), a hairline on top, white and pale-blue labels in either theme. */
private val GlassFill = Color(0xEB160D08)
private val GlassRule = Color(0x29FFFFFF)
private val GlassInactive = Color(0xFFBCC5DA)
private val GlassEmber = Color(0xFFE0652B)

/**
 * The bottom tab bar: 72 dp plus the navigation inset, a 2 dp top border, and a 40 x 3 dp ember bar over the
 * active tab. Tabs are at least 44 dp tall. [glass] is the dark translucent version Today overlays on its film.
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
    val fill = if (glass) GlassFill else c.bgSurface
    val rule = if (glass) GlassRule else c.border
    val ember = if (glass) GlassEmber else c.accent
    val ink = if (glass) Color.White else c.fg
    val muted = if (glass) GlassInactive else c.fgMuted
    Box(modifier.fillMaxWidth(), contentAlignment = Alignment.TopCenter) {
        Column(
            Modifier
                .widthIn(max = ContentMaxWidth)
                .fillMaxWidth()
                .background(fill)
                .windowInsetsPadding(WindowInsets.navigationBars),
        ) {
            val ruleHeight = if (glass) 1.dp else QalaTokens.borderWidth
            Box(Modifier.fillMaxWidth().height(ruleHeight).background(rule))
            Row(Modifier.fillMaxWidth().height(TabBarHeight - ruleHeight)) {
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
                                    .background(ember),
                            )
                        }
                        Column(
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(5.dp),
                        ) {
                            QalaIcon(item.icon, null, size = 22.dp, tint = if (active) ink else muted)
                            QalaText(item.label, style = QalaType.tabLabel, color = if (active) ink else muted, maxLines = 1)
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
