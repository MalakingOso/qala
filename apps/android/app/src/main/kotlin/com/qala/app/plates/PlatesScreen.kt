package com.qala.app.plates

import android.graphics.BitmapFactory
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.key
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.hideFromAccessibility
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.qala.app.LocalAppContainer
import com.qala.data.core.PlateEntry
import com.qala.data.core.PlatePlan
import com.qala.data.core.QalaCore
import com.qala.data.core.nearestLoadable
import com.qala.data.model.GymSettings
import com.qala.data.core.planPlates
import com.qala.design.GlassButton
import com.qala.design.Group
import com.qala.design.GroupLabel
import com.qala.design.GroupRow
import com.qala.design.IconButton
import com.qala.design.Qala
import com.qala.design.QalaIcons
import com.qala.design.QalaText
import com.qala.design.QalaType
import com.qala.design.ScalePicker
import com.qala.design.ScreenHead
import com.qala.design.SheetCard
import com.qala.design.SheetPage
import com.qala.design.Wash
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

    SheetPage(
        scroll,
        head = { ScreenHead("Plates", onBack = onBack, actions = { GlassButton(onEditPlates, label = "Edit plates") }) },
    ) {
        SheetCard {
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
            val caption = calcCaption(bar, perSide, load?.perSideTotal ?: 0.0)
            // The loaded bar sits on a night ground of its own, the chart panel's, so the plates read the same in both themes.
            Box(Modifier.fillMaxWidth().padding(top = 14.dp, bottom = 8.dp).clip(RoundedCornerShape(10.dp)).background(Wash.Night).padding(horizontal = 12.dp, vertical = 4.dp)) {
                PlateDrawing(perSide, bar.ez, caption, setup.plates)
            }
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
        Spacer(Modifier.height(4.dp))
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

/**
 * The sprites in [files], decoded off the main thread from the copied Blender renders in `assets/plates`. The ones already decoded
 * stay, so a plate that is swapped for another never leaves a hole while its image loads.
 */
@Composable
private fun rememberSprites(files: List<String>): State<Map<String, ImageBitmap>> {
    val context = LocalContext.current
    return produceState<Map<String, ImageBitmap>>(emptyMap(), files) {
        val have = value
        val fresh = withContext(Dispatchers.IO) {
            files.filter { it !in have }.mapNotNull { file ->
                try {
                    context.assets.open("plates/$file").use { BitmapFactory.decodeStream(it)?.asImageBitmap() }?.let { file to it }
                } catch (_: Exception) {
                    null
                }
            }.toMap()
        }
        value = have + fresh
    }
}

/**
 * One side of the loaded bar, every weight where a lifter sees it. Sprites only: the bar, sleeve and plates are the Blender
 * renders, placed by [plateLayout]. [LoadedSleeve] is that drawing at any height, which the plate calculator draws large and the
 * logger draws small under the weight figure.
 */
@Composable
private fun PlateDrawing(perSide: List<Double>, ez: Boolean, caption: String, inventory: List<PlateEntry>) {
    LoadedSleeve(
        perSide, inventory, Modifier.fillMaxWidth(), DrawHeightDp.dp, ez, labelled = true, description = caption,
        floorColor = Color(0, 0, 0, 56), labelColor = Wash.ChartLabel.color,
    )
}

/**
 * The loaded sleeve at a fixed [height]: the one place the plate sprites are laid out. With [animated] each plate slides to its
 * place as the load changes and a new plate slides on, so a stepper that moves the weight moves only the plates. The
 * [labelled] weights under the inner plates are for the large drawing; a small one leaves them to the numbers beside it. [barLength] cuts the bar
 * behind the collar down to a stub that long; the default draws it to the edge.
 * [floorColor] replaces the ellipse the bar sits on (a dark one, over the wash), and [labelColor] the weights under the plates (a light
 * one, over a dark ground).
 */
@Composable
fun LoadedSleeve(
    perSide: List<Double>,
    inventory: List<PlateEntry>,
    modifier: Modifier = Modifier,
    height: Dp = DrawHeightDp.dp,
    ez: Boolean = false,
    labelled: Boolean = false,
    animated: Boolean = true,
    description: String? = null,
    barLength: Dp? = null,
    floorColor: Color? = null,
    labelColor: Color? = null,
) {
    val c = Qala.colors
    BoxWithConstraints(
        modifier
            .height(height)
            .semantics { if (description != null) contentDescription = description else hideFromAccessibility() },
    ) {
        val layout = remember(perSide, ez, maxWidth, inventory, height, labelled, barLength) { plateLayout(perSide, ez, maxWidth.value, inventory, height.value, labelled, barLength?.value) }
        val bitmaps by rememberSprites(layout.draws.map { it.sprite.file }.distinct())
        layout.floor?.let { floor ->
            Canvas(Modifier.fillMaxSize()) {
                drawOval(
                    color = floorColor ?: c.bgRecessed,
                    topLeft = Offset((floor.cx - floor.rx).dp.toPx(), (floor.cy - floor.ry).dp.toPx()),
                    size = Size((floor.rx * 2).dp.toPx(), (floor.ry * 2).dp.toPx()),
                )
            }
        }
        for (draw in layout.draws.sortedBy { it.z }) {
            val bitmap = bitmaps[draw.sprite.file] ?: continue
            if (animated && draw.z in PlateZ) {
                key(draw.z) { PlateSpriteImage(bitmap, draw) }
            } else {
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
                color = labelColor ?: c.fgMuted,
                textAlign = TextAlign.Center,
                modifier = Modifier
                    .offset(x = (label.centerX - 14f).dp, y = label.top.dp)
                    .width(28.dp),
            )
        }
    }
}

/** The z of the plate sprites in [plateLayout]: 10 and up for the plates, the sleeve and bar below, the sleeve end above. */
private val PlateZ = 10..39

/** One plate: it glides to its place when the layout moves it, and slides on from the end of the sleeve when it is new. */
@Composable
private fun PlateSpriteImage(bitmap: ImageBitmap, draw: SpriteDraw) {
    val spec = spring<Float>(stiffness = Spring.StiffnessMediumLow)
    val left by animateFloatAsState(draw.left, spec, label = "plate-left")
    val top by animateFloatAsState(draw.top, spec, label = "plate-top")
    val width by animateFloatAsState(draw.width, spec, label = "plate-width")
    val height by animateFloatAsState(draw.height, spec, label = "plate-height")
    var arrived by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { arrived = true }
    val slide by animateFloatAsState(if (arrived) 0f else SlideInDp, spec, label = "plate-slide")
    val alpha by animateFloatAsState(if (arrived) 1f else 0f, spec, label = "plate-alpha")
    Image(
        bitmap = bitmap,
        contentDescription = null,
        modifier = Modifier
            .offset(x = (left + slide).dp, y = top.dp)
            .size(width = width.dp, height = height.dp)
            .alpha(alpha),
        contentScale = ContentScale.FillBounds,
    )
}

private const val SlideInDp = 24f

/** One plate face at inventory-row size, whatever its weight, in the colour [inventory] gives it. */
@Composable
fun PlateFace(weight: Double, inventory: List<PlateEntry>, height: Float = FaceChipDp) {
    val sprite = plateSprite("face", weight, inventory)
    val bitmaps by rememberSprites(listOfNotNull(sprite?.file))
    val bitmap = sprite?.let { bitmaps[it.file] }
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
