package com.qala.app

import android.graphics.Color as AndroidColor
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.qala.design.DayMenu
import com.qala.design.DayRail
import com.qala.design.DmMonoFamily
import com.qala.design.GroupLabel
import com.qala.design.CardNotch
import com.qala.design.PreviewBar
import com.qala.design.PrimaryButton
import com.qala.design.Qala
import com.qala.design.QalaIcons
import com.qala.design.QalaTheme
import com.qala.design.QalaTokens
import com.qala.design.QalaText
import com.qala.design.QalaType
import com.qala.design.RailStage
import com.qala.design.StageDotState
import com.qala.design.TabBar
import com.qala.design.TabItem
import com.qala.design.beamerSurface
import com.qala.design.nextStage
import com.qala.design.nowIndex
import com.qala.design.rememberCardNotch
import com.qala.design.trackNotch

/**
 * Debug-only harness for the day rail (it ships in debug builds only, and has no launcher entry). Fake stages and five
 * fake cards, wired the way Today will be: the rail reports its band, each card turns the band into its bite.
 *
 *     adb shell am start -n com.qala.app/.RailDemoActivity --es day lift --ez dark false
 *
 * Extras: `day` lift (six stages, default) or rest (three); `dark` true or false; `menu` true opens the menu at
 * launch; `viewing` N starts previewing stage N; `scroll` N starts N px down; `skipped` true skips the run stage.
 */
class RailDemoActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val dark = intent.getBooleanExtra("dark", false)
        val bars = if (dark) SystemBarStyle.dark(AndroidColor.TRANSPARENT) else SystemBarStyle.light(AndroidColor.TRANSPARENT, AndroidColor.TRANSPARENT)
        enableEdgeToEdge(statusBarStyle = bars, navigationBarStyle = bars)
        val lift = intent.getStringExtra("day") != "rest"
        val stages = fakeStages(lift, intent.getBooleanExtra("skipped", false))
        setContent {
            QalaTheme(dark) {
                RailDemo(
                    lift = lift,
                    stages = stages,
                    startViewing = intent.getIntExtra("viewing", -1),
                    startMenu = intent.getBooleanExtra("menu", false),
                    startScroll = intent.getIntExtra("scroll", 0),
                )
            }
        }
    }
}

private fun fakeStages(lift: Boolean, skippedRun: Boolean): List<RailStage> = if (lift) {
    listOf(
        RailStage("check-in", "Check-in", StageDotState.Done, doneTime = "6:52"),
        RailStage("warm-up", "Warm-up", StageDotState.Done, doneTime = "7:12"),
        RailStage("lift", "Lift", StageDotState.Now),
        RailStage("recover", "Recover", StageDotState.Later, interlude = true),
        RailStage("run", "Run", if (skippedRun) StageDotState.Skipped else StageDotState.Later),
        RailStage("wind-down", "Wind down", StageDotState.Later, interlude = true),
    )
} else {
    listOf(
        RailStage("check-in", "Check-in", StageDotState.Now),
        RailStage("recover", "Recover", StageDotState.Later, interlude = true),
        RailStage("wind-down", "Wind down", StageDotState.Later, interlude = true),
    )
}

private val Small = QalaType.body.copy(fontSize = 12.sp, lineHeight = 17.sp)
private val Body = QalaType.body.copy(fontSize = 13.sp, lineHeight = 19.sp)

private val TabItems = listOf(
    TabItem("Today", QalaIcons.Sun),
    TabItem("Plan", QalaIcons.CalendarRange),
    TabItem("Body", QalaIcons.Activity),
    TabItem("Progress", QalaIcons.TrendingUp),
    TabItem("Coach", QalaIcons.MessageSquareText),
)

