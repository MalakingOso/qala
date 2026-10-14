package com.qala.app.coach

import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString

/**
 * The app's first HTTP call, on `HttpURLConnection` so it adds no dependency. One POST to `{baseUrl}/api/coach/ask`,
 * JSON in and JSON out, on the IO dispatcher, with timeouts on both the connect and the read. The read timeout is longer
 * than the server's own model timeout (45 s), so a slow model comes back as the server's degraded body rather than as a
 * dropped connection.
 *
 * The request carries no credentials. Identity is the Tailscale header, which `tailscale serve` adds in front of the
 * server; on the emulator nothing does, so the answer is a 401 and the screen shows its unavailable state.
 */
class HttpCoachClient(
    baseUrl: String,
    private val connectTimeoutMs: Int = 5_000,
    private val readTimeoutMs: Int = 60_000,
) : CoachClient {
    private val endpoint = baseUrl.trimEnd('/') + "/api/coach/ask"

    override suspend fun ask(request: CoachRequest): CoachResult = withContext(Dispatchers.IO) {
        var connection: HttpURLConnection? = null
        try {
            connection = (URL(endpoint).openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = connectTimeoutMs
                readTimeout = readTimeoutMs
                doOutput = true
                setRequestProperty("Content-Type", "application/json; charset=utf-8")
                setRequestProperty("Accept", "application/json")
            }
            val payload = CoachJson.encodeToString(request).toByteArray(Charsets.UTF_8)
            connection.setFixedLengthStreamingMode(payload.size)
            connection.outputStream.use { it.write(payload) }
            val status = connection.responseCode
            val stream = if (status < 400) connection.inputStream else connection.errorStream
            parseCoachResult(status, stream?.use { readCapped(it) } ?: "")
        } catch (e: CancellationException) {
            throw e
        } catch (e: IOException) {
            CoachResult.Unavailable(Why.Unreachable, e.message ?: e::class.simpleName)
        } catch (e: RuntimeException) {
            // A malformed base URL is the usual one; either way the coach is unavailable, never a crash.
            CoachResult.Unavailable(Why.Failed, e.message ?: e::class.simpleName)
        } finally {
            connection?.disconnect()
        }
    }

    /** At most [MaxReplyBytes]: the answer is a few sentences, so anything larger is not the coach. */
    private fun readCapped(stream: InputStream): String =
        String(stream.readNBytes(MaxReplyBytes), Charsets.UTF_8)

    private companion object {
        const val MaxReplyBytes = 256 * 1024
    }
}
