package com.qala.app

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.qala.data.db.QalaDatabase
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/** The container wires the database, writer, repositories and engine; a debug build seeds it on start. */
@RunWith(AndroidJUnit4::class)
class AppContainerTest {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val context = ApplicationProvider.getApplicationContext<Context>()

    @After
    fun close() = scope.cancel()

    @Test
    fun aDebugStartSeedsTheDatabaseAndTheEngineFollows() = runBlocking {
        val container = AppContainer(QalaDatabase.inMemory(context), scope = scope, seedInDebug = true)
        container.start()
        val seeded = withTimeout(120_000) { container.sessions.liftSessions.first { it.size >= 10 } }
        assertTrue(seeded.size >= 10)
        val snapshot = withTimeout(120_000) {
            container.engine.snapshot.first { it.loaded && it.stateView?.fitness?.isNotEmpty() == true }
        }
        assertNull(snapshot.error, snapshot.error)
        assertTrue(snapshot.today!!.stages.size == 6 || snapshot.today!!.stages.size == 3)
        container.database.close()
    }

    @Test
    fun aStartWithoutTheSeedLeavesEveryTableEmpty() = runBlocking {
        val container = AppContainer(QalaDatabase.inMemory(context), scope = scope, seedInDebug = false)
        container.start()
        val snapshot = withTimeout(60_000) { container.engine.snapshot.first { it.loaded } }
        assertEquals(emptyList<Any>(), container.sessions.liftSessions.first())
        assertEquals(emptyList<Any>(), container.checkIns.checkIns.first())
        assertNull(container.programs.active.first())
        assertEquals(0.0, snapshot.stateView!!.fatigueSystemic, 0.0)
        container.database.close()
    }
}
