import javax.inject.Inject
import org.gradle.process.ExecOperations

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
}

// Rust side (docs/PLAN-m1-rust-core.md, Build). The repo root is two levels up from apps/android.
val repoRoot: File = rootProject.projectDir.parentFile.parentFile
val rustProfile: String = providers.gradleProperty("qala.rustProfile").getOrElse("android-dev")
val abi: String = providers.gradleProperty("qala.abi").getOrElse("arm64-v8a")

fun rustSources() = fileTree(repoRoot) {
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

val cargoHostBuild = tasks.register<CargoHostBuild>("cargoHostBuild") {
    this.repoRoot.set(project.provider { repoRoot })
    sources.from(rustSources())
    library.set(File(repoRoot, "target/debug/libqala_ffi.so"))
}

val generateUniffi = tasks.register<GenerateUniffi>("generateUniffiKotlin") {
    this.repoRoot.set(project.provider { repoRoot })
    library.set(cargoHostBuild.flatMap { it.library })
    outDir.set(layout.buildDirectory.dir("generated/uniffi/kotlin"))
}

val cargoNdkBuild = tasks.register<CargoNdkBuild>("cargoNdkBuild") {
    this.repoRoot.set(project.provider { repoRoot })
    this.abi.set(abi)
    this.profile.set(rustProfile)
    sources.from(rustSources())
    jniLibs.set(layout.buildDirectory.dir("generated/rustJniLibs"))
}

androidComponents {
    onVariants { variant ->
        variant.sources.kotlin?.addGeneratedSourceDirectory(generateUniffi, GenerateUniffi::outDir)
        variant.sources.jniLibs?.addGeneratedSourceDirectory(cargoNdkBuild, CargoNdkBuild::jniLibs)
    }
}

// JVM unit tests load the host library through JNA.
tasks.withType<Test>().configureEach {
    dependsOn(cargoHostBuild)
    systemProperty("jna.library.path", File(repoRoot, "target/debug").absolutePath)
}

android {
    namespace = "com.qala.app"
    // Compose 1.12.1 (BOM 2026.09.00) needs compileSdk 37.
    compileSdk {
        version = release(37)
    }
    buildToolsVersion = "36.1.0"

    defaultConfig {
        applicationId = "com.qala.app"
        minSdk = 34
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"

        ndk {
            // One phone, arm64 only. Compose ships a small native library, so an x86_64 emulator needs
            // ./gradlew assembleDebug -Pqala.abi=x86_64
            abiFilters += abi
        }
    }

    buildFeatures {
        compose = true
    }

    lint {
        // Both are decisions, not oversights: one phone on Android 16 (targetSdk 36 until Nothing OS 5.0 is
        // tested, docs/android-native.md section 2), and arm64-v8a only.
        disable += setOf("OldTargetApi", "ChromeOsAbiSupport")
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_21
        targetCompatibility = JavaVersion.VERSION_21
    }
}

dependencies {
    implementation(project(":design"))
    implementation(platform("androidx.compose:compose-bom:2026.09.00"))
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.runtime:runtime")
    implementation("androidx.compose.ui:ui")
    // UniFFI's Kotlin bindings call the Rust library through JNA. The aar carries the Android natives,
    // the jar on the unit-test classpath carries the host ones.
    implementation("net.java.dev.jna:jna:5.17.0@aar")

    testImplementation("junit:junit:4.13.2")
    testImplementation("net.java.dev.jna:jna:5.17.0")
    // The Android SDK stubs org.json in unit tests; the real one keeps the FFI tests readable.
    testImplementation("org.json:json:20250517")
}
