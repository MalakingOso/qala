package com.qala.data

import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement

/** Test access to files of the repository outside the module. Gradle runs unit tests in the module directory. */
object TestRepo {
    /** `apps/android/data` to the repository root. */
    val root = File("../../..").canonicalFile

    fun file(path: String): File = File(root, path).also { check(it.exists()) { "missing $path under $root" } }

    fun json(path: String): JsonElement = Json.parseToJsonElement(file(path).readText())
}
