package com.qala.app.plates

import android.graphics.BitmapFactory
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.qala.app.LocalAppContainer
import com.qala.data.core.PlateEntry
import com.qala.data.core.PlatePlan
import com.qala.data.core.QalaCore
import com.qala.data.core.nearestLoadable
import com.qala.data.model.GymSettings
import com.qala.data.core.planPlates
import com.qala.design.Card
import com.qala.design.FlowHead
import com.qala.design.Group
import com.qala.design.GroupLabel
import com.qala.design.GroupRow
import com.qala.design.IconButton
import com.qala.design.Qala
import com.qala.design.QalaIcons
import com.qala.design.QalaText
import com.qala.design.QalaType
import com.qala.design.ScalePicker
import com.qala.design.SecondaryButton
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * The plate calculator (DESIGN 7.12): a big target, the bar choice, the loaded bar drawn from the
 * Blender sprites, the arithmetic, and the inventory as plate faces. The math is the Rust port in
 * qala-core, planned on the bar and the inventory Settings holds. As on the web, picking 45 or 35 sets
 * the default bar every lift is planned with, while the curl bar is a choice for this screen only.
 * Reached from Settings, as the web reaches it from its Bars and plates group; Edit plates goes back to
 * Settings, where the inventory is edited.
 */
@Composable
fun PlatesScreen(scroll: ScrollState, onBack: () -> Unit, onEditPlates: () -> Unit) {
    val c = Qala.colors
    val container = LocalAppContainer.current
    val setup = container.settings.gym.collectAsState(initial = GymSettings()).value.plates
    var target by rememberSaveable { mutableStateOf(DefaultTarget) }
    var ez by rememberSaveable { mutableStateOf(false) }
    val options = barOptions(setup)
    val barIndex = selectedBarIndex(options, setup, ez)
    val bar = options[barIndex]
    val plan by produceState<PlatePlan?>(null, target, bar, setup.plates) {
        value = withContext(Dispatchers.Default) {
            QalaCore.planPlates(target, bar.weight, setup.plates)
        }
    }
    val load = plan?.nearestLoadable()
    val perSide = load?.perSide ?: emptyList()

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(scroll)
            .statusBarsPadding()
            .padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 24.dp),
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.weight(1f)) { FlowHead("Plates", onBack) }
            SecondaryButton("Edit plates", onClick = onEditPlates, small = true)
        }
        Spacer(Modifier.height(16.dp))
        Card(hero = true, contentPadding = 16.dp) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Column(Modifier.weight(1.2f)) {
                    GroupLabel("Target")
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        IconButton(QalaIcons.Minus, "Less weight", onClick = { target = stepTarget(target, -1, bar.weight) })
                        QalaText(
                            "${fmtWeight(target)} lb",
                            style = QalaType.figure.copy(fontSize = 24.sp),
                            modifier = Modifier.weight(1f),
                            textAlign = TextAlign.Center,
                        )
                        IconButton(QalaIcons.Plus, "More weight", onClick = { target = stepTarget(target, 1, bar.weight) })
                    }
                }
                Column(Modifier.weight(1f)) {
                    GroupLabel("Bar")
                    ScalePicker(
                        labels = options.map { it.label },
                        selected = barIndex,
                        onPick = { picked ->
                            ez = options[picked].ez
                            if (!ez) container.scope.launch(start = CoroutineStart.UNDISPATCHED) { container.settings.setDefaultBar(options[picked].weight) }
                        },
                        groupLabel = "Bar",
                        cellHeight = 44.dp,
                        fontSize = 12.5.sp,
                    )
                }
            }
            Spacer(Modifier.height(8.dp))
            val caption = calcCaption(bar, perSide, load?.perSideTotal ?: 0.0)
            PlateDrawing(perSide, bar.ez, caption, setup.plates)
            QalaText(caption, style = QalaType.body, color = c.fgSecondary)
            Spacer(Modifier.height(4.dp))
            val summary = calcSummary(bar, load, target)
            Row(verticalAlignment = Alignment.CenterVertically) {
                QalaText(summary.main, style = QalaType.body)
                if (summary.hint != null) {
                    Spacer(Modifier.width(8.dp))
                    QalaText(summary.hint, style = QalaType.hint, color = c.fgMuted)
                }
            }
        }
        Spacer(Modifier.height(16.dp))
        Group("Your plates") {
            setup.plates.forEachIndexed { i, entry ->
                GroupRow(last = i == setup.plates.lastIndex) {
                    PlateFace(entry.weight, setup.plates)
                    QalaText("${fmtWeight(entry.weight)} lb", style = QalaType.body)
                    Spacer(Modifier.weight(1f))
                    QalaText(pairsText(entry.pairs), style = QalaType.hint, color = c.fgMuted)
                }
            }
        }
    }
}

