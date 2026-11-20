package com.qala.app.today

import android.os.SystemClock
import androidx.annotation.OptIn
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageShader
import androidx.compose.ui.graphics.ShaderBrush
import androidx.compose.ui.graphics.TileMode
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.Constraints
import androidx.core.net.toUri
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.compose.PlayerSurface
import androidx.media3.ui.compose.SURFACE_TYPE_SURFACE_VIEW
import com.qala.app.R
import com.qala.design.animationsEnabled
import kotlinx.coroutines.delay
import kotlin.math.abs
import kotlin.math.roundToInt
import kotlin.math.sqrt

/**
 * Today's film (DECISIONS S48): a muted loop behind the whole screen with a 1960s Super 8 look. The colour grade is baked into
 * the file (scripts/grade-today-film.sh), so what is left here is cheap and moves: a warm scrim, grain that jumps every 0.42 s,
 * a faint flicker, a vignette, and a small weave of the frame. Nothing above the video is an alpha, offscreen or render-effect
 * layer, so the SurfaceView composites cleanly; every overlay is plain drawing.
 *
 * [parallaxPx] shifts the frame (a placement offset on a 5% oversized frame) and [extraScrim] darkens the whole stack, both
 * read where they are used, so a drag moves them without recomposing anything. Reduced motion shows the poster alone: no
 * player, no weave, no flicker, grain that holds still.
 */
@Composable
fun TodayFilm(
    modifier: Modifier = Modifier,
    parallaxPx: () -> Float = { 0f },
    extraScrim: () -> Float = { 0f },
) {
    val context = LocalContext.current
    val live = remember { animationsEnabled(context) }
    val clock = rememberFilmClock(live)
    Box(modifier.fillMaxSize().background(Warm)) {
        FilmFrame(live, clock, parallaxPx)
        Box(Modifier.fillMaxSize().filmOverlays(clock, extraScrim))
    }
}

private val Warm = Color(0xFF1A0F08)

/** The frame is 5% bigger than the window so the weave and the parallax never show an edge. */
private const val Overscan = 1.05f

@Composable
private fun FilmFrame(live: Boolean, clock: FilmClock, parallaxPx: () -> Float) {
    val frame = Modifier
        .fillMaxSize()
        .layout { measurable, constraints ->
            val w = (constraints.maxWidth * Overscan).roundToInt()
            val h = (constraints.maxHeight * Overscan).roundToInt()
            val placeable = measurable.measure(Constraints.fixed(w, h))
            layout(constraints.maxWidth, constraints.maxHeight) {
                // Read here, in placement: a step of the weave or a pixel of the drag re-places the frame and nothing else.
                val dp = density
                val weave = Weave[clock.weave]
                placeable.place(
                    ((constraints.maxWidth - w) / 2f + weave.first * dp).roundToInt(),
                    ((constraints.maxHeight - h) / 2f + weave.second * dp + parallaxPx()).roundToInt(),
                )
            }
        }
    if (live) FilmPlayer(frame) else Poster(frame)
}

@Composable
private fun Poster(modifier: Modifier = Modifier) {
    Image(painterResource(R.drawable.today_poster), null, modifier.fillMaxSize(), contentScale = ContentScale.Crop)
}

@OptIn(UnstableApi::class)
@Composable
private fun FilmPlayer(modifier: Modifier) {
    val context = LocalContext.current
    val player = remember {
        ExoPlayer.Builder(context)
            .setAudioAttributes(AudioAttributes.DEFAULT, false)          // never asks for audio focus: the file has no sound, and music keeps playing
            .build()
            .apply {
                repeatMode = Player.REPEAT_MODE_ONE
                videoScalingMode = C.VIDEO_SCALING_MODE_SCALE_TO_FIT_WITH_CROPPING
                volume = 0f
                setMediaItem(MediaItem.fromUri("android.resource://${context.packageName}/${R.raw.today_film}".toUri()))
                prepare()
            }
    }
    DisposableEffect(player) { onDispose { player.release() } }
    // Paused while the app is not on screen, so a film nobody can see does not decode.
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(player, lifecycle) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_START -> player.play()
                Lifecycle.Event.ON_STOP -> player.pause()
                else -> {}
            }
        }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }
    // The poster stays up until the first frame is on the surface, so entering Today never flashes black. This is PlayerSurface and a
    // listener of our own rather than ContentFrame: ContentFrame watches the player from a coroutine, and the Compose UI test rule runs
    // those on the instrumentation thread, where an ExoPlayer refuses to be touched. The video itself is cropped to the surface.
    var rendered by remember(player) { mutableStateOf(false) }
    DisposableEffect(player) {
        val listener = object : Player.Listener {
            override fun onRenderedFirstFrame() {
                rendered = true
            }
        }
        player.addListener(listener)
        onDispose { player.removeListener(listener) }
    }
    Box(modifier) {
        PlayerSurface(player, Modifier.fillMaxSize(), SURFACE_TYPE_SURFACE_VIEW)
        if (!rendered) Poster()
    }
}

// ---- the clock ----

