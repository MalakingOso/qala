package com.qala.app.coach

import com.qala.app.today.trimNumber
import kotlin.math.roundToInt
import kotlinx.coroutines.delay

/**
 * A stand-in for the server, for debug builds only: MainActivity swaps it in when the launch intent carries
 * `--es qala.coach <mode>` (see [demoCoachClient]) and the build is a debug one. It answers in the shape of
 * the fixtures in testdata/golden/coach, so the Coach screen can be looked at, and screenshotted, without a server or
 * a model. A release build never reads the extra.
 */
class DemoCoachClient(private val mode: String, private val delayMs: Long = 600) : CoachClient {
    override suspend fun ask(request: CoachRequest): CoachResult {
        delay(delayMs)
        return when (mode) {
            "offline" -> CoachResult.Unavailable(Why.Unreachable, "Failed to connect to /10.0.2.2:8500")
            "degraded" -> CoachResult.Unavailable(Why.Degraded, "fetch failed: connection refused")
            "unauthorized" -> CoachResult.Unavailable(Why.NotRecognised, "missing Tailscale identity")
            else -> CoachResult.Answer(answer(request))
        }
    }

    private fun answer(request: CoachRequest): CoachResponse {
        val limits = CoachLimits(weightPctMin = -10.0, weightPctMax = 2.5, setsMin = -2, setsMax = 1)
        val lift = request.context?.lift
            ?: return CoachResponse(
                ReplyStatus.Ok,
                "Readiness is fine and nothing is sore enough to change the plan. Keep today easy and sleep well.",
                limits,
            )
        val coachWeight = (lift.weight * 0.98 / 2.5).roundToInt() * 2.5
        val engine = CoachNumbers(lift.weight, lift.unit, lift.sets, lift.reps, lift.rpe)
        return CoachResponse(
            ReplyStatus.Ok,
            "The engine has ${trimNumber(lift.weight)} because your last top set moved well. Today's check-in shows some soreness, so I would pull it back a little and keep the reps.",
            limits,
            CoachSuggestion(
                title = lift.title,
                engine = engine,
                coach = engine.copy(weight = coachWeight),
                weightPct = Math.round((coachWeight / lift.weight - 1) * 1000) / 10.0,
                setsDelta = 0,
                reason = "Soreness in today's check-in. Small pullback, same reps.",
                status = SuggestionStatus.Accepted,
            ),
        )
    }
}

/** The client for a debug launch's `qala.coach` extra: "demo" answers, "offline", "degraded" and "unauthorized" fail as named. Null for anything else. */
fun demoCoachClient(mode: String): CoachClient? =
    if (mode in setOf("demo", "offline", "degraded", "unauthorized")) DemoCoachClient(mode) else null
