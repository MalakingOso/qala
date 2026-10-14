package com.qala.app.coach

import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import java.net.InetAddress
import java.net.InetSocketAddress
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The real client against a JDK HTTP server on the loopback address: the request on the wire, and each way the answer can go. */
class HttpCoachClientTest {
    private val servers = mutableListOf<HttpServer>()

    @After
    fun stop() = servers.forEach { it.stop(0) }

    private class Seen(val method: String, val path: String, val contentType: String?, val accept: String?, val body: String)

    /** A server that records what it was sent and answers [status] and [body]; [pauseMs] makes it slow. */
    private fun serve(status: Int, body: String, seen: AtomicReference<Seen>? = null, pauseMs: Long = 0): String {
        val server = HttpServer.create(InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0)
        server.createContext("/") { x: HttpExchange ->
            seen?.set(Seen(x.requestMethod, x.requestURI.path, x.requestHeaders.getFirst("Content-Type"), x.requestHeaders.getFirst("Accept"), x.requestBody.readBytes().decodeToString()))
            if (pauseMs > 0) Thread.sleep(pauseMs)
            val bytes = body.toByteArray()
            x.responseHeaders.add("Content-Type", "application/json")
            x.sendResponseHeaders(status, if (bytes.isEmpty()) -1 else bytes.size.toLong())
            if (bytes.isNotEmpty()) x.responseBody.use { it.write(bytes) }
            x.close()
        }
        server.start()
        servers += server
        return "http://127.0.0.1:${server.address.port}"
    }

    private fun ask(client: HttpCoachClient) = runBlocking { client.ask(CoachFixtures.request) }

    @Test
    fun postsTheFixtureRequestAndReadsTheFixtureAnswer() {
        val seen = AtomicReference<Seen>()
        val result = ask(HttpCoachClient(serve(200, CoachFixtures.text("ask_ok.json"), seen))) as CoachResult.Answer
        assertEquals("The engine has 245 because", result.response.reply.take(26))
        assertEquals(240.0, result.response.suggestion!!.coach.weight, 0.0)

        val request = seen.get()
        assertEquals("POST", request.method)
        assertEquals("/api/coach/ask", request.path)
        assertEquals("application/json; charset=utf-8", request.contentType)
        assertEquals("application/json", request.accept)
        assertEquals(CoachFixtures.request, Json.decodeFromString<CoachRequest>(request.body))
    }

    @Test
    fun aBaseUrlWithATrailingSlashStillReachesTheRoute() {
        val seen = AtomicReference<Seen>()
        ask(HttpCoachClient(serve(200, CoachFixtures.text("ask_ok.json"), seen) + "/"))
        assertEquals("/api/coach/ask", seen.get().path)
    }

    @Test
    fun theDegradedBodyOn502IsDegraded() {
        val r = ask(HttpCoachClient(serve(502, CoachFixtures.text("ask_degraded.json")))) as CoachResult.Unavailable
        assertEquals(Why.Degraded, r.why)
        assertEquals("fetch failed: connection refused", r.detail)
    }

    @Test
    fun aMissingIdentityOn401IsNotRecognised() {
        val r = ask(HttpCoachClient(serve(401, CoachFixtures.text("ask_unauthorized.json")))) as CoachResult.Unavailable
        assertEquals(Why.NotRecognised, r.why)
    }

    @Test
    fun anEmptyErrorBodyIsReadWithoutAFuss() {
        val r = ask(HttpCoachClient(serve(503, ""))) as CoachResult.Unavailable
        assertEquals(Why.Unreachable, r.why)
        assertNull(r.detail?.takeIf { it.isEmpty() })
    }

    @Test
    fun nothingListeningIsUnreachable() {
        val url = serve(200, "{}")
        servers.single().stop(0)          // the port is now closed
        val r = ask(HttpCoachClient(url, connectTimeoutMs = 500)) as CoachResult.Unavailable
        assertEquals(Why.Unreachable, r.why)
    }

    @Test
    fun aServerThatAnswersTooSlowlyTimesOutIntoUnreachable() {
        val started = System.nanoTime()
        val r = ask(HttpCoachClient(serve(200, CoachFixtures.text("ask_ok.json"), pauseMs = 1500), readTimeoutMs = 200)) as CoachResult.Unavailable
        assertEquals(Why.Unreachable, r.why)
        assertTrue("gave up at the read timeout, not when the server answered", (System.nanoTime() - started) / 1_000_000 < 1200)
    }

    @Test
    fun aBaseUrlThatIsNotAUrlIsAnUnavailableCoachNotACrash() {
        val r = ask(HttpCoachClient("not a url")) as CoachResult.Unavailable
        assertTrue(r.why == Why.Failed || r.why == Why.Unreachable)
    }
}
