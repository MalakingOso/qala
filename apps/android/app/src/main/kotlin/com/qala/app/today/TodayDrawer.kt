package com.qala.app.today

import androidx.compose.animation.core.animate
import androidx.compose.animation.core.spring
import androidx.compose.foundation.gestures.DraggableState
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.draggable
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.unit.Velocity
import com.qala.design.animationsEnabled
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlin.math.abs
import kotlin.math.max

/** The three places the sheet rests. */
enum class DrawerStop { Closed, Half, Full }

/**
 * Where the three stops are, as the sheet's top edge in px, and the window they were measured for (a change of window snaps the
 * sheet instead of animating it). Computed by [TodayLayout] from what it measured, never from constants. [rowOnly] is true when the
 * vertical timeline does not fit above the closed sheet, so the row stands in for it.
 */
@Immutable
data class DrawerAnchors(val full: Float, val half: Float, val closed: Float, val window: Long, val rowOnly: Boolean = false) {
    fun of(stop: DrawerStop): Float = when (stop) {
        DrawerStop.Closed -> closed
        DrawerStop.Half -> half
        DrawerStop.Full -> full
    }

    fun nearest(x: Float): DrawerStop = DrawerStop.entries.minBy { abs(of(it) - x) }
}

/**
 * The drawer on Today (DECISIONS S48). One number, [t], the sheet's top edge in px, drives every layer: nothing else moves on
 * its own. A finger sets it (past the ends through a rubber band), a release hands it to one spring that carries on at the finger's
 * speed, and a touch mid-flight stops it where it is.
 *
 * Hand-rolled rather than AnchoredDraggable, because that clamps to its anchors and the rubber band and the choreography have to
 * read the overscroll.
 *
 * [q1] runs 0 to 1 from closed to half, [q2] from half to full, and [a] is how far the hero and the day have docked into the sheet.
 * They are read in layout and draw lambdas, so a frame moves the layers without recomposing anything.
 */
@Stable
class DrawerState(initial: DrawerStop) {
    var stop by mutableStateOf(initial)
        private set

    /** The sheet's top edge, px. NaN until the first layout. */
    var t by mutableFloatStateOf(Float.NaN)
        private set
    var anchors by mutableStateOf<DrawerAnchors?>(null)
        private set

    internal var scope: CoroutineScope? = null
    internal var reducedMotion: () -> Boolean = { false }
    internal var rubberPx = 90f

    private var job: Job? = null
    private var raw = 0f
    private var gesture = false

    val q1: Float get() = anchors?.let { ((it.closed - t) / max(1f, it.closed - it.half)).coerceIn(0f, 1f) } ?: 0f
    val q2: Float get() = anchors?.let { ((it.half - t) / max(1f, it.half - it.full)).coerceIn(0f, 1f) } ?: 0f
    val docked: Float get() = smooth(q2 / 0.9f)

    /** The finger's own channel for the root `draggable`. */
    val draggable = DraggableState { dy -> dragBy(dy) }

    // ---- finger ----

    fun beginDrag() {
        job?.cancel()
        raw = unband(t)
        gesture = true
    }

    fun dragBy(dy: Float) {
        if (anchors == null) return
        if (!gesture) beginDrag()
        raw += dy
        t = band(raw)
    }

    fun endDrag(velocity: Float) {
        gesture = false
        val a = anchors ?: return
        // Where the sheet would come to rest if it kept its speed for a moment, then the nearest stop to that.
        settle(a.nearest(t + velocity * 0.17f), velocity)
    }

    /** A touch landed: stops a settle where it is. True when one was running. */
    internal fun touchDown(): Boolean {
        val running = job?.isActive == true
        if (running) job?.cancel()
        return running
    }

    /**
     * The touch is over. A drag settles itself (the draggable, or the list's fling); the cases nothing else settles are a catch
     * that let go under the touch slop (no drag ever starts) and a nested scroll whose fling never arrived. Two frames of grace
     * let a real fling come first.
     */
    internal fun touchUp(caught: Boolean) {
        val s = scope ?: return
        s.launch {
            androidx.compose.runtime.withFrameNanos { }
            androidx.compose.runtime.withFrameNanos { }
            if (job?.isActive != true && (gesture || caught)) endDrag(0f)
        }
    }

    // ---- spring ----

    fun settle(target: DrawerStop, velocity: Float = 0f) {
        job?.cancel()
        stop = target
        val a = anchors ?: return
        val to = a.of(target)
        if (t.isNaN() || reducedMotion()) {
            t = to
            return
        }
        // A response of 460 ms and a damping ratio of 0.9, started at the finger's own velocity: a flick carries on at the same speed.
        job = scope?.launch {
            animate(t, to, velocity, spring(dampingRatio = 0.9f, stiffness = 187f, visibilityThreshold = 0.5f)) { value, _ -> t = value }
        }
    }

