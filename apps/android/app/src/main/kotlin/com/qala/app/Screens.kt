package com.qala.app

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import com.qala.design.Card
import com.qala.design.DmMonoFamily
import com.qala.design.Group
import com.qala.design.GroupLabel
import com.qala.design.GroupRow
import com.qala.design.PageHead
import com.qala.design.PrimaryButton
import com.qala.design.Qala
import com.qala.design.QalaIcon
import com.qala.design.QalaIcons
import com.qala.design.QalaText
import com.qala.design.QalaType
import com.qala.design.SecondaryButton

@Composable
fun Screen(route: Route) {
    when (route) {
        Route.Today -> TodayScreen()
        Route.Plan -> StubScreen("Plan", "Week and block view. Arrives with the lifting screens (A4).")
        Route.Body -> StubScreen("Body", "Measurements and recovery. Arrives with the stats screens (A5).")
        Route.Progress -> StubScreen("Progress", "Charts and records. Arrives with the stats screens (A5).")
        Route.Coach -> StubScreen("Coach", "Chat and suggestions. Arrives with the coach route (A6).")
        Route.History -> StubScreen("History", "Past sessions. Arrives with the rest of A1.")
        Route.Settings -> StubScreen("Settings", "Units, equipment, title font. Arrives with the rest of A1.")
    }
}

@Composable
private fun StubScreen(title: String, note: String) {
    PageHead(title)
    Card {
        QalaText(note, style = QalaType.hint, color = Qala.colors.fgMuted)
    }
}

/** Today on sample strings, to compare against DESIGN 7.1: the stage card without the rail or charts. */
@Composable
private fun TodayScreen() {
    val c = Qala.colors
    PageHead("Today", eyebrow = "Sunday · Strength block 2 / week 3")
    Card(hero = true) {
        Row(Modifier.fillMaxWidth().defaultMinSize(minHeight = 32.dp), verticalAlignment = Alignment.CenterVertically) {
            GroupLabel("Now · Warm-up", color = c.accent)
        }
        Spacer(Modifier.height(10.dp))
        QalaText("Lower A", style = QalaType.stageTitle)
        QalaText("Squat day", Modifier.padding(top = 6.dp, bottom = 20.dp), QalaType.hint, c.fgMuted)
        Column(
            Modifier
                .fillMaxWidth()
                .drawBehind { drawRect(c.border, Offset.Zero, Size(size.width, 1.dp.toPx())) }
                .padding(top = 1.dp + 16.dp, bottom = 16.dp),
        ) {
            GroupLabel("Your top set")
            QalaText(
                buildAnnotatedString {
                    append("245 ")
                    withStyle(SpanStyle(
                            fontFamily = DmMonoFamily,
                            fontWeight = FontWeight.Normal,
                            fontSize = QalaType.figureUnit.fontSize,
                            color = c.fgMuted,
                        )) {
                        append("lb")
                    }
                    append(" × 4")
                },
                Modifier.padding(vertical = 6.dp),
                QalaType.figure,
            )
            QalaText("Readiness 72 / 100. A little under your average, so squat holds.", style = QalaType.hint, color = c.fgMuted)
        }
        Row(
            Modifier.padding(top = 12.dp, bottom = 20.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            QalaIcon(QalaIcons.Clock, null, size = 16.dp, tint = c.fgSecondary)
            QalaText("10 min warm-up · 15 min lift", style = QalaType.body.copy(fontSize = QalaType.groupLabel.fontSize), color = c.fgSecondary)
        }
        PrimaryButton("Start warm-up", onClick = {}, large = true, icon = QalaIcons.Flame)
        Row(Modifier.padding(vertical = 20.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.Top) {
            QalaIcon(QalaIcons.SportShoe, null, Modifier.padding(top = 3.dp), size = 18.dp, tint = c.fgSecondary)
            Column {
                GroupLabel("Then · 6 pm")
                QalaText("Easy run · 3.0 mi", style = QalaType.hint, color = c.fgSecondary)
            }
        }
    }
    Spacer(Modifier.height(24.dp))
    SecondaryButton("Run first instead", onClick = {})
    Spacer(Modifier.height(24.dp))
    Group("This week") {
        GroupRow {
            QalaText("Mon", Modifier.weight(1f))
            QalaText("Lower A · squat", color = c.fgSecondary)
        }
        GroupRow {
            QalaText("Wed", Modifier.weight(1f))
            QalaText("Upper A · bench", color = c.fgSecondary)
        }
        GroupRow(last = true) {
            QalaText("Fri", Modifier.weight(1f))
            QalaText("Lower B · deadlift", color = c.fgSecondary)
        }
    }
}
