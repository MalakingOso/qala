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
 * A stand-in for the run screen, which arrives with the run work (A2), so Today's button has somewhere to go and the
 * rail can be seen to move. It writes the smallest honest record through the repository, then goes back to Today; the
 * rail and the hero advance on their own because they observe the engine snapshot. The write runs on the container's
 * scope, not the screen's: going back leaves the screen's scope, and a Room transaction launched there could be
 * cancelled half way. The warm-up and the workout are real screens now (the workout package).
 */

/** The back row over the stub's title: the in-app twin of the system Back. */
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