/** A sprite decoded from the copied Blender renders in `assets/plates`. */
@Composable
private fun rememberSpriteBitmap(file: String): ImageBitmap? {
    val context = LocalContext.current
    return remember(file) {
        try {
            context.assets.open("plates/$file").use { BitmapFactory.decodeStream(it)?.asImageBitmap() }
        } catch (_: Exception) {
            null
        }
    }
}

/**
 * One side of the loaded bar, every weight where a lifter sees it. Sprites only:
 * the bar, sleeve and plates are the Blender renders, placed by [plateLayout].
 */
@Composable
private fun PlateDrawing(perSide: List<Double>, ez: Boolean, caption: String, inventory: List<PlateEntry>) {
    val c = Qala.colors
    BoxWithConstraints(
        Modifier
            .fillMaxWidth()
            .height(DrawHeightDp.dp)
            .semantics { contentDescription = caption },
    ) {
        val layout = remember(perSide, ez, maxWidth, inventory) { plateLayout(perSide, ez, maxWidth.value, inventory) }
        val context = LocalContext.current
        val files = layout.draws.map { it.sprite.file }.distinct()
        val bitmaps by produceState<Map<String, ImageBitmap>>(emptyMap(), files) {
            value = withContext(Dispatchers.IO) {
                files.mapNotNull { file ->
                    try {
                        context.assets.open("plates/$file").use { BitmapFactory.decodeStream(it)?.asImageBitmap() }
                            ?.let { file to it }
                    } catch (_: Exception) {
                        null
                    }
                }.toMap()
            }
        }
        layout.floor?.let { floor ->
            Canvas(Modifier.fillMaxSize()) {
                drawOval(
                    color = c.bgRecessed,
                    topLeft = Offset((floor.cx - floor.rx).dp.toPx(), (floor.cy - floor.ry).dp.toPx()),
                    size = Size((floor.rx * 2).dp.toPx(), (floor.ry * 2).dp.toPx()),
                )
            }
        }
        for (draw in layout.draws.sortedBy { it.z }) {
            val bitmap = bitmaps[draw.sprite.file]
            if (bitmap != null) {
                Image(
                    bitmap = bitmap,
                    contentDescription = null,
                    modifier = Modifier
                        .offset(x = draw.left.dp, y = draw.top.dp)
                        .size(width = draw.width.dp, height = draw.height.dp),
                    contentScale = ContentScale.FillBounds,
                )
            }
        }
        for (label in layout.labels) {
            QalaText(
                label.text,
                style = QalaType.log.copy(fontSize = 10.sp),
                color = c.fgMuted,
                textAlign = TextAlign.Center,
                modifier = Modifier
                    .offset(x = (label.centerX - 14f).dp, y = label.top.dp)
                    .width(28.dp),
            )
        }
    }
}

/** One plate face at inventory-row size, whatever its weight, in the colour [inventory] gives it. */
@Composable
fun PlateFace(weight: Double, inventory: List<PlateEntry>, height: Float = FaceChipDp) {
    val sprite = plateSprite("face", weight, inventory)
    val bitmap = sprite?.let { rememberSpriteBitmap(it.file) }
    if (sprite != null && bitmap != null) {
        Image(
            bitmap = bitmap,
            contentDescription = null,
            modifier = Modifier.size(width = (height * sprite.w / sprite.h).dp, height = height.dp),
            contentScale = ContentScale.FillBounds,
        )
    } else {
        Spacer(Modifier.size(height.dp))
    }
}
