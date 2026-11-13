package com.qala.data

import androidx.room.testing.MigrationTestHelper
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.qala.data.db.QalaDatabase
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Version 1 to 2: a populated v1 database keeps every row, the new columns read null, and the new table works. */
@RunWith(AndroidJUnit4::class)
class MigrationTest {
    private val file = "migration-test.db"

    @get:Rule
    val helper = MigrationTestHelper(InstrumentationRegistry.getInstrumentation(), QalaDatabase::class.java)

    @Test
    fun v1ToV2KeepsTheRowsAndAddsTheColumnsAndTheTable() {
        helper.createDatabase(file, 1).apply {
            execSQL("INSERT INTO lift_session (id, startedAtMs, offsetMin, programDayIndex, stub, stage, minutes, srpe, notes, deleted) VALUES ('s1', 1000, -240, 2, 0, NULL, 61.5, 7.0, 'n', 0)")
            execSQL("INSERT INTO lift_entry (id, sessionId, position, exerciseId) VALUES ('s1/0', 's1', 0, 'squat')")
            execSQL("INSERT INTO lift_set (id, entryId, position, weight, unit, reps, rpe, targetRpe, completed, warmup, tested1rm, jointPain) VALUES ('s1/0/0', 's1/0', 0, 225.0, 'lb', 5.0, 8.0, NULL, 1, 0, 0, 0)")
            execSQL("INSERT INTO run_session (id, startedAtMs, offsetMin, distanceM, movingSec, elapsedSec, stub, srpe, minutes, hrTrimp, gradeProfileJson, descentM, notes, deleted) VALUES ('r1', 2000, -240, 5000.0, 1500.0, 1520.0, 0, NULL, NULL, NULL, NULL, NULL, NULL, 0)")
            close()
        }
        val db = helper.runMigrationsAndValidate(file, 2, true)
        db.query("SELECT minutes, notes, warmupSec, liftSec, restSec FROM lift_session WHERE id = 's1'").use {
            it.moveToFirst()
            assertEquals(61.5, it.getDouble(0), 0.0)
            assertEquals("n", it.getString(1))
            for (c in 2..4) assertEquals(true, it.isNull(c))
        }
        db.query("SELECT weight, reps, restTakenSec, restBaseSec, restAdjustSec, restPlannedSec FROM lift_set WHERE id = 's1/0/0'").use {
            it.moveToFirst()
            assertEquals(225.0, it.getDouble(0), 0.0)
            assertEquals(5.0, it.getDouble(1), 0.0)
            for (c in 2..5) assertEquals(true, it.isNull(c))
        }
        db.query("SELECT distanceM FROM run_session WHERE id = 'r1'").use { it.moveToFirst(); assertEquals(5000.0, it.getDouble(0), 0.0) }
        // The new table takes a fix, and a fix delivered twice is one row.
        db.execSQL("INSERT OR IGNORE INTO run_fix (runId, tMs, lat, lon, acc, hr, ele, gap, advances) VALUES ('r1', 5, 1.0, 2.0, 3.0, NULL, NULL, 0, 0)")
        db.execSQL("INSERT OR IGNORE INTO run_fix (runId, tMs, lat, lon, acc, hr, ele, gap, advances) VALUES ('r1', 5, 9.0, 9.0, 9.0, NULL, NULL, 1, 1)")
        db.query("SELECT COUNT(*), MIN(lat) FROM run_fix").use { it.moveToFirst(); assertEquals(1, it.getInt(0)); assertEquals(1.0, it.getDouble(1), 0.0) }
    }
}
