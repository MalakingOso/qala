package com.qala.design

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

/*
 * The three carriers (DECISIONS S51). One wash sits behind every screen but Today's film, and a screen puts its content on one of three
 * surfaces by what you do there: the Wash (doing: content straight on it, white cards only to read), the Sheet (reading or asking:
 * Today's cream sheet over a wash head) or the Glass (comparing: floating glass cards, each chart in a night panel flush inside its card).
 * The wash, the night panel and the tab island look the same in Light and Dark. The sheet and the glass follow the theme, through the
 * colours below.
 */

/** Today's cream: the sheet's body in the Light theme. */
val CreamLight = Color(0xFFF7F0E5)

/** The sheet's fill, 95% opaque: cream in Light, the theme's own background in Dark. Pinned bars (a composer, a Save bar) use it too. */
@Composable
@ReadOnlyComposable
fun sheetColor(): Color = (if (Qala.dark) Qala.colors.bg else CreamLight).copy(alpha = 0.95f)

/** The glass card's fill: warm translucent white in Light, umber glass in Dark. */
@Composable
@ReadOnlyComposable
fun glassFill(): Color = if (Qala.dark) Color(24, 14, 8, 148) else Color(255, 248, 238, 189)

/** Text on glass: warm ink in Light, white in Dark. */
@Composable
@ReadOnlyComposable
fun glassInk(): Color = if (Qala.dark) Color.White else Color(0xFF1B0E05)

/** Secondary text on glass. */
@Composable
@ReadOnlyComposable
fun glassMuted(): Color = if (Qala.dark) Color.White.copy(alpha = 0.72f) else Color(0xFF5A4A3C)

/** The glass card's hairline. */
@Composable
@ReadOnlyComposable
fun glassLine(): Color = Color.White.copy(alpha = if (Qala.dark) 0.16f else 0.55f)

/**
 * A card of warm glass over the wash: a 10 dp radius, a hairline and no shadow (a hard shadow would show through the glass), no blur
 * (the wash under it is already a blurred still). [header] is the title row; [body] is a plain block of content; [panel] is the chart's
 * night ground, which runs flush to the card's edges so the card reads as one two-tone object. Content in [header] and [body] takes the
 * glass ink by default; use [glassMuted] for the quiet lines.
 */
@Composable
fun GlassCard(
    modifier: Modifier = Modifier,
    header: (@Composable RowScope.() -> Unit)? = null,
    body: (@Composable ColumnScope.() -> Unit)? = null,
    panel: (@Composable ColumnScope.() -> Unit)? = null,
) {
    val shape = RoundedCornerShape(10.dp)
    CompositionLocalProvider(LocalContentColor provides glassInk()) {
        Column(modifier.fillMaxWidth().clip(shape).background(glassFill(), shape).border(1.dp, glassLine(), shape)) {
            if (header != null) {
                Row(
                    Modifier.fillMaxWidth().padding(start = 14.dp, end = 14.dp, top = 12.dp, bottom = 10.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.Top,
                    content = header,
                )
            }
            if (body != null) Column(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 12.dp), content = body)
            if (panel != null) {
                CompositionLocalProvider(LocalContentColor provides Color.White) {
                    Column(Modifier.fillMaxWidth().background(Wash.Night).padding(start = 8.dp, end = 8.dp, top = 10.dp, bottom = 6.dp), content = panel)
                }
            }
        }
    }
}
