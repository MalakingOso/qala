package com.qala.app.run

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RunFeedTest {
    private val start = 1_800_000_000_000L
    private val stepDeg = 2.7e-5            // about 3 m/s at 1 Hz

    /** A steady 3 m/s run north: [seconds] fixes one second apart from [fromSec], on the line from [lat0]. */
    private fun RunFeed.steady(fromSec: Int, seconds: Int, lat0: Double, firstIsGap: Boolean = false) {
        for (k in 0 until seconds) {
            val r = push(start + (fromSec + k) * 1000L, lat0 + k * stepDeg, -122.3321, 4.0, null, null, gap = firstIsGap && k == 0)
            assertNotNull("fix $k was refused", r)
        }
    }

    @Test
    fun aGapOf120SecondsAnd300MetresCountsNeitherTheJumpNorTheDeadTime() {
        RunFeed(null, start).use { feed ->
            feed.steady(1, 60, 47.6)
            // The phone was not recording for 120 s and the runner is 300 m further on: the first fix after it carries the gap.
            feed.steady(181, 60, 47.6 + 59 * stepDeg + 0.0027, firstIsGap = true)
            val live = feed.live!!
            val run = feed.finish()

            assertEquals("the 120 s with no fixes are cut out, the one normal step they ended with stays", 120_000L, feed.cutMs)
            assertTrue("two minutes of running at 3 m/s, not 300 m more: ${run.distanceM}", run.distanceM in 300.0..400.0)
            assertTrue("moving time without the 120 s: ${run.movingSec}", run.movingSec in 100.0..125.0)
            assertEquals("the saved elapsed time has the cut time back", 239.0, feed.elapsedSec(run), 3.0)
            assertTrue("the jump is marked as a gap", run.points.any { it.gap })
            // What the Live screen showed at the last fix is what the Summary says.
            assertEquals(run.distanceM, live.distM, 1e-6)
            assertEquals(run.movingSec, live.movingSec, 1e-6)
        }
    }

    @Test
    fun withoutACutTheSameGapWouldHaveReadAsAHugeDropInPace() {
        // The control: the same fixes with the real clock (a feed that never marks the gap) see 120 s with no progress.
        RunFeed(null, start).use { cut ->
            RunFeed(null, start).use { raw ->
                cut.steady(1, 60, 47.6)
                raw.steady(1, 60, 47.6)
                cut.steady(181, 60, 47.6 + 59 * stepDeg, firstIsGap = true)
                raw.steady(181, 60, 47.6 + 59 * stepDeg)
                assertEquals(0L, raw.cutMs)
                assertTrue(cut.finish().movingSec < raw.finish().movingSec - 100.0)
            }
        }
    }

    @Test
    fun aFixTheRecorderRefusesIsNotCountedAndTheFeedGoesOn() {
        RunFeed(null, start).use { feed ->
            assertNull("a non-finite position", feed.push(start + 1000, Double.NaN, 0.0, 4.0, null, null, gap = false))
            assertNotNull(feed.push(start + 2000, 47.6, -122.3321, 4.0, null, null, gap = false))
        }
    }
}