    /** The handle's tap, and what TalkBack's click does: closed, half, full, closed. */
    fun cycle() = settle(
        when (stop) {
            DrawerStop.Closed -> DrawerStop.Half
            DrawerStop.Half -> DrawerStop.Full
            DrawerStop.Full -> DrawerStop.Closed
        },
    )

    /**
     * Called by the layout with what it measured. The first layout and a new window snap the sheet to its stop; any other change
     * (a preview bar appearing, a longer title) settles it there, so the sheet glides to its new place instead of jumping.
     */
    internal fun onAnchors(next: DrawerAnchors) {
        val prev = anchors
        if (prev == next) return
        anchors = next
        if (t.isNaN() || prev == null || prev.window != next.window || reducedMotion()) {
            job?.cancel()
            gesture = false
            t = next.of(stop)
        } else if (!gesture) {
            settle(stop)
        }
    }

    // ---- the list's scroll hands over to the sheet ----

    /**
     * An upward scroll moves the sheet to full first and the list after it; what the list cannot scroll down any further drags the
     * sheet down; the fling that ends it settles the sheet when the sheet moved.
     */
    val nestedScroll = object : NestedScrollConnection {
        override fun onPreScroll(available: Offset, source: NestedScrollSource): Offset {
            val a = anchors ?: return Offset.Zero
            if (source != NestedScrollSource.UserInput || available.y >= 0f || t <= a.full + 0.5f) return Offset.Zero
            dragBy(available.y)
            return Offset(0f, available.y)
        }

        override fun onPostScroll(consumed: Offset, available: Offset, source: NestedScrollSource): Offset {
            if (source != NestedScrollSource.UserInput || available.y <= 0f) return Offset.Zero
            dragBy(available.y)
            return Offset(0f, available.y)
        }

        override suspend fun onPreFling(available: Velocity): Velocity {
            if (!gesture) return Velocity.Zero
            endDrag(available.y)
            return available
        }
    }

    // ---- the rubber band, as in the prototype: the sheet follows a finger past the ends at a slowing pace, never further than [rubberPx] ----

    private fun band(x: Float): Float {
        val a = anchors ?: return x
        val m = rubberPx
        return when {
            x < a.full -> a.full - m * (1f - 1f / ((a.full - x) * 0.55f / m + 1f))
            x > a.closed -> a.closed + m * (1f - 1f / ((x - a.closed) * 0.55f / m + 1f))
            else -> x
        }
    }

    private fun unband(y: Float): Float {
        val a = anchors ?: return y
        val m = rubberPx
        fun back(over: Float): Float {
            val u = (over / m).coerceIn(0f, 0.999f)
            return (1f / (1f - u) - 1f) * m / 0.55f
        }
        return when {
            y < a.full -> a.full - back(a.full - y)
            y > a.closed -> a.closed + back(y - a.closed)
            else -> y
        }
    }
}

internal fun smooth(x: Float): Float {
    val c = x.coerceIn(0f, 1f)
    return c * c * (3f - 2f * c)
}

@Composable
fun rememberDrawerState(): DrawerState {
    val state = rememberSaveable(saver = listSaver(save = { listOf(it.stop.ordinal) }, restore = { DrawerState(DrawerStop.entries[it[0]]) })) { DrawerState(DrawerStop.Closed) }
    val context = LocalContext.current
    state.scope = rememberCoroutineScope()
    state.rubberPx = 90f * LocalDensity.current.density
    state.reducedMotion = remember(context) { { !animationsEnabled(context) } }
    return state
}

/**
 * The finger on the whole of Today: a vertical drag moves the sheet (the velocity is tracked for it), and a touch that lands while
 * the sheet is still settling stops it there. The list inside hands its scroll over through [DrawerState.nestedScroll].
 */
fun Modifier.drawerGestures(drawer: DrawerState): Modifier = this
    .pointerInput(drawer) {
        awaitEachGesture {
            awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
            val caught = drawer.touchDown()
            do {
                val event = awaitPointerEvent(PointerEventPass.Final)
            } while (event.changes.any { it.pressed })
            drawer.touchUp(caught)
        }
    }
    .draggable(
        state = drawer.draggable,
        orientation = Orientation.Vertical,
        onDragStarted = { drawer.beginDrag() },
        onDragStopped = { velocity -> drawer.endDrag(velocity) },
    )
