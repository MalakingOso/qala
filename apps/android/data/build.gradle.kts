import javax.inject.Inject
import org.gradle.process.ExecOperations

plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.plugin.serialization")
    id("com.google.devtools.ksp")
}

// Rust side (docs/PLAN-m1-rust-core.md, Build), moved here from the app in M2: the data module owns the
// UniFFI bindings and the native library, and the app gets both by depending on it. The repo root is two
// levels up from apps/android.
val rustRoot: File = rootProject.projectDir.parentFile.parentFile
val rustProfile: String = providers.gradleProperty("qala.rustProfile").getOrElse("android-dev")
val targetAbi: String = providers.gradleProperty("qala.abi").getOrElse("arm64-v8a")

fun rustSources() = fileTree(rustRoot) {
    include("Cargo.toml", "Cargo.lock", "rust-toolchain.toml", "crates/**/*.rs", "crates/**/Cargo.toml", "crates/**/data/**")
    exclude("**/target/**")
}

/** Host build of qala-ffi: the unstripped library carries the UniFFI metadata bindgen reads, and the JVM unit tests load it. */
abstract class CargoHostBuild : DefaultTask() {
    @get:Inject abstract val exec: ExecOperations
    @get:Internal abstract val repoRoot: Property<File>
    @get:InputFiles @get:PathSensitive(PathSensitivity.NONE) abstract val sources: ConfigurableFileCollection
    @get:OutputFile abstract val library: RegularFileProperty

    @TaskAction
    fun build() {
        exec.exec {
            workingDir = repoRoot.get()
            environment("CARGO_BUILD_JOBS", "8")
            commandLine("cargo", "build", "-p", "qala-ffi", "--features", "cli")
        }
    }
}

/** Kotlin bindings from the host library, library mode (no UDL). */
abstract class GenerateUniffi : DefaultTask() {
    @get:Inject abstract val exec: ExecOperations
    @get:Internal abstract val repoRoot: Property<File>
    @get:InputFile @get:PathSensitive(PathSensitivity.NONE) abstract val library: RegularFileProperty
    @get:OutputDirectory abstract val outDir: DirectoryProperty

    @TaskAction
    fun generate() {
        outDir.get().asFile.deleteRecursively()
        exec.exec {
            workingDir = repoRoot.get()
            environment("CARGO_BUILD_JOBS", "8")
            commandLine(
                "cargo", "run", "-p", "qala-ffi", "--features", "cli", "--bin", "uniffi-bindgen", "--",
                "generate", "--library", library.get().asFile.absolutePath,
                "--language", "kotlin", "--out-dir", outDir.get().asFile.absolutePath,
            )
        }
    }
}

/** The Android .so via cargo-ndk, into a generated jniLibs directory. */
abstract class CargoNdkBuild : DefaultTask() {
    @get:Inject abstract val exec: ExecOperations
    @get:Internal abstract val repoRoot: Property<File>
    @get:Input abstract val abi: Property<String>
    @get:Input abstract val profile: Property<String>
    @get:InputFiles @get:PathSensitive(PathSensitivity.NONE) abstract val sources: ConfigurableFileCollection
    @get:OutputDirectory abstract val jniLibs: DirectoryProperty

    @TaskAction
    fun build() {
        exec.exec {
            workingDir = repoRoot.get()
            // A job cap keeps rustc from taking the machine down (see docs/PLAN-m1-rust-core.md, Build).
            environment("CARGO_BUILD_JOBS", "8")
            commandLine(
                "cargo", "ndk", "-t", abi.get(), "-o", jniLibs.get().asFile.absolutePath,
                "build", "-p", "qala-ffi", "--profile", profile.get(),
            )
        }
    }
}

/** Copies the 2 h run vector into the instrumented tests' assets. Only that file: the rest of testdata/golden/run is large. */
abstract class CopyRunVectors : DefaultTask() {
    @get:InputFile @get:PathSensitive(PathSensitivity.NONE) abstract val source: RegularFileProperty
    @get:OutputDirectory abstract val outDir: DirectoryProperty

    @TaskAction
    fun copy() {
        val dir = outDir.get().asFile
        dir.deleteRecursively()
        dir.mkdirs()
        source.get().asFile.copyTo(File(dir, "process_run_2h.json"))
    }
}

