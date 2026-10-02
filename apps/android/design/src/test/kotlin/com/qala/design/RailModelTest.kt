package com.qala.design

import com.qala.design.StageDotState.Done
import com.qala.design.StageDotState.Later
import com.qala.design.StageDotState.Now
import com.qala.design.StageDotState.Skipped
import org.junit.Assert.assertEquals
import org.junit.Test

class RailModelTest {
    private fun stage(id: String, state: StageDotState, interlude: Boolean = false, doneTime: String? = null) =
        RailStage(id, id.replaceFirstChar { it.uppercase() }, state, interlude, doneTime)

    private val liftDay = listOf(
        stage("check-in", Done, doneTime = "6:52"),
        stage("warm-up", Done, doneTime = "7:12"),
        stage("lift", Now),
        stage("recover", Later, interlude = true),
        stage("run", Later),
        stage("wind down", Later, interlude = true),
    )
    private val restDay = listOf(
        stage("check-in", Now),
        stage("recover", Later, interlude = true),
        stage("wind down", Later, interlude = true),
    )

    @Test fun nextStageStepsOneAtATime() {
        assertEquals(3, nextStage(liftDay, 2, +1))
        assertEquals(1, nextStage(liftDay, 2, -1))
    }

    @Test fun nextStageSkipsNothing() {      // an interlude is a stop like any other
        assertEquals(3, nextStage(liftDay, 2, +1))
        assertEquals(4, nextStage(liftDay, 3, +1))
    }

    @Test fun nextStageClampsAtBothEnds() {
        assertEquals(0, nextStage(liftDay, 0, -1))
        assertEquals(5, nextStage(liftDay, 5, +1))
        assertEquals(2, nextStage(restDay, 2, +1))
    }

    @Test fun nextStageToleratesAnEmptyList() = assertEquals(0, nextStage(emptyList(), 0, +1))

    @Test fun nowIsTheNowStage() {
        assertEquals(2, nowIndex(liftDay))
        assertEquals(0, nowIndex(restDay))
    }

    @Test fun nowSkipsAnInterlude() {
        val list = listOf(
            stage("lift", Done),
            stage("recover", Now, interlude = true),
            stage("run", Now),
        )
        assertEquals(2, nowIndex(list))
    }

    @Test fun withoutANowStageItIsTheFirstUnfinishedOne() {
        val list = listOf(
            stage("check-in", Done),
            stage("recover", Later, interlude = true),
            stage("lift", Later),
            stage("run", Later),
        )
        assertEquals(2, nowIndex(list))
    }

    @Test fun anAllDoneDayPointsAtTheLastStage() {
        val list = liftDay.map { it.copy(state = Done) }
        assertEquals(5, nowIndex(list))
        assertEquals(2, nowIndex(restDay.map { it.copy(state = Done) }))
    }

    @Test fun aSkippedStageIsNotDone() {
        val list = listOf(stage("check-in", Skipped), stage("recover", Later, interlude = true))
        assertEquals(0, nowIndex(list))
    }

    @Test fun nowToleratesAnEmptyList() = assertEquals(0, nowIndex(emptyList()))

    @Test fun descriptionNamesNowAndProgress() {
        assertEquals("Day stages: lift now, 2 of 6 done", railDescription(liftDay))
        assertEquals("Day stages: check-in now, 0 of 3 done", railDescription(restDay))
    }

    @Test fun descriptionOmitsNowWhenNothingIsNow() {
        assertEquals("Day stages: 6 of 6 done", railDescription(liftDay.map { it.copy(state = Done) }))
        assertEquals("Day stages", railDescription(emptyList()))
    }
}