/**
 * One slow clock for the film's stepped effects. [ms] ticks at 25 Hz while the screen is started; the three derived values change
 * only when a step does (the grain every 0.42 s, the weave seven times in 1.2 s, the flicker eight times in 2.4 s), so readers
 * are told about those and not about every tick.
 */
@Stable
private class FilmClock {
    var ms by mutableLongStateOf(0L)
    val grain by derivedStateOf { ((ms / 420) % 4).toInt() }
    val weave by derivedStateOf { stepOf(ms % 1200, WeaveAt) }
    val flicker by derivedStateOf { Flicker[stepOf(ms % 2400, FlickerAt)] }
}

@Composable
private fun rememberFilmClock(live: Boolean): FilmClock {
    val clock = remember { FilmClock() }
    if (live) {
        val lifecycle = LocalLifecycleOwner.current.lifecycle
        LaunchedEffect(clock, lifecycle) {
            lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
                val start = SystemClock.uptimeMillis() - clock.ms
                while (true) {
                    delay(40)
                    clock.ms = SystemClock.uptimeMillis() - start
                }
            }
        }
    }
    return clock
}

/** The index of the last step in [at] that is not after [t]. */
private fun stepOf(t: Long, at: LongArray): Int {
    var i = at.size - 1
    while (i > 0 && at[i] > t) i--
    return i
}

// The prototype's keyframes (weave8 over 1.2 s, flick8 over 2.4 s), held between steps. dp, as the prototype's px are. Rotation is dropped: a SurfaceView does not turn.
private val WeaveAt = longArrayOf(0, 168, 336, 516, 684, 852, 1032)
private val Weave = listOf(0f to 0f, -1.4f to 0.9f, 0.8f to -1.1f, -0.6f to -0.4f, 1.3f to 0.7f, -1f to 1.2f, 0.5f to -0.8f)
private val FlickerAt = longArrayOf(0, 216, 408, 744, 1056, 1392, 1704, 2064)
private val Flicker = floatArrayOf(0.02f, 0.09f, 0.03f, 0.08f, 0.02f, 0.10f, 0.04f, 0.07f)
private val GrainStep = listOf(0f to 0f, -31f to 17f, 23f to -29f, -17f to -41f)

// ---- the overlays ----

private val Flick = Color(0xFFFFE2AA)

/** 256 px of monochrome noise whose alpha follows how far each pixel is from mid grey: soft, and the same tile every launch. */
private fun grainTile(): androidx.compose.ui.graphics.ImageBitmap {
    val size = 256
    val random = java.util.Random(8)
    val pixels = IntArray(size * size) {
        val v = random.nextInt(256)
        val alpha = (abs(v - 128) * 2 * 0.9f).toInt().coerceIn(0, 255)
        val grey = if (v >= 128) 255 else 0
        (alpha shl 24) or (grey shl 16) or (grey shl 8) or grey
    }
    return android.graphics.Bitmap.createBitmap(pixels, size, size, android.graphics.Bitmap.Config.ARGB_8888).asImageBitmap()
}

private fun Modifier.filmOverlays(clock: FilmClock, extraScrim: () -> Float): Modifier = drawWithCache {
    val tile = grainTile()
    val grain = ShaderBrush(ImageShader(tile, TileMode.Repeated, TileMode.Repeated))
    val warm = Brush.verticalGradient(
        0f to Warm.copy(alpha = 0.62f),
        0.24f to Warm.copy(alpha = 0.24f),
        0.44f to Warm.copy(alpha = 0.30f),
        0.66f to Warm.copy(alpha = 0.84f),
        1f to Warm.copy(alpha = 0.93f),
    )
    // CSS: radial-gradient(ellipse at 50% 45%, transparent 50%, rgba(14,8,4,.55) 100%), farthest-corner.
    val centre = Offset(size.width * 0.5f, size.height * 0.45f)
    val rx = size.width * 0.5f * sqrt(2f)
    val ry = size.height * 0.55f * sqrt(2f)
    val vignette = Brush.radialGradient(0.5f to Color.Transparent, 1f to Color(0xFF0E0804).copy(alpha = 0.55f), center = centre, radius = rx)
    val squash = ry / rx
    val density = this.density
    onDrawBehind {
        drawRect(warm)
        val extra = extraScrim()
        if (extra > 0f) drawRect(Warm.copy(alpha = extra.coerceIn(0f, 1f)))
        drawRect(Flick.copy(alpha = clock.flicker))
        // Grain: the tile at one dp per pixel, shifted a step every 0.42 s, on a rect 60 dp bigger than the window on every side.
        val (gx, gy) = GrainStep[clock.grain]
        val bleed = 60f * density
        translate(gx * density - bleed, gy * density - bleed) {
            scale(density, density, Offset.Zero) {
                drawRect(grain, Offset.Zero, Size((size.width + 2 * bleed) / density, (size.height + 2 * bleed) / density), alpha = 0.15f)
            }
        }
        scale(1f, squash, centre) {
            val top = centre.y + (0f - centre.y) / squash
            val bottom = centre.y + (size.height - centre.y) / squash
            drawRect(vignette, Offset(0f, top), Size(size.width, bottom - top))
        }
    }
}