@Composable
private fun RailDemo(lift: Boolean, stages: List<RailStage>, startViewing: Int, startMenu: Boolean, startScroll: Int) {
    val c = Qala.colors
    val now = nowIndex(stages)
    var viewing by remember { mutableIntStateOf(if (startViewing in stages.indices) startViewing else now) }
    var menu by remember { mutableStateOf(startMenu) }
    var band by remember { mutableStateOf(Rect.Zero) }
    val scroll = rememberScrollState()
    LaunchedEffect(Unit) { if (startScroll > 0) scroll.scrollTo(startScroll) }
    val stage = stages[viewing]

    Box(Modifier.fillMaxSize().background(c.bg)) {
        Column(Modifier.fillMaxSize()) {
            // The pinned head and the preview bar: structural, so they never scroll under the rail and need no bite.
            Column(
                Modifier
                    .fillMaxWidth()
                    .drawBehind { drawRect(c.border, Offset(0f, size.height - 2.dp.toPx()), Size(size.width, 2.dp.toPx())) }
                    .statusBarsPadding()
                    .padding(top = 12.dp, bottom = 2.dp),
            ) {
                Column(Modifier.padding(horizontal = 18.dp)) {
                    GroupLabel(if (lift) "Sunday · Strength block 2, week 3" else "Sunday · Rest day", Modifier.padding(bottom = 2.dp))
                    QalaText("Today", style = QalaType.pageTitle)
                }
                PreviewBar(
                    visible = viewing != now,
                    label = stage.label,
                    onBackToNow = { viewing = now },
                    modifier = Modifier.padding(horizontal = 14.dp),
                )
                Spacer(Modifier.height(10.dp))
            }
            Box(Modifier.weight(1f).fillMaxWidth()) {
                Column(Modifier.fillMaxSize().verticalScroll(scroll).padding(start = 14.dp, end = 14.dp, top = 14.dp, bottom = 16.dp)) {
                    val rect = { band }
                    RailCard(rememberCardNotch(rect)) {
                        GroupLabel(if (viewing == now) "Now · ${stage.label.lowercase()}" else "Preview · ${stage.label.lowercase()}", color = c.accent)
                        QalaText("Lower A · Squat day", Modifier.padding(top = 4.dp), QalaType.cardTitle)
                        QalaText("Squat 3 × 4 at 245 · 55 min", Modifier.padding(bottom = 8.dp), Small, c.fgSecondary)
                        QalaText(
                            buildAnnotatedString {
                                append("245 ")
                                withStyle(SpanStyle(fontFamily = DmMonoFamily, fontSize = QalaType.figureUnit.fontSize, color = c.fgMuted)) { append("lb") }
                                append(" × 4")
                            },
                            Modifier.fillMaxWidth().padding(vertical = 2.dp),
                            QalaType.figure,
                            textAlign = TextAlign.Center,
                        )
                        QalaText("A little under your average, so squat holds.", Modifier.fillMaxWidth().padding(bottom = 10.dp), Small, c.fgSecondary, TextAlign.Center)
                        PrimaryButton("Start warm-up", onClick = {}, icon = QalaIcons.Flame)
                        QalaText("245 × 4 · 245 × 4 · 245 × 3", Modifier.fillMaxWidth().padding(top = 10.dp), QalaType.log.copy(fontSize = 11.sp), c.fgSecondary, TextAlign.Center)
                    }
                    RailCard(rememberCardNotch(rect)) {
                        GroupLabel("Then · 6 pm")
                        QalaText("Easy run · 3.0 mi", Modifier.padding(top = 4.dp), QalaType.cardTitle)
                        QalaText("Conversational pace · cue every half mile", Modifier.padding(top = 2.dp), Small, c.fgSecondary)
                    }
                    RailCard(rememberCardNotch(rect)) {
                        GroupLabel("Readiness · 72 of 100")
                        QalaText("A little under average", Modifier.padding(top = 4.dp), QalaType.cardTitle)
                        QalaText("Squat holds at 245. Quads ready Wednesday, everything else is ready now.", Modifier.padding(top = 6.dp), Body)
                    }
                    RailCard(rememberCardNotch(rect)) {
                        GroupLabel("This week")
                        QalaText("6 of 7 days moving", Modifier.padding(top = 4.dp), QalaType.cardTitle)
                        Row(Modifier.fillMaxWidth().padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                            "MTWTFSS".forEachIndexed { i, day ->
                                val fill = if (i < 6) c.progressFill else c.accent
                                Box(
                                    Modifier.weight(1f).height(26.dp).background(fill, RoundedCornerShape(QalaTokens.radius)),
                                    contentAlignment = Alignment.Center,
                                ) { QalaText(day.toString(), style = QalaType.tabLabel, color = if (i < 6) c.bg else c.onAccent) }
                            }
                        }
                    }
                    RailCard(rememberCardNotch(rect)) {
                        GroupLabel("Body · this morning")
                        QalaText("178.2 lb ↓ 0.4", Modifier.padding(top = 4.dp), QalaType.cardTitle)
                        QalaText("Third down day in a row. The seven-day trend is 0.9 lb lower than last week.", Modifier.padding(top = 6.dp), Body)
                    }
                }
                DayRail(
                    stages = stages,
                    viewing = viewing,
                    onStep = { viewing = nextStage(stages, viewing, it) },
                    onOpenMenu = { menu = true },
                    onBandChanged = { band = it },
                    modifier = Modifier.align(Alignment.CenterStart),
                )
            }
            TabBar(TabItems, selectedIndex = 0, onSelect = {})
        }
        DayMenu(
            open = menu,
            title = "Sunday",
            stages = stages,
            viewing = viewing,
            nowIndex = now,
            onSelect = { viewing = it },
            onClose = { menu = false },
        )
    }
}

/** A Today card: 44 dp of start padding past the border so no glyph enters the notch zone, and the bite wired in. */
@Composable
private fun RailCard(notch: CardNotch, content: @Composable ColumnScope.() -> Unit) {
    val c = Qala.colors
    val border = QalaTokens.borderWidth
    Column(
        Modifier
            .fillMaxWidth()
            .padding(bottom = 12.dp)
            .trackNotch(notch)
            .beamerSurface(c.bgSurface, c.border, QalaTokens.radiusLg, c.shadowCard, notch = notch)
            .padding(start = border + 44.dp, end = border + 14.dp, top = border + 14.dp, bottom = border + 14.dp),
        content = content,
    )
}
