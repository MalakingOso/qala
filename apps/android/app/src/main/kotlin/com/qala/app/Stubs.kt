package com.qala.app

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.qala.data.repo.StubStage
import com.qala.design.Card
import com.qala.design.IconButton
import com.qala.design.PageHead
import com.qala.design.PrimaryButton
import com.qala.design.Qala
import com.qala.design.QalaIcons
import com.qala.design.QalaText
import com.qala.design.QalaType
import kotlinx.coroutines.launch

/*
 * Stand-ins for the screens that arrive later (check-in in M4, the lifting and run screens in A4), so Today's buttons
 * have somewhere real to go and the rail can be seen to move. Each one writes the smallest honest record through the
 * repositories, then goes back to Today; the rail and the hero advance on their own because they observe the engine
 * snapshot. The writes run on the container's scope, not the screen's: going back leaves the screen's scope, and a
 * Room transaction launched there could be cancelled half way.
 */

/** The back row over a stub's title: the in-app twin of the system Back. */
@Composable
private fun StubHead(title: String, onBack: () -> Unit) {
    IconButton(QalaIcons.ChevronLeft, "Back", onBack, Modifier.offset(x = (-12).dp))      // the glyph, not its 44 dp box, sits on the gutter
    Spacer(Modifier.height(8.dp))
    PageHead(title, eyebrow = "Stand-in screen")
}

@Composable
private fun StubBody(note: String, label: String, onClick: () -> Unit) {
    var busy by remember { mutableStateOf(false) }       // one tap, one record
    Card {
        QalaText(note, style = QalaType.hint, color = Qala.colors.fgMuted)
        Spacer(Modifier.height(20.dp))
        PrimaryButton(label, onClick = { busy = true; onClick() }, enabled = !busy)
    }
}

/** Saves a basic check-in: recovery 7 of 10 and no soreness. M4 replaces this with the real screen. */
@Composable
fun CheckInStub(onBack: () -> Unit) {
    val container = LocalAppContainer.current
    Column {
        StubHead("Check-in", onBack)
        StubBody(
            note = "The real check-in arrives with M4. Save writes a basic one, recovery 7 of 10 and no soreness, so readiness and the rail have a check-in to work from.",
            label = "Save",
        ) {
            container.scope.launch { container.checkIns.save(recovery = 7.0) }
            onBack()
        }
    }
}

@Composable
fun WarmUpStub(onBack: () -> Unit) = StageStub("Warm-up", StubStage.WARM_UP, "The warm-up screen arrives with the lifting screens (A4). Mark done logs the warm-up and moves the day on.", onBack)

@Composable
fun WorkoutStub(onBack: () -> Unit) = StageStub("Workout", StubStage.LIFT, "The workout screen arrives with the lifting screens (A4). Mark done logs the lift, with no sets, and moves the day on.", onBack)

@Composable
private fun StageStub(title: String, stage: StubStage, note: String, onBack: () -> Unit) {
    val container = LocalAppContainer.current
    Column {
        StubHead(title, onBack)
        StubBody(note, "Mark done") {
            val programDay = container.engine.snapshot.value.today?.programDay
            container.scope.launch { container.sessions.markStageDone(stage, programDay) }
            onBack()
        }
    }
}

@Composable
fun RunStub(onBack: () -> Unit) {
    val container = LocalAppContainer.current
    Column {
        StubHead("Run", onBack)
        StubBody("The run screen arrives with the run work (A2). Mark done logs a run with no distance and moves the day on.", "Mark done") {
            container.scope.launch { container.runs.markDone() }
            onBack()
        }
    }
}