val copyRunVectors = tasks.register<CopyRunVectors>("copyRunVectors") {
    source.set(File(rustRoot, "testdata/golden/run/process_run_2h.json"))
    outDir.set(layout.buildDirectory.dir("generated/runVectorAssets"))
}

val cargoHostBuild = tasks.register<CargoHostBuild>("cargoHostBuild") {
    this.repoRoot.set(project.provider { rustRoot })
    sources.from(rustSources())
    library.set(File(rustRoot, "target/debug/libqala_ffi.so"))
}

val generateUniffi = tasks.register<GenerateUniffi>("generateUniffiKotlin") {
    this.repoRoot.set(project.provider { rustRoot })
    library.set(cargoHostBuild.flatMap { it.library })
    outDir.set(layout.buildDirectory.dir("generated/uniffi/kotlin"))
}

val cargoNdkBuild = tasks.register<CargoNdkBuild>("cargoNdkBuild") {
    this.repoRoot.set(project.provider { rustRoot })
    this.abi.set(targetAbi)
    this.profile.set(rustProfile)
    sources.from(rustSources())
    jniLibs.set(layout.buildDirectory.dir("generated/rustJniLibs"))
}

androidComponents {
    onVariants { variant ->
        variant.sources.kotlin?.addGeneratedSourceDirectory(generateUniffi, GenerateUniffi::outDir)
        variant.sources.jniLibs?.addGeneratedSourceDirectory(cargoNdkBuild, CargoNdkBuild::jniLibs)
        variant.androidTest?.sources?.assets?.addGeneratedSourceDirectory(copyRunVectors, CopyRunVectors::outDir)
    }
}

// JVM unit tests load the host library through JNA.
tasks.withType<Test>().configureEach {
    dependsOn(cargoHostBuild)
    systemProperty("jna.library.path", File(rustRoot, "target/debug").absolutePath)
}

android {
    namespace = "com.qala.data"
    compileSdk {
        version = release(37)
    }
    buildToolsVersion = "36.1.0"

    defaultConfig {
        minSdk = 34
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        ndk {
            // Same single ABI as the app: the library's androidTest APK packages the jniLibs built above
            // (./gradlew :data:connectedDebugAndroidTest -Pqala.abi=x86_64 for the emulator).
            abiFilters += targetAbi
        }
    }

    buildFeatures {
        // DebugSeeder checks BuildConfig.DEBUG; AGP 9 leaves BuildConfig off by default.
        buildConfig = true
    }

    lint {
        // arm64-v8a only, same decision as the app.
        disable += setOf("ChromeOsAbiSupport")
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_21
        targetCompatibility = JavaVersion.VERSION_21
    }

    testOptions {
        unitTests.isIncludeAndroidResources = false
    }
}

// Room writes its schema JSON here so migrations can be tested against it later. Checked in.
ksp {
    arg("room.schemaLocation", "$projectDir/schemas")
    arg("room.generateKotlin", "true")
}

dependencies {
    // Room 2.8.5 with KSP (docs/PLAN-m2-room-data.md, Verified toolchain).
    api("androidx.room:room-runtime:2.8.5")
    api("androidx.room:room-ktx:2.8.5")
    ksp("androidx.room:room-compiler:2.8.5")

    api("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.11.0")
    api("org.jetbrains.kotlinx:kotlinx-serialization-json:1.11.0")

    // UniFFI's Kotlin bindings call the Rust library through JNA. The aar carries the Android natives,
    // the jar on the unit-test classpath carries the host ones.
    implementation("net.java.dev.jna:jna:5.17.0@aar")

    testImplementation("junit:junit:4.13.2")
    testImplementation("net.java.dev.jna:jna:5.17.0")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.11.0")
    // The Android SDK stubs org.json in unit tests; the real one keeps the FFI tests readable.
    testImplementation("org.json:json:20250517")

    androidTestImplementation("androidx.test.ext:junit:1.3.0")
    androidTestImplementation("androidx.test:runner:1.7.0")
    androidTestImplementation("androidx.test:core:1.7.0")
    androidTestImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.11.0")
}
