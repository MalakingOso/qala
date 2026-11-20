plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
    // The workout in progress is kept as JSON (WorkoutState), so a killed process does not lose it.
    id("org.jetbrains.kotlin.plugin.serialization")
}

// The Rust tasks (cargo host build, UniFFI bindings, cargo-ndk) live in :data since M2; this module gets the
// native library and the bindings by depending on it.
val targetAbi: String = providers.gradleProperty("qala.abi").getOrElse("arm64-v8a")

// JVM unit tests load the host build of libqala_ffi through JNA, as :data's do: the warm-up's rounding is Rust now.
tasks.withType<Test>().configureEach {
    dependsOn(":data:cargoHostBuild")
    // CoachWireTest reads the Coach wire fixtures, which server/coach_test.ts checks too; a change to them must rerun it.
    inputs.dir(File(rootProject.projectDir.parentFile.parentFile, "testdata/golden/coach")).withPathSensitivity(PathSensitivity.RELATIVE)
    systemProperty("jna.library.path", File(rootProject.projectDir.parentFile.parentFile, "target/debug").absolutePath)
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
        targetSdk = 37
        versionCode = 1
        versionName = "0.1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        // Where the Coach tab reaches the server (docs/android-native.md section 10). 10.0.2.2 is the emulator's name for the
        // host's loopback, where the server listens (127.0.0.1:8500). A build for the phone passes -Pqala.serverUrl=https://...;
        // S22 makes this a setting.
        val serverUrl = providers.gradleProperty("qala.serverUrl").getOrElse("http://10.0.2.2:8500")
        buildConfigField("String", "COACH_BASE_URL", "\"$serverUrl\"")

        ndk {
            // One phone, arm64 only. Compose ships a small native library, so an x86_64 emulator needs
            // ./gradlew assembleDebug -Pqala.abi=x86_64
            abiFilters += targetAbi
        }
    }

    // The release key lives outside the repo: ~/.config/qala/release.jks, with its passwords in ~/.gradle/gradle.properties
    // (qala.release.storeFile, keyAlias, storePassword, keyPassword). Back both up: a lost key cannot sign an update the phone accepts.
    signingConfigs {
        create("release") {
            providers.gradleProperty("qala.release.storeFile").orNull?.let { storeFile = file(it) }
            storePassword = providers.gradleProperty("qala.release.storePassword").orNull
            keyAlias = providers.gradleProperty("qala.release.keyAlias").orNull
            keyPassword = providers.gradleProperty("qala.release.keyPassword").orNull
        }
    }

    buildTypes {
        release {
            // Off on purpose: nothing here is large enough to need R8, and the Rust library and JNA are reflection-heavy.
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("release")
        }
    }

    buildFeatures {
        compose = true
        // AppContainer decides on BuildConfig.DEBUG whether the debug seed runs.
        buildConfig = true
    }

    lint {
        // A decision, not an oversight: arm64-v8a only.
        disable += setOf("ChromeOsAbiSupport")
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_21
        targetCompatibility = JavaVersion.VERSION_21
    }
}

dependencies {
    implementation(project(":design"))
    implementation(project(":data"))
    implementation(platform("androidx.compose:compose-bom:2026.09.00"))
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.runtime:runtime")
    implementation("androidx.compose.ui:ui")
    // Charts (DECISIONS S10, D13): Vico for the ordinary charts; the ring and the run series are Canvas.
    implementation("com.patrykandpatrick.vico:compose:3.3.1")
    // Today's looping film (DECISIONS S48): a muted ExoPlayer on a SurfaceView, shown through ContentFrame. 1.11.1 is the newest stable.
    implementation("androidx.media3:media3-exoplayer:1.11.1")
    implementation("androidx.media3:media3-ui-compose:1.11.1")

    testImplementation("junit:junit:4.13.2")
    testImplementation("net.java.dev.jna:jna:5.17.0")

    androidTestImplementation(platform("androidx.compose:compose-bom:2026.09.00"))
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
    androidTestImplementation("androidx.test:runner:1.7.0")
    androidTestImplementation("androidx.test:core:1.7.0")
}

// A release build talks to the real server over HTTPS (cleartext is a debug-only network config), so it must be told where
// that is: ./gradlew assembleRelease -Pqala.serverUrl=https://... -Pqala.abi=arm64-v8a
gradle.taskGraph.whenReady {
    val release = allTasks.any { it.project == project && it.name.contains("Release") && (it.name.startsWith("assemble") || it.name.startsWith("bundle") || it.name.startsWith("package")) }
    val url = providers.gradleProperty("qala.serverUrl").orNull
    if (release && (url == null || !url.startsWith("https://"))) {
        throw GradleException("A release build needs -Pqala.serverUrl=https://... (the server the Coach tab asks; cleartext is debug-only).")
    }
    if (release && providers.gradleProperty("qala.release.storeFile").orNull == null) {
        throw GradleException("A release build needs the signing properties in ~/.gradle/gradle.properties (qala.release.storeFile, keyAlias, storePassword, keyPassword).")
    }
}
